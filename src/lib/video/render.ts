import "server-only";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { resolveFfmpeg, resolvePython } from "@/lib/binaries";
import { projectDir } from "@/lib/storage/paths";
import { videoPath } from "@/lib/pipeline/download";
import { escapeFontsDirForFilter } from "@/lib/subtitles/fonts-ar";
import type { JobContext } from "@/lib/jobs/runner";

/**
 * Step 6 — render a clip into a 9:16 (1080x1920) MP4 with burned subtitles.
 *
 * Transform strategy (v1): "center-padded-blur".
 *   1. seek the source to [start] and bound to [start, start+dur] using
 *      `-ss <start> -t <dur>` (before -i for fast seek). We intentionally do NOT
 *      also apply a `trim=<start>:<end>` filter: with `-ss` before `-i`, the
 *      demuxer fast-seeks to the nearest keyframe and decoded PTS resets to ~0,
 *      so an absolute `trim=` range would match the WRONG frames (and on long-
 *      GOP sources like AV1 can land outside any keyframe window, yielding a
 *      0-frame / empty output). Clip bounds come solely from -ss/-t.
 *   2. scale the foreground to fit 1080 wide preserving aspect ratio.
 *   3. build the blurry background at a QUARTER resolution (270x480), blur it,
 *      then upscale to 1080x1920 with fast bilinear — the blur hides the
 *      upscaling, so the result is visually identical to a full-res blur
 *      while doing ~16x less pixel work (the dominant cost).
 *   4. overlay the sharp foreground centered on the blurred background.
 *   5. burn the ASS subtitles (clip-relative timeline) via `subtitles=<ass>`.
 *   6. encode libx264 crf 20 @ preset veryfast, yuv420p, aac 192k.
 *
 * Perf: the previous graph ran boxblur over a full 1080x1920 background
 * (~2M px/frame) with preset medium — ~11x real-time. Quarter-res blur +
 * veryfast is ~6x faster (5s of video in ~10s vs ~55s) at parity file size.
 *
 * Windows note: the `subtitles=` filter chokes on drive-letter colons and
 * backslashes. We run ffmpeg with the project dir as cwd and pass a relative
 * subs path with forward slashes; libass accepts relative paths fine.
 */

export type RenderInput = {
  projectId: string;
  startMs: number;
  endMs: number;
  assPath: string;
  outPath: string;
  framingStyle?: "blur" | "crop" | "auto-crop";
  /** Absolute fonts dir for libass (Arabic burns only). English path omits this. */
  fontsDir?: string | null;
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

async function runFaceTracker(input: RenderInput, cwd: string): Promise<string | null> {
  const py = resolvePython();
  const scriptPath = path.resolve(process.cwd(), "scripts/track_face.py");
  const outCmd = input.outPath.replace(/\.mp4$/i, ".cmd");
  
  if (!existsSync(scriptPath)) return null;

  return new Promise((resolve) => {
    input.job?.log("Tracking face for auto-crop...");
    const p = spawn(
      py,
      [
        scriptPath,
        "--input",
        videoPath(input.projectId),
        "--start",
        (input.startMs / 1000).toFixed(3),
        "--end",
        (input.endMs / 1000).toFixed(3),
        "--out",
        outCmd,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    p.on("close", (code) => {
      if (code === 0 && existsSync(outCmd)) {
        // Return project-relative path
        resolve(path.relative(cwd, outCmd).split(path.sep).join("/"));
      } else {
        resolve(null);
      }
    });
  });
}

/** Render a single clip. Resolves to the output path on success. */
export async function renderClip(input: RenderInput): Promise<string> {
  const ffmpeg = resolveFfmpeg();
  const src = videoPath(input.projectId);
  if (!existsSync(src)) {
    throw new Error(`Source video missing for render: ${src}`);
  }
  if (!existsSync(input.assPath)) {
    throw new Error(`Subtitle file missing for render: ${input.assPath}`);
  }

  const cwd = projectDir(input.projectId);
  const relAss = path.relative(cwd, input.assPath).split(path.sep).join("/");
  const subsFilterArg = relAss.replace(/\\/g, "/").replace(/:/g, "\\:");

  // fontsdir only for Arabic (or any caller that opts in). English burns omit it.
  let subsFilter = `subtitles=${subsFilterArg}`;
  if (input.fontsDir) {
    const escapedFonts = escapeFontsDirForFilter(input.fontsDir);
    subsFilter = `subtitles=${subsFilterArg}:fontsdir='${escapedFonts}'`;
  }

  let sendCmdFilter = "";
  if (input.framingStyle === "auto-crop") {
    const cmdPath = await runFaceTracker(input, cwd);
    if (cmdPath) {
      sendCmdFilter = `sendcmd=f='${cmdPath}',`;
    }
  }

  const durationSec = Math.max(0.5, (input.endMs - input.startMs) / 1000).toFixed(3);

  const isCrop = input.framingStyle === "crop" || input.framingStyle === "auto-crop";
  const filter = isCrop
    ? [
        `[0:v]setpts=PTS-STARTPTS[clip]`,
        `[clip]scale=1080:1920:force_original_aspect_ratio=increase,${sendCmdFilter}crop=1080:1920[base]`,
        `[base]${subsFilter}[v]`,
      ].join(";")
    : [
        `[0:v]setpts=PTS-STARTPTS[clip]`,
        `[clip]split=2[fg][bgsrc]`,
        `[fg]scale=1080:-2:force_original_aspect_ratio=decrease[fgscaled]`,
        `[bgsrc]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=20:10,eq=brightness=-0.05:saturation=0.8,scale=1080:1920:flags=fast_bilinear[bg]`,
        `[bg][fgscaled]overlay=(W-w)/2:(H-h)/2[base]`,
        `[base]${subsFilter}[v]`,
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
    "veryfast",
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
