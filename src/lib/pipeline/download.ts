import "server-only";
import { spawn } from "node:child_process";
import {
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { resolveYtDlp } from "@/lib/binaries";
import { assetPath, projectDir } from "@/lib/storage/paths";
import type { JobContext } from "@/lib/jobs/runner";

/**
 * Step 1 — Download the source video with yt-dlp.
 *
 * yt-dlp merges best video+audio into storage/<projectId>/video.mp4 and writes
 * a <projectId>.info.json we parse for title/channel/thumbnail/views/duration.
 * Progress is parsed from yt-dlp's `[download] N%` stderr lines.
 *
 * Requires ffmpeg on PATH (yt-dlp invokes it to merge). The merge is skipped
 * when only one format is available, so `-f best` is a safe fallback.
 */

/** Where the downloaded video lands. */
export function videoPath(projectId: string): string {
  return assetPath(projectId, "video.mp4");
}

type InfoJson = {
  title?: string;
  uploader?: string;
  channel?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url: string }>;
  view_count?: number;
  duration?: number;
  upload_date?: string; // YYYYMMDD
  webpage_url?: string;
};

function parseInfoJson(raw: string): InfoJson {
  try {
    return JSON.parse(raw) as InfoJson;
  } catch {
    return {};
  }
}

function isoDateFromYyyymmdd(s?: string): string | null {
  if (!s || !/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Progress fraction from a yt-dlp stderr line, or null. */
function parseYtDlpProgress(line: string): number | null {
  // Lines look like: "[download]  12.3% of ~1.50GiB at 5.00MiB/s ..."
  const m = line.match(/\[download\]\s+([\d.]+)%/);
  if (!m) return null;
  return Number.parseFloat(m[1]);
}

export async function runDownload(ctx: JobContext, url: string): Promise<void> {
  ctx.log(`yt-dlp downloading ${url}`);
  const ytDlp = resolveYtDlp();

  const dir = projectDir(ctx.projectId);
  const outTemplate = path.join(dir, "%(id)s.%(ext)s");
  const infoPath = path.join(dir, "video.info.json");
  const mp4Path = videoPath(ctx.projectId);

  // Clean any previous artifact so a retry is clean.
  for (const f of [mp4Path, infoPath]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }

  return new Promise<void>((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--newline", // one progress line per update so we can parse them
      "-f",
      "bestvideo+bestaudio/best",
      "--merge-output-format",
      "mp4",
      "--write-info-json",
      "-o",
      outTemplate,
      url,
    ];
    ctx.log(`$ yt-dlp ${args.filter((a) => !a.includes(url)).join(" ")} <url>`);

    const child = spawn(ytDlp, args, { cwd: dir, windowsHide: true });

    let stderrBuf = "";
    let lastPct = -1;

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      // yt-dlp prints the resolved final filename on stdout; surface a log.
      const trimmed = text.trim();
      if (trimmed) ctx.log(trimmed.split("\n")[0]);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;
        const pct = parseYtDlpProgress(l);
        if (pct !== null && pct !== lastPct) {
          lastPct = pct;
          // Map 0-100 download pct onto the step's window (caller owns the jump).
          ctx.setProgress(pct, `Downloading… ${pct.toFixed(0)}%`);
        }
        if (/warning|error/i.test(l) && !l.startsWith("[download]")) {
          ctx.log(l, "warn");
        }
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });

    child.on("close", (code) => {
      // Drain leftover stderr buffer.
      if (stderrBuf.trim()) {
        const l = stderrBuf.trim();
        if (/warning|error/i.test(l)) ctx.log(l, "warn");
      }

      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}.`));
        return;
      }

      // yt-dlp names the file <videoId>.mp4 via the %(id)s template. Rename
      // it to the canonical video.mp4 so downstream steps find it deterministically.
      try {
        if (!existsSync(mp4Path)) {
          const mp4s = readdirSync(dir).filter(
            (f) => f.endsWith(".mp4") && f !== "video.mp4",
          );
          if (mp4s.length === 0) {
            reject(new Error("yt-dlp finished but no .mp4 was produced."));
            return;
          }
          // If multiple, pick the largest (the merged mp4 beats fragments).
          const picked =
            mp4s.length === 1
              ? mp4s[0]
              : mp4s
                  .map((f) => ({ f, size: statSync(path.join(dir, f)).size }))
                  .sort((a, b) => b.size - a.size)[0].f;
          renameSync(path.join(dir, picked), mp4Path);
        }
      } catch (err) {
        reject(new Error(`Could not locate/rename downloaded mp4: ${(err as Error).message}`));
        return;
      }

      // Parse the info json. yt-dlp writes <base>.info.json next to the output;
      // pick any *.info.json that isn't already excluded.
      const infoFile = readdirSync(dir)
        .filter((f) => f.endsWith(".info.json") && f !== "video.info.json")
        .map((f) => path.join(dir, f))[0];
      // `infoPath` (video.info.json) is also acceptable if yt-dlp used our base.
      const chosen = infoFile ?? (existsSync(infoPath) ? infoPath : null);
      const info = chosen ? parseInfoJson(readFileSync(chosen, "utf8")) : {};

      const thumb = info.thumbnail ?? info.thumbnails?.[0]?.url ?? null;
      const publishedAt = isoDateFromYyyymmdd(info.upload_date) ?? null;
      const now = new Date().toISOString();

      db.update(projects)
        .set({
          title: info.title ?? null,
          channel: info.channel ?? info.uploader ?? null,
          thumbnailUrl: thumb,
          views: info.view_count ?? null,
          durationSec: info.duration ?? null,
          publishedAt,
          status: "downloading",
          updatedAt: now,
        })
        .where(eq(projects.id, ctx.projectId))
        .run();

      ctx.log(
        `Downloaded "${info.title ?? "video"}" (${info.duration ?? 0}s, ${
          info.view_count ?? "?"
        } views).`,
      );

      // Tell the caller (analyze handler) it can proceed; final progress jump
      // is owned by the handler's step window.
      ctx.setProgress(100, "Download complete");
      resolve();
    });
  });
}
