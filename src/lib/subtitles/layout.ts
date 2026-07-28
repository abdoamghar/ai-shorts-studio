import "server-only";

import { availableWidth, measureText } from "@/lib/subtitles/metrics";
import type { AssWord } from "@/lib/subtitles/ass";
import type { StyleJson } from "@/lib/subtitles/themes";

/**
 * Premium subtitle line/block layout.
 *
 * Replaces the old character-count heuristic (`lines.ts`) for the ASS path:
 * words are measured in real ASS pixels (via the font-metrics table), greedily
 * filled onto lines up to the safe-margin band, then the breaks are balanced so
 * consecutive lines are within ~15% width of each other. Lines are capped at
 * `style.maxLines` (≤3 per the premium spec). The whole block is bottom-center
 * anchored at `anchorY` of the video height (default ~65% down) so it always
 * sits in the lower-middle, clear of top + bottom TikTok UI.
 *
 * `lines.ts` (greedy char-count) is kept for the SRT companion/export path,
 * where plain wrapped text is acceptable.
 */

export type LaidLine = {
  /** Words composing this line (with clip-relative timing for karaoke). */
  words: AssWord[];
  /** Joined display text, single spaces. */
  text: string;
  /** Measured rendered width of `text`, ASS px at PlayResY=1920. */
  widthPx: number;
  /** Per-word x-offsets relative to the line's LEFT edge (starts at 0). */
  wordOffsets: number[];
  /** Per-word measured widths (without trailing space), ASS px. */
  wordWidths: number[];
};

export type LaidBlock = {
  /** Laid-out visual lines (1..maxLines). */
  lines: LaidLine[];
  /** Clip-relative block start, ms (first word start). */
  startMs: number;
  /** Clip-relative block end, ms (last word end). */
  endMs: number;
  /** Max line width across all lines (ASS px) — the block's visual width. */
  blockWidthPx: number;
  /** Estimated block height (ASS px) given line count + lineHeight + fontSize. */
  blockHeightPx: number;
  /** ASS MarginV value to use so a bottom-aligned block sits at anchorY. */
  marginV: number;
  /** ASS left/right margin (equal, the safe margin in ASS px). */
  marginH: number;
  /** Video width the layout was computed for. */
  videoW: number;
};

/** Trailing space width between words (em at fontSize). */
const SPACE_EM = 0.278;

/** Build a line's geometry from its words using the real font metrics. */
function buildLine(
  words: AssWord[],
  fontKey: string,
  fontSize: number,
  bold: number,
  spacePx: number,
): LaidLine {
  const wordWidths = words.map((w) => measureText(w.text, fontKey, fontSize, bold));
  const wordOffsets: number[] = [];
  let x = 0;
  for (let i = 0; i < words.length; i++) {
    wordOffsets.push(x);
    x += wordWidths[i] + (i === words.length - 1 ? 0 : spacePx);
  }
  return {
    words,
    text: words.map((w) => w.text).join(" "),
    widthPx: x,
    wordOffsets,
    wordWidths,
  };
}

/**
 * Lay out a single subtitle block (one ASS Dialogue event's worth of words).
 * `words` are CLIP-RELATIVE (already shifted by clipStart). Returns lines +
 * the geometry the ASS writer needs to center the block and place per-word
 * rounded-box highlights.
 */
export function layoutBlock(
  words: AssWord[],
  style: StyleJson,
  videoW = 1080,
  videoH = 1920,
): LaidBlock {
  const maxLines = Math.min(3, Math.max(1, style.maxLines));
  const fontKey = style.fontMetricsKey ?? style.font ?? "inter-bold";
  const fontSize = style.fontSize;
  const bold = style.bold;
  const safeMarginPct = style.safeMarginPct ?? 0.09;
  const maxBlockWidthPct = style.maxBlockWidthPct ?? 0.82;

  const usable = availableWidth(videoW, safeMarginPct);
  const maxBlockWidth = Math.min(
    Math.round(videoW * Math.min(0.95, Math.max(0.5, maxBlockWidthPct))),
    usable,
  );
  const spacePx = Math.round((style.wordSpacingEm ?? SPACE_EM) * fontSize * 1.03);

  const maxChars = style.maxChars ?? 30;

  // First pass: greedy fill onto up to `maxLines` lines. A single word that
  // alone exceeds the usable band still gets its own line (we never shrink the
  // font per spec — one long word may overflow the margin, accepted). Once we
  // have `maxLines` full lines, any remaining words merge onto the LAST line
  // (we never exceed `maxLines`).
  const partitions: AssWord[][] = [];
  let cur: AssWord[] = [];
  let curWidth = 0;
  for (let i = 0; i < words.length; i++) {
    const wOnly = measureText(words[i].text, fontKey, fontSize, bold);
    const wWithSpace = wOnly + (cur.length === 0 ? 0 : spacePx);
    const curChars = cur.map(w => w.text).join(" ").length;
    const charsWithNext = curChars > 0 ? curChars + 1 + words[i].text.length : words[i].text.length;
    const wouldOverflow = cur.length > 0 && (curWidth + wWithSpace > usable || charsWithNext > maxChars);
    
    if (wouldOverflow) {
      partitions.push(cur);
      // If that was the last allowed line, spill the rest onto it and stop —
      // `maxLines` is a hard cap.
      if (partitions.length >= maxLines) {
        const last = partitions[partitions.length - 1];
        for (let j = i; j < words.length; j++) last.push(words[j]);
        cur = [];
        curWidth = 0;
        break;
      }
      cur = [words[i]];
      curWidth = wOnly;
    } else {
      cur.push(words[i]);
      curWidth += wWithSpace;
    }
  }
  if (cur.length > 0) partitions.push(cur);

  const lines: LaidLine[] = partitions.map((p) => buildLine(p, fontKey, fontSize, bold, spacePx));

  // RTL: keep speaking/logical word order for karaoke timing, but flip each
  // word's x-offset so the first word sits on the RIGHT (Arabic reading order).
  // English (ltr) path is unchanged.
  if (style.direction === "rtl") {
    for (const line of lines) {
      line.wordOffsets = line.wordOffsets.map(
        (offset, i) => line.widthPx - offset - line.wordWidths[i],
      );
    }
  }

  // Second pass: BALANCE breaks so consecutive lines are within ~15% width.
  // Move the FIRST word of a (non-final) line to the END of the previous line
  // if doing so reduces the width delta and keeps every line ≤ maxBlockWidth
  // and ≤ usable, while leaving the receiving line with ≥1 word. Repeat until
  // stable or a small guard count.
  if (lines.length > 1 && lines.length < maxLines) {
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 8) {
      improved = false;
      for (let l = 0; l < lines.length - 1; l++) {
        const a = lines[l];
        const b = lines[l + 1];
        if (b.words.length <= 1) continue;
        const movedOnly = b.wordWidths[0];
        // Width contribution of the moved word to line a (as its new last word):
        // a trailing space then the word itself.
        const movedAddedToA = (a.words.length > 0 ? spacePx : 0) + movedOnly;
        // Width removed from line b: the leading word + its trailing space
        // (its trailing space joins the new first word, so it disappears).
        const movedRemovedFromB = movedOnly + (b.words.length > 1 ? spacePx : 0);
        const newAWidth = a.widthPx + movedAddedToA;
        const newBWidth = b.widthPx - movedRemovedFromB;
        const oldDelta = Math.abs(a.widthPx - b.widthPx);
        const newDelta = Math.abs(newAWidth - newBWidth);
        if (
          newDelta < oldDelta &&
          newAWidth <= maxBlockWidth &&
          newBWidth <= maxBlockWidth &&
          newAWidth <= usable &&
          newBWidth >= 0 &&
          a.words.length + 1 >= 1 &&
          b.words.length - 1 >= 1
        ) {
          const moved = b.words[0];
          a.words = [...a.words, moved];
          b.words = b.words.slice(1);
          lines[l] = buildLine(a.words, fontKey, fontSize, bold, spacePx);
          lines[l + 1] = buildLine(b.words, fontKey, fontSize, bold, spacePx);
          improved = true;
        }
      }
    }
  }

  const blockWidthPx = Math.max(0, ...lines.map((l) => l.widthPx));
  const lineHeightMul = style.lineHeight ?? 1.0;
  const blockHeightPx = Math.round(lines.length * fontSize * lineHeightMul);

  // Bottom-center anchor: MarginV is distance from the BOTTOM. To place the
  // block's visual CENTER at `anchorY * videoH`, the bottom of the block is at
  // anchorY + blockHeight/2, so MarginV = videoH - (anchorY + blockHeight/2).
  const anchorY = (style.anchorY ?? 0.65) * videoH;
  // Reserve a small downward nudge from a legacy positive `style.marginV` so
  // old themes that set marginV for bottom spacing still push subs slightly
  // lower — clamped so we never go off-screen or flip above the anchor. This
  // also gives a future face-avoidance step a knob without a schema change.
  const anchorNudge =
    typeof style.marginV === "number" && style.marginV > 0
      ? Math.min(style.marginV * 0.15, videoH * 0.05)
      : 0;
  const centerY = anchorY + anchorNudge;
  const marginV = Math.round(videoH - (centerY + blockHeightPx / 2));
  const marginH = Math.round(videoW * safeMarginPct);

  return {
    lines,
    startMs: words.length ? words[0].startMs : 0,
    endMs: words.length ? words[words.length - 1].endMs : 0,
    blockWidthPx,
    blockHeightPx,
    marginV,
    marginH,
    videoW,
  };
}
