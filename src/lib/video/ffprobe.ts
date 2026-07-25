import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveFfprobe } from "@/lib/binaries";

const execFileAsync = promisify(execFile);

export type ProbeResult = {
  durationSec: number;
  /** Best-effort width/height (video stream may be absent for audio-only). */
  width?: number;
  height?: number;
  /** Codec of the first video stream, if any. */
  videoCodec?: string;
  audioCodec?: string;
  sizeBytes?: number;
};

/**
 * ffprobe a media file for duration + basic stream info. Used for transcript
 * progress estimation (we know total seconds; whisper emits segments).
 *
 * Uses `-show_format -show_streams -of json` and pulls the fields we care about.
 */
export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const ffprobe = resolveFfprobe();
  const { stdout } = await execFileAsync(
    ffprobe,
    [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }>;
  };
  const v = data.streams?.find((s) => s.codec_type === "video");
  const a = data.streams?.find((s) => s.codec_type === "audio");
  const duration = Number.parseFloat(data.format?.duration ?? "0") || 0;
  return {
    durationSec: duration,
    width: v?.width,
    height: v?.height,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    sizeBytes: data.format?.size ? Number.parseInt(data.format.size, 10) : undefined,
  };
}
