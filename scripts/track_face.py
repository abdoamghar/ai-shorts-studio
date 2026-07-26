#!/usr/bin/env python3
"""
AI Shorts Studio — Face Tracking for Auto-Crop.

Reads a video segment, uses MediaPipe to detect the most prominent face per frame,
smooths the X-coordinate to avoid jitter, and writes an FFmpeg sendcmd script
that dynamically updates the crop filter's X offset.

CLI:
  python track_face.py --input video.mp4 --start 12.5 --end 45.0 --out crop.cmd
"""

import argparse
import sys
import math
import json

def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--start", type=float, required=True)
    p.add_argument("--end", type=float, required=True)
    p.add_argument("--out", required=True)
    return p.parse_args()

def main():
    args = parse_args()
    try:
        import cv2
        import mediapipe as mp
    except ImportError as e:
        emit({"type": "error", "message": f"Dependencies missing: {e}"})
        return 1

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        emit({"type": "error", "message": "Could not open video file"})
        return 1

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # What is the crop box width in source pixels?
    # We are cropping 9:16 out of the source.
    # If source is 1920x1080 (16:9), a 9:16 crop has height=1080, width = 1080 * 9 / 16 = 607
    target_aspect = 9 / 16
    crop_h_source = height
    crop_w_source = int(height * target_aspect)
    
    # If the video is already tall (like 9:16), we can't really pan horizontally anyway.
    if crop_w_source >= width:
        crop_w_source = width

    # Seek to start time
    cap.set(cv2.CAP_PROP_POS_MSEC, args.start * 1000.0)

    mp_face_detection = mp.solutions.face_detection
    
    # We sample at a lower FPS to save time (e.g. 5 FPS), then interpolate.
    sample_fps = 5.0
    frame_step = max(1, int(fps / sample_fps))
    
    raw_x_centers = []
    
    with mp_face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.3) as face_detection:
        current_frame = int(args.start * fps)
        end_frame = int(args.end * fps)
        
        while cap.isOpened() and current_frame <= end_frame:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Process only every Nth frame
            if current_frame % frame_step == 0:
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = face_detection.process(rgb_frame)
                
                center_x = width / 2.0 # default center
                if results.detections:
                    # Find the biggest face by bounding box area
                    best_area = 0
                    for detection in results.detections:
                        bboxC = detection.location_data.relative_bounding_box
                        area = bboxC.width * bboxC.height
                        if area > best_area:
                            best_area = area
                            center_x = (bboxC.xmin + bboxC.width / 2.0) * width
                
                timestamp = current_frame / fps
                raw_x_centers.append((timestamp, center_x))
                
            current_frame += 1

    cap.release()

    if not raw_x_centers:
        emit({"type": "error", "message": "No frames processed"})
        return 1

    # Apply Exponential Moving Average (EMA) to smooth the camera panning
    smoothed = []
    alpha = 0.1  # Low smoothing factor = very smooth, slow to react to jitter
    
    current_x = raw_x_centers[0][1]
    for ts, x in raw_x_centers:
        # If the jump is massive (e.g. scene cut), allow it to jump quickly
        if abs(x - current_x) > (width * 0.3):
             current_x = x
        else:
             current_x = alpha * x + (1 - alpha) * current_x
        
        # Calculate the actual crop X (left edge) based on center
        crop_x = current_x - (crop_w_source / 2.0)
        
        # Clamp to bounds
        if crop_x < 0:
            crop_x = 0
        if crop_x + crop_w_source > width:
            crop_x = width - crop_w_source
            
        smoothed.append((ts, crop_x))

    # Write the sendcmd file
    try:
        with open(args.out, "w", encoding="utf-8") as f:
            for i in range(len(smoothed)):
                start_ts, crop_x = smoothed[i]
                if i < len(smoothed) - 1:
                    end_ts = smoothed[i+1][0]
                else:
                    end_ts = args.end + 1.0
                
                crop_x_int = int(crop_x)
                
                # timestamps in sendcmd need to match the filtergraph's PTS.
                rel_start = max(0.0, start_ts - args.start)
                rel_end = max(0.0, end_ts - args.start)
                
                if rel_end > rel_start:
                    f.write(f"{rel_start:.3f}-{rel_end:.3f} [enter] crop x '{crop_x_int}';\n")
                    
        emit({"type": "done", "frames_analyzed": len(smoothed)})
    except Exception as e:
        emit({"type": "error", "message": f"Failed to write cmd file: {e}"})
        return 1
        
    return 0

if __name__ == "__main__":
    sys.exit(main())
