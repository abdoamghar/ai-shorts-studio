import "server-only";
import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects, subtitleThemes, transcript } from "@/lib/db/schema";
import { localizeClipToArabic } from "@/lib/llm/localize-ar";
import { subtitlesDir } from "@/lib/storage/paths";
import { ARABIC_SAFE_STYLE, buildAssArabic } from "@/lib/subtitles/ass-ar";
import { buildLines, type ClipWord } from "@/lib/subtitles/lines";
import { buildSrt } from "@/lib/subtitles/srt";
import { ARABIC_THEME_KEY } from "@/lib/subtitles/themes";
import type { StyleJson } from "@/lib/subtitles/themes";
import { readGeneralSettings } from "@/lib/settings/store";
import type { JobContext } from "@/lib/jobs/runner";

/**
 * Arabic subtitle path — isolated from English karaoke.
 *
 * Mirrors the English path's theme-resolution scheme: the project's chosen
 * Arabic theme (`subtitleThemeIdAr` in settingsJson) drives the burn. Falls
 * back to the `arabic-safe` builtin, then to the in-process ARABIC_SAFE_STYLE
 * constant as a last-resort hard-coded style. This keeps the preview-route
 * (which renders the user's posted styleJson straight through buildAssArabic)
 * and this render path perfectly in sync: same builder, same style data.
 *
 * 1. Resolve the active Arabic theme as a StyleJson
 * 2. Build English timing lines (Arabic text inherits the source timing)
 * 3. LLM-localize metadata + line text to MSA Arabic
 * 4. Persist Arabic title/hook/summary/hashtags on clips (separate _ar columns)
 * 5. Write line-level SRT + ASS (no word pills)
 */

type WordRow = { text: string; startMs: number; endMs: number };

function clipFileBase(idx: number): string {
  return `clip_${idx.toString().padStart(2, "0")}`;
}

/** Resolve the project's chosen Arabic theme from the DB, mirroring the English
 *  readTheme() in pipeline/subtitles.ts. Order of preference:
 *    1. settingsJson.subtitleThemeIdAr  (per-project Arabic pick from the UI)
 *    2. the `arabic-safe` builtin row
 *    3. the in-process ARABIC_SAFE_STYLE constant (hard-coded safety net) */
function readArabicTheme(project: { settingsJson: string | null }): StyleJson {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(project.settingsJson ?? "{}") as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const themeId = parsed.subtitleThemeIdAr as string | undefined;
  if (themeId) {
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
  }
  const fallback = db
    .select({ styleJson: subtitleThemes.styleJson })
    .from(subtitleThemes)
    .where(eq(subtitleThemes.id, ARABIC_THEME_KEY))
    .get();
  if (fallback) {
    try {
      return JSON.parse(fallback.styleJson) as StyleJson;
    } catch {
      /* fall through */
    }
  }
  return ARABIC_SAFE_STYLE;
}

export async function runArabicSubtitles(ctx: JobContext): Promise<void> {
  ctx.setStep("subtitles", "Localizing Arabic captions");
  ctx.setProgress(0, "Starting Arabic localization");
  ctx.log("Arabic path: localizing captions + metadata (MSA Shorts).");

  const project = db.select().from(projects).where(eq(projects.id, ctx.projectId)).get();
  if (!project) throw new Error(`Project ${ctx.projectId} not found.`);

  // Resolve the active Arabic theme per-project. Falls back to arabic-safe.
  // The same StyleJson shape is what the preview route threads into buildAssArabic,
  // so a preview render of any Arabic theme matches the actual clip burn.
  const style = readArabicTheme(project);
  // The global "Show inactive word pills (Arabic)" toggle lives in General
  // Settings. When off, the renderer drops the dark ghost-pill layer behind
  // inactive words and lets the white text show with a thin outline for
  // legibility — only the active word's colored highlight pill draws.
  const { arabicShowInactiveWordPills } = readGeneralSettings();
  const themeNameLog = style.font ? `theme font '${style.font}'` : "Arabic theme";
  ctx.log(
    `Using Arabic theme (RTL, ${arabicShowInactiveWordPills ? "word-pills + highlight" : "active-word highlight only"}); ${themeNameLog}.`,
  );
  // The global General Settings toggle is the single source of truth for the
  // inactive-pill layer at render time — override any `showInactiveWordPills`
  // the resolved theme carries (e.g. a custom theme the user tagged) before
  // handing the style to buildAssArabic, so the burn always matches the UI.
  if ("showInactiveWordPills" in style) {
    delete (style as { showInactiveWordPills?: boolean }).showInactiveWordPills;
  }
  const clips = db
    .select()
    .from(clipsTable)
    .where(eq(clipsTable.projectId, ctx.projectId))
    .all();
  if (clips.length === 0) {
    ctx.log("No clips to subtitle.", "warn");
    ctx.setProgress(100, "No clips");
    return;
  }

  ctx.log(`Localizing ${clips.length} clip(s) to Arabic…`);
  ctx.setProgress(2, `Preparing ${clips.length} clip(s)`);

  const segments = db
    .select({
      idx: transcript.idx,
      startMs: transcript.startMs,
      endMs: transcript.endMs,
      wordsJson: transcript.wordsJson,
    })
    .from(transcript)
    .where(eq(transcript.projectId, ctx.projectId))
    .all();

  const dir = subtitlesDir(ctx.projectId);
  let done = 0;

  for (const clip of clips) {
    const n = clip.idx + 1;
    const label = `Clip ${n}/${clips.length}`;
    ctx.setStep("subtitles", `Arabic · ${label}`);
    ctx.setProgress(
      Math.round((done / clips.length) * 100),
      `${label}: building timing lines`,
    );
    ctx.log(`${label}: building subtitle timing from transcript…`);

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
        const startMs = Math.max(w.startMs, clip.startMs);
        const endMs = Math.min(Math.min(w.endMs, startMs + 800), clip.endMs);
        words.push({ text: w.text, startMs, endMs });
      }
    }

    const timedLines = buildLines(words, clip.startMs, style.maxChars, style.maxLines);
    let hashtags: string[] = [];
    try {
      hashtags = JSON.parse(clip.hashtagsJson ?? "[]") as string[];
    } catch {
      hashtags = [];
    }

    ctx.log(
      `${label}: localizing "${clip.title}" (${timedLines.length} line(s)) via LLM…`,
    );
    ctx.setProgress(
      Math.round(((done + 0.15) / clips.length) * 100),
      `${label}: waiting for LLM…`,
    );

    const localized = await localizeClipToArabic(
      {
        title: clip.title,
        hook: clip.hook,
        summary: clip.summary,
        hashtags,
        lines: timedLines.map((l) => ({
          startMs: l.startMs,
          endMs: l.endMs,
          text: l.text,
        })),
      },
      (message) => {
        ctx.log(`${label}: ${message}`);
        ctx.setProgress(
          Math.round(((done + 0.4) / clips.length) * 100),
          `${label}: ${message}`,
        );
      },
    );

    ctx.log(`${label}: got Arabic title "${localized.title}" — writing SRT/ASS…`);
    ctx.setProgress(
      Math.round(((done + 0.75) / clips.length) * 100),
      `${label}: writing subtitle files`,
    );

    // IMPORTANT: write ONLY the *_ar columns here. The English title/hook/
    // summary/hashtags are never touched by the Arabic path so both languages
    // coexist on the same clip row (see also schema.ts + migrations/0002).
    db.update(clipsTable)
      .set({
        titleAr: localized.title,
        hookAr: localized.hook ?? null,
        summaryAr: localized.summary ?? null,
        hashtagsArJson: JSON.stringify(localized.hashtags),
      })
      .where(eq(clipsTable.id, clip.id))
      .run();

    const base = clipFileBase(clip.idx);
    const srtPath = path.join(dir, `${base}.srt`);
    const assPath = path.join(dir, `${base}.ass`);
    writeFileSync(
      srtPath,
      buildSrt(localized.lines, style.maxChars, style.maxLines),
      "utf8",
    );
    writeFileSync(
      assPath,
      buildAssArabic(localized.lines, style, arabicShowInactiveWordPills),
      "utf8",
    );

    done++;
    ctx.setProgress(
      Math.round((done / clips.length) * 100),
      `Arabic subtitles… ${done}/${clips.length}`,
    );
    ctx.log(`${label}: done (${done}/${clips.length}).`);
  }

  ctx.setStep("subtitles", "Arabic captions ready");
  ctx.setProgress(100, `Wrote Arabic subtitles for ${done} clip(s)`);
  ctx.log(`Wrote Arabic subtitles for ${done} clip(s).`);
}
