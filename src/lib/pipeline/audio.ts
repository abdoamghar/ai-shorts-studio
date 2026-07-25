import "server-only";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

import { resolveFfmpeg } from "@/lib/binaries";
import { assetPath } from "@/lib/storage/paths";
import { videoPath } from "@/lib/pipeline/download";
import { probeMedia } from "@/lib/video/ffprobe";
import type { JobContext } from "@/lib/jobs/runner";

/**
 * Step 2 — Extract a 16kHz mono PCM WAV from the downloaded video.
 *
 * Whisper performs best on 16kHz mono s16le audio; this is the canonical
 * extraction transcribe.ts feeds to faster-whisper. Progress is parsed from
 * ffmpeg `-progress pipe:2` key=value pairs (out_time_ms vs duration).
 */

export function audioPath(projectId: string): string {
  return assetPath(projectId, "audio.wav");
}

export async function runAudio(ctx: JobContext): Promise<void> {
  ctx.log("ffmpeg extracting 16kHz mono WAV");
  const ffmpeg = resolveFfmpeg();
  const src = videoPath(ctx.projectId);
  if (!existsSync(src)) {
    throw new Error(`Source video missing for audio extraction: ${src}`);
  }
  const out = audioPath(ctx.projectId);
  if (existsSync(out)) rmSync(out, { force: true });

  // Probe duration once for progress mapping (seconds).
  let totalSec = 0;
  try {
    const probe = await probeMedia(src);
    totalSec = probe.durationSec || 0;
  } catch {
    /* ffmpeg will still run; we just won't map progress precisely */
  }

  return new Promise<void>((resolve, reject) => {
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-progress",
      "pipe:2",
      "-i",
      src,
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      out,
    ];
    const child = spawn(ffmpeg, args, { windowsHide: true });

    let stderrBuf = "";
    let lastPct = -1;

    const handleFrame = (line: string) => {
      // ffmpeg progress emits key=value, e.g. "out_time_ms=1234567" and "progress=continue|end".
      const m = line.match(/^out_time_ms=(\d+)/);
      if (m && totalSec > 0) {
        const doneSec = Number.parseInt(m[1], 10) / 1_000_000;
        const pct = Math.min(100, Math.max(0, (doneSec / totalSec) * 100));
        const rounded = Math.round(pct);
        if (rounded !== lastPct) {
          lastPct = rounded;
          ctx.setProgress(rounded, `Extracting audio… ${rounded}%`);
        }
      }
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) handleFrame(line.trim());
    });

    child.on("error", (err) => reject(new Error(`Failed to start ffmpeg: ${err.message}`)));
    child.on("close", (code) => {
      if (stderrBuf.trim()) handleFrame(stderrBuf.trim());
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}.`));
        return;
      }
      if (!existsSync(out)) {
        reject(new Error("ffmpeg finished but audio.wav was not produced."));
        return;
      }
      ctx.setProgress(100, "Audio extracted");
      ctx.log("audio.wav ready (16kHz mono).");
      resolve();
    });
  });
}
