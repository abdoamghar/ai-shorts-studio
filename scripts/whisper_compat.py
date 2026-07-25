#!/usr/bin/env python3
"""
AI Shorts Studio — faster-whisper compatibility emitter.

Reads a 16kHz mono WAV, runs faster-whisper with VAD + word timestamps, and
emits ONE JSON object PER LINE (NDJSON) on stdout so the Node job runner can
stream progress incrementally without buffering the whole transcript.

Line types:
  {"type":"ready","model":...,"language":...,"duration_sec":...}   # once, before segments
  {"type":"segment","idx":N,"start":..,"end":..,"text":..,"words":[{...}]}
  {"type":"progress","done_sec":..}                                 # periodic
  {"type":"done","segments":N}                                       # at the end
  {"type":"error","message":..}                                     # on failure (exit 1)

CLI:
  python whisper_compat.py --audio audio.wav --model base --language auto \
      --word-timestamps --vad [--model-dir DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any


def emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="faster-whisper NDJSON emitter")
    p.add_argument("--audio", required=True, help="Path to audio file (16k mono WAV ideal)")
    p.add_argument("--model", default="base", help="Whisper model size: tiny|base|small|medium|large")
    p.add_argument(
        "--language",
        default=None,
        help="Source language code or 'auto' for detection (default: auto)",
    )
    p.add_argument("--word-timestamps", action="store_true", help="Emit per-word timing")
    p.add_argument("--vad", action="store_true", help="Use Silero VAD filter")
    p.add_argument(
        "--model-dir",
        default=None,
        help="Optional absolute path to a local CTranslate2 model directory",
    )
    p.add_argument(
        "--device",
        default="auto",
        help="Compute device (default auto; GPU requires ctranslate2 CUDA build)",
    )
    p.add_argument("--compute-type", default="int8", help="CTranslate2 compute type")
    return p.parse_args()


def get_audio_duration_sec(path: str) -> float:
    try:
        # Prefer wave module (fast, no deps) for WAV.
        import wave

        with wave.open(path, "rb") as wf:
            return wf.getnframes() / float(wf.getframerate())
    except Exception:
        return 0.0


def main() -> int:
    args = parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        emit({"type": "error", "message": f"faster-whisper not installed: {exc}"})
        return 1

    # Resolve model: explicit dir wins; otherwise model short-name (auto-downloaded).
    model_arg: Any = args.model_dir if args.model_dir else args.model
    try:
        model = WhisperModel(model_arg, device=args.device, compute_type=args.compute_type)
    except Exception as exc:  # pragma: no cover - environment specific
        emit({"type": "error", "message": f"Failed to load model: {exc}"})
        return 1

    language = None if (args.language is None or args.language.lower() == "auto") else args.language

    duration_sec = get_audio_duration_sec(args.audio)
    emit(
        {
            "type": "ready",
            "model": args.model_dir or args.model,
            "language": language or "auto",
            "duration_sec": duration_sec,
        }
    )

    segments_iter, info = model.transcribe(
        args.audio,
        language=language,
        vad_filter=args.vad,
        beam_size=5,
        word_timestamps=args.word_timestamps,
    )

    total = duration_sec or (info.duration if hasattr(info, "duration") else 0.0)
    idx = 0
    last_progress = 0.0

    try:
        for seg in segments_iter:
            idx += 1
            words = []
            if args.word_timestamps and getattr(seg, "words", None):
                for w in seg.words:
                    words.append(
                        {
                            "start": float(w.start),
                            "end": float(w.end),
                            "word": str(w.word),
                            "probability": float(getattr(w, "probability", 0.0) or 0.0),
                        }
                    )
            emit(
                {
                    "type": "segment",
                    "idx": idx,
                    "start": float(seg.start),
                    "end": float(seg.end),
                    "text": str(seg.text).strip(),
                    "words": words,
                }
            )

            # Progress roughly by segment end time vs total. faster-whisper yields
            # segments in order, so seg.end is a fine progress proxy.
            if total > 0:
                done = float(seg.end)
                if done - last_progress >= max(0.5, total * 0.01):
                    last_progress = done
                    emit({"type": "progress", "done_sec": done})
    except Exception as exc:  # pragma: no cover
        emit({"type": "error", "message": f"Transcription failed: {exc}"})
        return 1

    emit({"type": "done", "segments": idx})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
