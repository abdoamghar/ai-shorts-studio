import "server-only";
import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects, subtitleThemes, transcript } from "@/lib/db/schema";
import { subtitlesDir } from "@/lib/storage/paths";
import { buildAss } from "@/lib/subtitles/ass";
import { buildSrt } from "@/lib/subtitles/srt";
import { buildLines, type ClipWord } from "@/lib/subtitles/lines";
import { DEFAULT_THEME_KEY } from "@/lib/subtitles/themes";
import type { StyleJson } from "@/lib/subtitles/themes";
import type { JobContext } from "@/lib/jobs/runner";
import { readGeneralSettings } from "@/lib/settings/store";
import { readSubtitleLanguage } from "@/lib/subtitles/language";
import { runArabicSubtitles } from "@/lib/pipeline/subtitles-ar";

/**
 * Step 5 — generate per-clip subtitle files (SRT + ASS) from the transcript.
 *
 * For each clip we gather the word-level entries from every transcript segment
 * whose [startMs, endMs] intersects the clip's window, shift them to be
 * clip-relative, then group into lines and emit both formats. The ASS carries
 * the per-word karaoke highlight used by the burn-in render; the SRT is the
 * portable companion for export. Resolves the active subtitle theme from the
 * project's settingsJson (default: tiktok).
 */

type WordRow = { text: string; startMs: number; endMs: number };

function clipFileBase(idx: number): string {
  return `clip_${idx.toString().padStart(2, "0")}`;
}


function readTheme(project: { settingsJson: string | null }): StyleJson {
  const generalSettings = readGeneralSettings();
  const raw = project.settingsJson ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const themeId = (parsed.subtitleThemeId as string) ?? generalSettings.defaultSubtitleThemeId;
  const row = db
    .select({ styleJson: subtitleThemes.styleJson })
    .from(subtitleThemes)
    .where(eq(subtitleThemes.id, themeId))
    .get();
  if (row) {
    try {
      return JSON.parse(row.styleJson) as StyleJson;
    } catch {
      /* fall through */
    }
  }
  // Fallback to the default builtin by preset key.
  const fallback = db
    .select({ styleJson: subtitleThemes.styleJson })
    .from(subtitleThemes)
    .where(eq(subtitleThemes.id, DEFAULT_THEME_KEY))
    .get();
  if (fallback) {
    try {
      return JSON.parse(fallback.styleJson) as StyleJson;
    } catch {
      /* fall through */
    }
  }
  // Hard-coded last-resort style.
  return {
    font: "Inter",
    fontSize: 82,
    primaryHsl: [0, 0, 1],
    outlineHsl: [0, 0, 0],
    outline: 10,
    shadow: 0,
    bold: 1,
    alignment: 8,
    marginL: 80,
    marginV: 120,
    highlightHsl: [42, 1, 0.55],
    animationSpeed: 1,
    maxChars: 22,
    maxLines: 2,
  };
}

export async function runSubtitles(ctx: JobContext): Promise<void> {
  const project = db.select().from(projects).where(eq(projects.id, ctx.projectId)).get();
  if (!project) throw new Error(`Project ${ctx.projectId} not found.`);

  // Parallel Arabic path — English karaoke below stays untouched when language is en.
  if (readSubtitleLanguage(project.settingsJson) === "ar") {
    return runArabicSubtitles(ctx);
  }

  ctx.log("Generating per-clip subtitles (SRT + ASS).");

  const style = readTheme(project);
  const clips = db
    .select()
    .from(clipsTable)
    .where(eq(clipsTable.projectId, ctx.projectId))
    .all();
  if (clips.length === 0) {
    ctx.log("No clips to subtitle.", "warn");
    return;
  }

  // Load all transcript segments once (words are JSON per segment).
  const segments = db
    .select({ idx: transcript.idx, startMs: transcript.startMs, endMs: transcript.endMs, wordsJson: transcript.wordsJson })
    .from(transcript)
    .where(eq(transcript.projectId, ctx.projectId))
    .all();

  const dir = subtitlesDir(ctx.projectId);
  let done = 0;
  for (const clip of clips) {
    // Collect words from segments overlapping the clip window.
    const words: ClipWord[] = [];
    for (const seg of segments) {
      if (seg.endMs < clip.startMs || seg.startMs > clip.endMs) continue;
      let segWords: WordRow[] = [];
      try {
        segWords = JSON.parse(seg.wordsJson) as WordRow[];
      } catch {
        segWords = [];
      }
      for (const w of segWords) {
        if (w.endMs < clip.startMs || w.startMs > clip.endMs) continue;
        // Truncate word bounds to the clip window so subs don't overrun.
        // Whisper sometimes stretches the last word of a segment into the silence
        // that follows. Cap max word duration to 800ms so text disappears when 
        // the speaker stops talking.
        const startMs = Math.max(w.startMs, clip.startMs);
        const endMs = Math.min(Math.min(w.endMs, startMs + 800), clip.endMs);
        words.push({
          text: w.text,
          startMs,
          endMs,
        });
      }
    }
    const lines = buildLines(words, clip.startMs, style.maxChars, style.maxLines);
    const base = clipFileBase(clip.idx);
    const srtPath = path.join(dir, `${base}.srt`);
    const assPath = path.join(dir, `${base}.ass`);
    writeFileSync(srtPath, buildSrt(lines, style.maxChars, style.maxLines), "utf8");
    writeFileSync(assPath, buildAss(lines, style), "utf8");
    done++;
    ctx.setProgress(Math.round((done / clips.length) * 100), `Subtitles… ${done}/${clips.length}`);
  }
  ctx.log(`Wrote subtitles for ${done} clip(s).`);
}
