import "server-only";

import {
  hslToAssColor,
  roundedRectDrawing,
  type AssLine,
  type AssWord,
} from "@/lib/subtitles/ass";
import { layoutBlock } from "@/lib/subtitles/layout";
import { resolveArabicFontFamily } from "@/lib/subtitles/fonts-ar";
import type { StyleJson } from "@/lib/subtitles/themes";

/**
 * Arabic ASS writer — same viral word-pill *look* as English, but self-aligned.
 *
 * Why not reuse English `buildAss` as-is?
 * English places one full-line text event (libass shapes it) and estimates pill
 * positions with Latin ink ratios. Arabic connected shaping makes those
 * estimates miss the real glyphs — pills end up wrong size/position.
 *
 * Fix: place EVERY word's text AND its pill at the same `\pos`. Boxes and
 * glyphs share one coordinate system, so they stay locked together. RTL
 * reading order comes from `style.direction: "rtl"` in layoutBlock.
 */

export type ArabicAssLine = {
  startMs: number;
  endMs: number;
  text: string;
};

/** Viral-style Arabic theme: word pills + highlight, no uppercase, RTL.
 * Larger font, tighter margins/padding — short-form Shorts caption style. */
export const ARABIC_SAFE_STYLE: StyleJson = {
  font: "Noto Sans Arabic",
  fontMetricsKey: "arial-bold",
  fontSize: 96,
  primaryHsl: [0, 0, 1],
  outlineHsl: [0, 0, 0],
  outline: 0,
  shadow: 0,
  bold: 1,
  anchorY: 0.62,
  wordPillMode: "all",
  bgHsl: [0, 0, 0.06],
  bgOpacity: 0.72,
  highlightHsl: [258, 0.75, 0.6],
  highlightOpacity: 1,
  animationStyle: "none",
  animationSpeed: 1,
  // Narrower safe margins so words use more of the screen width.
  safeMarginPct: 0.05,
  maxBlockWidthPct: 0.90,
  lineHeight: 1.15,
  // Tighter pill padding so the highlight boxes hug the word glyphs (smaller
  // top/bottom padding so the pill doesn't tower above/below the Arabic ink).
  highlightPaddingX: 10,
  highlightPaddingY: 4,
  highlightRadius: 8,
  maxChars: 20,
  maxLines: 2,
  uppercase: false,
  // room-152_0; visible gap between consecutive Arabic pill centers (~24px at
  // fontSize 96 after ink-shrink) — tighter than English, looser than fusion.
  wordSpacingEm: 0.28,
  direction: "rtl",
};

function opacityToAssAlpha(opacity: number): string {
  const a = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255);
  return a.toString(16).padStart(2, "0").toUpperCase();
}

function formatAssTime(ms: number): string {
  const csTotal = Math.max(0, Math.round(ms / 10));
  const cs = csTotal % 100;
  const sTotal = Math.floor(csTotal / 100);
  const s = sTotal % 60;
  const mTotal = Math.floor(sTotal / 60);
  const m = mTotal % 60;
  const h = Math.floor(mTotal / 60);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{|\}/g, "").replace(/\n/g, "\\N");
}

// RLM / LRE / RLE unicode marks for fixing libass pla Emulti-directional text:
//   U+200F = RIGHT-TO-LEFT MARK (zero-width, sets strong RTL context)
//   U+202B = RIGHT-TO-LEFT EMBEDDING (open)
//   U+202C = POP DIRECTIONAL FORMATTING (close)
//
// PROBLEM: Arabic words in our multi-Dialogue \an5 placement end with Latin
// "neutral" punctuation (. , ; : ! ? -) when the LLM appends a sentence-final
// period. libass shapes each per-word Dialogue as one isolated bidi run, so a
// leading-or-trailing Latin-script mark in an otherwise-Arabic run gets
// classified as LTR-by-default and visually lands on the WRONG side of the
// Arabic run — the period ends up RIGHT = start of RTL reading, looking like
// ". عَسَل" instead of "عَسَل .". The user reported: "العسل." renders with the
// period appearing before the word.
//
// FIX: when a word ends in a neutral/bidi-Latin punctuation mark, append U+200F
// (RLM). The RLM promotes the preceding Arabic run's directionality onto the
// trailing mark so the bidi algorithm assigns it to the ARABIC side of the run
// boundary, placing the period on the correct visual side (end of RTL = LEFT).
//
// Arabic-script punctuation (،  ؛ ؛ ؟) doesn't need this — those glyphs have
// strong or natural RTL directionality from their block membership.
const AR_ENDING_LATIN_PUNCT = /[.!,;:?"'()\[\]/\\\-—–\u2026]$/u;
function fixRtlPunct(text: string): string {
  if (!text) return text;
  // Word ends in a Latin/neutral punctuation mark.
  if (AR_ENDING_LATIN_PUNCT.test(text.trim())) {
    // Append a right-to-left mark so the trailing punct follows Arabic run
    // directionality (lands on the visual LEFT = end of RTL).
    return text + "\u200F";
  }
  return text;
}

/** Split a localized line into timed AssWords (proportional by character weight). */
export function arabicLineToAssWords(
  text: string,
  startMs: number,
  endMs: number,
): AssWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) {
    return [{ text: parts[0], startMs, endMs: Math.max(endMs, startMs + 80) }];
  }

  const weights = parts.map((p) => Math.max(1, Array.from(p).length));
  const total = weights.reduce((a, b) => a + b, 0);
  const dur = Math.max(endMs - startMs, parts.length * 100);
  let t = startMs;
  const out: AssWord[] = [];

  for (let i = 0; i < parts.length; i++) {
    const slice = Math.round((weights[i] / total) * dur);
    const wStart = t;
    const wEnd =
      i === parts.length - 1
        ? Math.max(endMs, wStart + 80)
        : Math.min(endMs, wStart + Math.max(90, slice));
    out.push({ text: parts[i], startMs: wStart, endMs: Math.max(wEnd, wStart + 80) });
    t = out[out.length - 1].endMs;
  }
  return out;
}

export function arabicLinesToAssLines(lines: ArabicAssLine[]): AssLine[] {
  return lines
    .filter((l) => l.text.trim())
    .map((l) => ({
      startMs: l.startMs,
      endMs: Math.max(l.endMs, l.startMs + 80),
      words: arabicLineToAssWords(l.text.trim(), l.startMs, l.endMs),
    }))
    .filter((l) => l.words.length > 0);
}

/**
 * Build Arabic ASS with per-word text+pill co-positioning (self-aligned karaoke).
 *
 * `showInactiveWordPills` controls the dark ghost-pill layer (Layer 0) behind
 * every word. When true (default), the entire block has a dark "viral" pill
 * behind every word and the active word's colored pill overlays it. When
 * false, the ghost pills are suppressed — only the active word's colored
 * highlight pill draws, and inactive words render as plain text. For
 * legibility without the dark background, the Default text style picked up
 * an outline+shadow when pills are off; the per-event \bord0 override is
 * likewise dropped so the outline actually shows.
 */
export function buildAssArabic(
  lines: ArabicAssLine[],
  style: StyleJson = ARABIC_SAFE_STYLE,
  showInactiveWordPills = true,
): string {
  const font = resolveArabicFontFamily() || style.font || "Noto Sans Arabic";
  const merged: StyleJson = {
    ...ARABIC_SAFE_STYLE,
    ...style,
    font,
    uppercase: false,
    direction: "rtl",
    wordPillMode: "all",
  };

  // Outline/shadow applied to the default text style only when the dark
  // inactive pills are suppressed — otherwise the pills provide the contrast
  // and an outline would thicken the glyphs awkwardly. Use the theme's own
  // outline/shadow values if set, falling back to small sensible defaults.
  const textOutline = showInactiveWordPills ? 0 : merged.outline || 4;
  const textShadow = showInactiveWordPills ? 0 : merged.shadow || 2;
  const outlineColor = hslToAssColor(merged.outlineHsl);

  const assLines = arabicLinesToAssLines(lines);
  const videoW = 1080;
  const videoH = 1920;
  const marginH = Math.round(videoW * (merged.safeMarginPct ?? 0.08));
  const lineHeightPx = Math.round(merged.fontSize * (merged.lineHeight ?? 1.2));
  const defaultMarginV = Math.round(videoH * 0.34);

  const primary = hslToAssColor(merged.primaryHsl);
  const outline = hslToAssColor(merged.outlineHsl);
  const highlight = hslToAssColor(merged.highlightHsl);
  const bgColor = hslToAssColor(merged.bgHsl ?? [0, 0, 0.06]);
  const boxAlpha = opacityToAssAlpha(merged.highlightOpacity ?? 1);
  const bgAlpha = opacityToAssAlpha(merged.bgOpacity ?? 0.72);

  const padX = merged.highlightPaddingX ?? 14;
  const padY = merged.highlightPaddingY ?? 12;
  const radius = merged.highlightRadius ?? 12;
  // Vertical pill height hugs the ARABIC glyph ink (cap to baseline), not the
  // full em. Arabic letters visually occupy ~0.65 of the em square (closer to
  // Latin's 0.645 cap-height than the 0.82 I previously used — that 0.82 was
  // tuned to the em but made the pill tower above/below the word). Coupled with
  // the smaller padY this keeps the top/bottom margins tight around the glyphs.
  const boxHeight = Math.round(merged.fontSize * 0.65) + padY * 2;

  const header = [
    "[Script Info]",
    "; Generated by AI Shorts Studio (Arabic self-aligned karaoke)",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${font},${merged.fontSize},${primary},${primary},${outlineColor},${outlineColor},${merged.bold},0,0,0,100,100,0,0,1,${textOutline},${textShadow},5,${marginH},${marginH},${defaultMarginV},1`,
    `Style: Highlight,${font},${merged.fontSize},${highlight},${highlight},${outline},${outline},${merged.bold},0,0,0,100,100,0,0,1,0,0,5,0,0,${defaultMarginV},1`,
    `Style: BgPill,${font},${merged.fontSize},${bgColor},${bgColor},${outline},${outline},${merged.bold},0,0,0,100,100,0,0,1,0,0,5,0,0,${defaultMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\r\n") + "\r\n";

  if (assLines.length === 0) return header;

  const body: string[] = [];
  const safeRight = videoW - marginH;

  for (const line of assLines) {
    const block = layoutBlock(line.words, merged, videoW, videoH);
    const blockStart = formatAssTime(block.startMs);
    const blockEnd = formatAssTime(block.endMs);
    const blockCenterY = videoH - block.marginV - block.blockHeightPx / 2;

    for (let li = 0; li < block.lines.length; li++) {
      const visual = block.lines[li];
      // Arabic ink ratio: libass shapes connected Arabic glyphs NARROWER than
      // our measured advance-grid (which sums per-char widths + space). Without
      // this shrink the per-word \pos centers spread across the FULL measured
      // line width, while the actual rendered glyphs huddle tightly together —
      // producing the "huge gaps between Arabic words" bug. Shrink measured
      // block/line/offsets/widths by ARABIC_INK_RATIO so the placement grid
      // matches the real glyph footprint, then center as a unit (same trick the
      // English path uses with BOX_WIDTH_INK_RATIO in ass.ts).
      // Calibrated: aggregate real/measured ratio = 0.81 (matches Latin 0.81
      // because the 0.27em Arabic advance in metrics.ts already accounts for
      // the connected-glyph compression).
      const ARABIC_INK_RATIO = 0.81;
      const inkBlockW = block.blockWidthPx * ARABIC_INK_RATIO;
      const inkLineW = visual.widthPx * ARABIC_INK_RATIO;
      const centered = videoW / 2 - inkBlockW / 2 + (inkBlockW - inkLineW) / 2;
      const lineLeftX = Math.max(marginH, Math.min(safeRight - inkLineW, centered));
      const lineCenterY =
        blockCenterY - ((block.lines.length - 1) * lineHeightPx) / 2 + li * lineHeightPx;

      for (let wi = 0; wi < visual.words.length; wi++) {
        const w = visual.words[wi];
        const wordW = visual.wordWidths[wi] * ARABIC_INK_RATIO;
        const wordOffset = visual.wordOffsets[wi] * ARABIC_INK_RATIO;
        const cx = Math.round(lineLeftX + wordOffset + wordW / 2);
        const cy = Math.round(lineCenterY);

        // Pill hugs the ink: shrink measured word width to the ink ratio before
        // adding the per-axis padding. Same scheme as the English pill writer.
        const boxW = Math.round(wordW) + padX * 2;
        const boxH = boxHeight;
        const drawing = roundedRectDrawing(boxW, boxH, radius);
        const boxX = Math.round(cx - boxW / 2);
        const boxY = Math.round(cy - boxH / 2);

        // Layer 0: dark ghost pill (full block). Suppressed when the user
        // toggled "Show inactive word pills" off — the active word's colored
        // highlight (Layer 1) still draws, but inactive words show as plain
        // text with the Default style's outline/shadow for legibility.
        if (showInactiveWordPills) {
          const bgPill = `{\\pos(${boxX},${boxY})\\an7\\1a&H${bgAlpha}&\\3a&HFF&\\4a&HFF&\\bord0\\shad0}${drawing}`;
          body.push(`Dialogue: 0,${blockStart},${blockEnd},BgPill,,0,0,0,,${bgPill}`);
        }

        // Layer 1: highlight pill (word-timed)
        const start = formatAssTime(w.startMs);
        const end = formatAssTime(w.endMs);
        const hlPill = `{\\pos(${boxX},${boxY})\\an7\\1a&H${boxAlpha}&\\3a&HFF&\\4a&HFF&\\bord0\\shad0}${drawing}`;
        body.push(`Dialogue: 1,${start},${end},Highlight,,0,0,0,,${hlPill}`);

        // Layer 2: word text at the SAME center as the pill (full block)
        // Per-word placement = box and glyph cannot drift apart. Run
        // fixRtlPunct so trailing Latin punct sits on the visual END of the
        // Arabic run (LEFT side under \an5) instead of the start (RIGHT).
        // When inactive pills are on, suppress outline/shadow (the dark pill
        // provides contrast). When they're off, let the style-level outline
        // show through so white glyphs stay legible on bright frames.
        //
        // The override block MUST close with `}` BEFORE the word text — a stray
        // closing brace after the text (the prior bug) extended the override
        // block through the Arabic glyphs, libass failed to parse it, and the
        // raw `{\pos(...)}` tags leaked to the screen as literal text. The
        // per-word highlight pill (Layer 1) then appeared un-anchored from its
        // text as a stray purple rectangle, the words split into one Dialogue
        // per tag, and the centered \an5 layout collapsed to top-left stacking.
        const textOverrides = showInactiveWordPills ? `\\bord0\\shad0` : "";
        const wordText = `{\\pos(${cx},${cy})\\an5${textOverrides}}${esc(fixRtlPunct(w.text))}`;
        body.push(`Dialogue: 2,${blockStart},${blockEnd},Default,,0,0,0,,${wordText}`);
      }
    }
  }

  return header + body.join("\r\n") + "\r\n";
}
