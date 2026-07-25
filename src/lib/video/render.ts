import "server-only";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { resolveFfmpeg } from "@/lib/binaries";
import { projectDir } from "@/lib/storage/paths";
import { videoPath } from "@/lib/pipeline/download";
import type { JobContext } from "@/lib/jobs/runner";

/**
 * Step 6 — render a clip into a 9:16 (1080x1920) MP4 with burned subtitles.
 *
 * Transform strategy (v1): "center-padded-blur".
 *   1. trim the source to [start, end]
 *   2. scale the video to fit 1080 wide preserving aspect ratio (the longest
 *      vertical shorts-friendly dimension), then pad letterbox-style onto a
 *      box-blurred, upscaled copy of the same frame filling 1080x1920
 *      (the blurry background), centered vertically.
 *   3. burn the ASS subtitles (clip-relative timeline) via `subtitles=<ass>`.
 *   4. encode libx264 crf 20, yuv420p, aac 192k.
 *
 * Windows note: the `subtitles=` filter chokes on drive-letter colons and
 * backslashes. We run ffmpeg with the project dir as cwd and pass a relative
 * subs path with forward slashes; libass accepts relative paths fine.
 */

export type RenderInput = {
  projectId: string;
  /** Source-absolute clip start, ms. */
  startMs: number;
  /** Source-absolute clip end, ms. */
  endMs: number;
  /** Absolute path to the .ass file (we convert to a project-relative path). */
  assPath: string;
  /** Absolute output .mp4 path. */
  outPath: string;
  /** Optional progress context (render step reports per-clip local 0-100). */
  job?: JobContext;
};

function fmtTime(ms: number): string {
  // ffmpeg timecode: HH:MM:SS.mmm
  const total = ms / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${s.toFixed(3).padStart(6, "0")}`;
}

/** Render a single clip. Resolves to the output path on success. */
export function renderClip(input: RenderInput): Promise<string> {
  const ffmpeg = resolveFfmpeg();
  const src = videoPath(input.projectId);
  if (!existsSync(src)) {
    return Promise.reject(new Error(`Source video missing for render: ${src}`));
  }
  if (!existsSync(input.assPath)) {
    return Promise.reject(new Error(`Subtitle file missing for render: ${input.assPath}`));
  }

  // Build a project-relative subs path with forward slashes for the filter.
  const cwd = projectDir(input.projectId);
  const relAss = path.relative(cwd, input.assPath).split(path.sep).join("/");
  // Escape backslashes/colons for the filtergraph string; forward slashes are safe.
  // The path itself is relative so no drive-letter colon is present.
  const subsFilterArg = relAss.replace(/\\/g, "/").replace(/:/g, "\\:");

  const startSec = (input.startMs / 1000).toFixed(3);
  const durationSec = Math.max(0.5, (input.endMs - input.startMs) / 1000).toFixed(3);

  // filter_complex:
  //   [0:v] trim+setpts, then split into the sharp foreground (scaled to fit
  //   1080 wide, padded to 1920 tall with transparent margins) AND a blurred
  //   background (scaled to cover 1080x1920 + heavy blur). Compose them, then
  //   burn subtitles last so the karaoke highlight survives on top.
  const filter = [
    `[0:v]trim=${startSec}:${(input.startMs / 1000 + Number.parseFloat(durationSec)).toFixed(3)},setpts=PTS-STARTPTS[clip]`,
    `[clip]split=2[fg][bgsrc]`,
    // Foreground: fit width 1080, keep AR; then overlay centered on the bg.
    `[fg]scale=1080:-2:force_original_aspect_ratio=decrease[fgscaled]`,
    // Background: cover 1080x1920, blur, dim slightly.
    `[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:20,eq=brightness=-0.05:saturation=0.8[bg]`,
    `[bg][fgscaled]overlay=(W-w)/2:(H-h)/2[base]`,
    `[base]subtitles=${subsFilterArg}[v]`,
  ].join(";");

  if (existsSync(input.outPath)) rmSync(input.outPath, { force: true });

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-progress",
    "pipe:2",
    "-ss",
    fmtTime(input.startMs),
    "-i",
    src,
    "-t",
    durationSec,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    input.outPath,
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { cwd, windowsHide: true });
    let stderrBuf = "";
    let lastPct = -1;

    const handleFrame = (line: string) => {
      const m = line.match(/^out_time_ms=(\d+)/);
      if (m && input.job) {
        const doneSec = Number.parseInt(m[1], 10) / 1_000_000;
        const pct = Math.min(100, Math.max(0, (doneSec / Number.parseFloat(durationSec)) * 100));
        const rounded = Math.round(pct);
        if (rounded !== lastPct) {
          lastPct = rounded;
          input.job.setProgress(rounded, `Rendering clip… ${rounded}%`);
        }
      }
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) handleFrame(line.trim());
    });
    child.stderr?.on("error", () => {});
    child.on("error", (err) => reject(new Error(`Failed to start ffmpeg: ${err.message}`)));
    child.on("close", (code) => {
      if (stderrBuf.trim()) handleFrame(stderrBuf.trim());
      if (code !== 0) {
        reject(new Error(`ffmpeg render exited with code ${code}.`));
        return;
      }
      if (!existsSync(input.outPath)) {
        reject(new Error("ffmpeg finished but the render was not produced."));
        return;
      }
      resolve(input.outPath);
    });
  });
}
