import "server-only";

import { layoutBlock, type LaidBlock } from "@/lib/subtitles/layout";
import type { StyleJson } from "@/lib/subtitles/themes";

/**
 * ASS (Advanced SubStation Alpha) subtitle writer for libass, premium layout.
 *
 * For each subtitle block we:
 *   1. Lay the words out (`layoutBlock`): measure, greedy-wrap to the safe
 *      band, balance breaks, cap at ≤3 lines, anchor the block's center at
 *      `anchorY * videoH` (lower-middle, ~65% — clear of TikTok UI).
 *   2. Layering — two modes controlled by `style.wordPillMode`:
 *
 *   MODE: "none" (classic karaoke — default for old themes)
 *     - Layer 2 (text): ONE Dialogue per VISUAL LINE holding all its words,
 *       centered, on screen for the ENTIRE block window. Ghost line.
 *     - Layer 0 (box): one rounded-box highlight per WORD, timed to its
 *       [start,end]. Only the active word gets a colored box.
 *     - Layer 1 (pop overlay, `animationStyle: "pop"` only): active word text
 *       scales 150->100 while the rest stays put (MrBeast kinetic pop).
 *
 *   MODE: "all" (viral word-pill style — every word has its own dark pill)
 *     - Layer 0 (dark ghost pills): one rounded dark-fill box per WORD, on
 *       screen for the ENTIRE block window [blockStart, blockEnd]. All words
 *       always have a dark background pill visible.
 *     - Layer 1 (highlight pill): one rounded highlight-color box per WORD,
 *       timed only to that word's [start,end]. This opaque colored pill
 *       overlays the dark ghost pill for the currently-spoken word.
 *     - Layer 2 (text): ONE Dialogue per VISUAL LINE, centered, on screen for
 *       the ENTIRE block window. NO outline or shadow — the pills handle
 *       legibility. Text is always fully visible on top of the pills.
 *
 * Because the ghost line and the per-word boxes both derive from the same
 * measured layout, the box always lands behind its word regardless of the
 * font's ascent/descent metrics. Times are CLIP-RELATIVE (0-based).
 */

export type AssWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type AssLine = {
  /** Clip-relative start, ms. */
  startMs: number;
  /** Clip-relative end, ms. */
  endMs: number;
  words: AssWord[];
};

/** HSL [h(0-360), s(0-1), l(0-1)] -> ASS &HAABBGGRR (AA=00 opaque). */
export function hslToAssColor(hsl: [number, number, number]): string {
  const [h, s, l] = hsl;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp < 6) [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  // ASS stores BGR with alpha as ABGR hex; alpha 00 = opaque (libass convention).
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `&H00${toHex(b)}${toHex(g)}${toHex(r)}`.toUpperCase();
}

/** Opacity 0-1 (1=opaque) -> ASS alpha byte (&HAA&); 00=opaque, FF=transparent. */
function opacityToAssAlpha(opacity: number): string {
  const a = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255);
  return a.toString(16).padStart(2, "0").toUpperCase();
}

function formatAssTime(ms: number): string {
  // libass uses H:MM:SS.cs (centiseconds).
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

/** Escape text for ASS dialogue (commas are field separators; strip braces). */
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{|\}/g, "").replace(/\n/g, "\\N");
}

/**
 * Build a rounded-rectangle ASS vector drawing in TOP-LEFT-origin coordinates:
 * the path spans `(0,0) .. (w, h)` (positive x/y, origin at the top-left
 * corner), with corner radius `r` (clamped to half the smaller dimension).
 * Returns the `{\p1}...{\p}` drawing string.
 *
 * The box is emitted on a Layer-0 Dialogue that uses `\an7` (top-left anchor)
 * with `\pos` set to the box's screen-space top-left corner. Under `\an7` the
 * drawing origin `(0,0)` coincides with the `\pos` point — there is NO
 * ascent-offset the way `\an5` shifts a centered drawing up by ~half the line
 * height (empirically verified: a `\p1` box at `\an5\pos(540,1226)` centered
 * at origin rendered ~50px above the `\pos` y). `\an7` + top-left `\pos` makes
 * the box land exactly behind the word, vertically centered on its text.
 *
 * libass vector drawing uses `m`/`l` path commands in script-resolution units
 * relative to the event's `\pos`. libass has no native arc, so each corner is
 * approximated as a small polygonal arc (N straight segments sampled along the
 * quarter circle). N=6 is smooth enough at 1080p while keeping the path short.
 * The path is a single closed, non-self-intersecting clockwise outline, which
 * libass fills cleanly with the default even-odd-free winding.
 */
function roundedRectDrawing(w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const N = 6; // segments per corner arc
  const rnd = (n: number) => Math.round(n).toString();

  // Quarter-arc from angle a0 to a1 (degrees, CCW from +x) about center
  // (cx, cy) with radius r, as N `l` segments.
  const arc = (cx: number, cy: number, a0: number, a1: number): string => {
    let s = "";
    for (let i = 1; i <= N; i++) {
      const a = (a0 + ((a1 - a0) * i) / N) * (Math.PI / 180);
      s += ` l ${rnd(cx + r * Math.cos(a))} ${rnd(cy + r * Math.sin(a))}`;
    }
    return s;
  };

  // Clockwise outline in top-left-origin coords: top edge -> TR arc
  // (270°->360°) -> right edge -> BR arc (0°->90°) -> bottom edge ->
  // BL arc (90°->180°) -> left edge -> TL arc (180°->270°) -> close.
  // We start the `m` at the end of the TL arc (top edge's left end).
  //
  // NOTE: the tags MUST be emitted as literal `\p1` and `\p` on disk for
  // libass to enter/leave vector-drawing mode. In a JS template literal a
  // single `\p` is an unrecognized escape and the backslash is STRIPPED
  // (yielding `{p1}`), which libass then renders as literal text — the
  // drawing path digits appear on screen. Use `\\p` so the runtime string
  // keeps the single backslash libass requires.
  let path = `m ${rnd(r)} 0`;
  path += ` l ${rnd(w - r)} 0`; // top edge
  path += arc(w - r, r, 270, 360); // TR
  path += ` l ${rnd(w)} ${rnd(h - r)}`; // right edge
  path += arc(w - r, h - r, 0, 90); // BR
  path += ` l ${rnd(r)} ${rnd(h)}`; // bottom edge
  path += arc(r, h - r, 90, 180); // BL
  path += ` l 0 ${rnd(r)}`; // left edge
  path += arc(r, r, 180, 270); // TL
  return `{\\p1}${path}{\\p}`;
}

/**
 * Build a full `.ass` document for the given (clip-relative) lines using the
 * premium centered layout + rounded-box per-word highlight.
 */
export function buildAss(lines: AssLine[], style: StyleJson): string {
  const primary = hslToAssColor(style.primaryHsl);
  const outline = hslToAssColor(style.outlineHsl);
  const highlight = hslToAssColor(style.highlightHsl);
  const boxAlpha = opacityToAssAlpha(style.highlightOpacity ?? 1);

  // Word-pill mode: "all" = every word always has a dark ghost pill, and the
  // active word gets a colored highlight pill on top. "none" (default) = only
  // the active word gets a highlight pill (classic karaoke behavior).
  const pillMode = style.wordPillMode ?? "none";
  const usePills = pillMode === "all";

  // Background pill color + opacity (only relevant when usePills = true).
  const bgColor = hslToAssColor(style.bgHsl ?? [0, 0, 0.06]);
  const bgAlpha = opacityToAssAlpha(style.bgOpacity ?? 0.7);

  const videoW = 1080;
  const videoH = 1920;
  // Safe margins (ASS px); reused for the style's MarginL/MarginR.
  const marginH = Math.round(videoW * (style.safeMarginPct ?? 0.09));
  const lineHeightPx = Math.round(style.fontSize * (style.lineHeight ?? 1.0));
  const defaultMarginV = Math.round(videoH * 0.34); // fallback; per-event overrides
  // Per-word pop-in animation (MrBeast kinetic). `pop` drives two things per
  // active word: the word's text scales from 150% to 100% over `popMs`, and
  // its rounded highlight box fades+cycles in over the same window. `popMs`
  // derives from `animationSpeed` (faster speed => snappier pop); clamped so
  // it never exceeds ~half a short syllable. `none` => no transform applied.
  const usePop = style.animationStyle === "pop";
  const popMs = Math.max(
    40,
    Math.min(220, Math.round(140 / Math.max(0.1, style.animationSpeed))),
  );

  // Empirical glyph-box calibration. The measured word width (from the font
  // metrics table in metrics.ts) sums per-character ADVANCE widths + a 3%
  // safety inflation, which overstates the actual glyph ink footprint — the
  // advance cell includes the side-bearing (whitespace built into each glyph)
  // that consecutive glyphs overlap into, so the summed advance is wider than
  // the rendered ink. Rendered vs measured across all-latin words is a stable
  // ~0.81 (verified for KNOW 224/278, AMAZING 336/408, REMEMBER 420/517 — all
  // within ±1%). We shrink the box width to that ratio so the highlight hugs
  // the visible letters rather than the wider advance footprint.
  //
  // Vertically, `fontSize` is the full em square (ascender+descender), but
  // Latin caps/digits/x-height only occupy the cap-height region. Measured
  // Arial-Bold glyph height for fontSize 82 is ~53px = ~0.645*fontSize
  // (consistent across the same words). Box height uses that ratio so the box
  // doesn't tower above/below the letters. Both ratios are for the Arial /
  // Arial-BoldMT render path libass actually uses (Inter isn't installed;
  // DirectWrite substitutes Inter->Arial — see metrics.ts).
  const BOX_WIDTH_INK_RATIO = 0.81;
  const BOX_HEIGHT_INK_RATIO = 0.645;

  // Compute each line's laid-out block geometry (lines + per-word offsets).
  const isUpper = style.uppercase === true;
  const processedLines = isUpper
    ? lines.map((ln) => ({
        ...ln,
        words: ln.words.map((w) => ({ ...w, text: w.text.toUpperCase() })),
      }))
    : lines;
  const laid: LaidBlock[] = processedLines.map((ln) => layoutBlock(ln.words, style, videoW, videoH));

  // When word-pill mode is "all" we suppress the text outline/shadow on the
  // Default style because the dark ghost pills provide the legibility contrast.
  // The Highlight style (used for drawing boxes) always has bord0/shad0.
  const textOutline = usePills ? 0 : style.outline;
  const textShadow = usePills ? 0 : style.shadow;

  // Styles: the ghost line (Layer 2) and the pop overlay (Layer 1) use the
  // Default style; the per-word rounded box (Layer 0/1 depending on mode) uses
  // Highlight. Every per-event Dialogue overrides alignment (\an5/\an7) and
  // position (\pos), so the style-level alignment/margins are largely inert —
  // we keep alignment 2 + a nominal MarginV only as a sane fallback if a
  // renderer ever ignores per-event tags. WrapStyle 2 = no auto-wrap (each
  // visual line is its own Dialogue; words stay on one row). BorderStyle 1 =
  // outline + shadow. The Highlight style drives the box drawing layer.
  const header = [
    "[Script Info]",
    "; Generated by AI Shorts Studio",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.font},${style.fontSize},${primary},${primary},${outline},${outline},${style.bold},0,0,0,100,100,0,0,1,${textOutline},${textShadow},2,${marginH},${marginH},${defaultMarginV},1`,
    `Style: Highlight,${style.font},${style.fontSize},${highlight},${highlight},${outline},${outline},${style.bold},0,0,0,100,100,0,0,1,0,0,5,0,0,${defaultMarginV},1`,
    `Style: BgPill,${style.font},${style.fontSize},${bgColor},${bgColor},${outline},${outline},${style.bold},0,0,0,100,100,0,0,1,0,0,5,0,0,${defaultMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\r\n") + "\r\n";

  const body: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    const block = laid[li];

    // Layout geometry shared by the ghost line + per-word boxes.
    const safeRight = videoW - marginH;
    const blockStart = formatAssTime(block.startMs);
    const blockEnd = formatAssTime(block.endMs);
    const blockCenterY = videoH - block.marginV - block.blockHeightPx / 2;
    for (let li2 = 0; li2 < block.lines.length; li2++) {
      const visual = block.lines[li2];
      // Screen x of this visual line's LEFT edge (block is centered as a unit;
      // each visual line is centered within the block width). For degenerate
      // over-wide blocks (a line wider than the safe band), clamp the line into
      // the safe band so no word/box renders off-screen — a long line
      // left-aligns at the safe margin rather than centering off-screen.
      //
      // IMPORTANT: libass centers the REAL text at pos(lineCenterX) using the
      // real font's advance widths, which our JS metrics table only ESTIMATES
      // (and over-estimates — see BOX_WIDTH_INK_RATIO). The real glyph ink is
      // a stable 0.81x of our measured width, so to make our per-word box
      // CENTERS line up with the real glyph centers, we build the layout from
      // an ink-scaled geometry: scale the measured block/line width and the
      // per-word offsets/widths by the ink ratio, then center that. The scaled
      // geometry matches the real text's centered footprint, so cx (computed
      // from the scaled offsets) lands under the real glyph.
      const inkBlockW = block.blockWidthPx * BOX_WIDTH_INK_RATIO;
      const inkLineW = visual.widthPx * BOX_WIDTH_INK_RATIO;
      const centered =
        videoW / 2 - inkBlockW / 2 + (inkBlockW - inkLineW) / 2;
      const lineLeftX = Math.max(marginH, Math.min(safeRight - inkLineW, centered));
      // Screen y of this visual line's CENTER, derived directly from the
      // anchor (not from libass's \N stacking): block center sits at
      // anchorY*videoH (+ marginV nudge via block.marginV), and the k visual
      // lines stack lineHeightPx apart around it.
      const lineCenterY =
        blockCenterY - ((block.lines.length - 1) * lineHeightPx) / 2 + li2 * lineHeightPx;
      const lineCenterX = lineLeftX + inkLineW / 2;

      // Pill geometry constants (shared across all word pills on this line).
      const padX = style.highlightPaddingX ?? 12;
      const padY = style.highlightPaddingY ?? 6;
      const radius = style.highlightRadius ?? 16;

      if (usePills) {
        // =====================================================================
        // PILL MODE "all": Every word has a dark ghost pill (Layer 0, always on
        // for the full block). Active word gets a violet highlight pill
        // (Layer 1, timed to the word). Text layer (Layer 2) has no outline.
        // =====================================================================

        // --- Layer 0: Dark ghost pills for ALL words (full block duration) ---
        for (let wi = 0; wi < visual.words.length; wi++) {
          const wordW = visual.wordWidths[wi];
          const wordOffset = visual.wordOffsets[wi];
          const cx = lineLeftX + (wordOffset + wordW / 2) * BOX_WIDTH_INK_RATIO;
          const cy = lineCenterY;

          const boxW = Math.round(wordW * BOX_WIDTH_INK_RATIO) + padX * 2;
          const boxH = Math.round(style.fontSize * BOX_HEIGHT_INK_RATIO) + padY * 2;
          const drawing = roundedRectDrawing(boxW, boxH, radius);
          const boxX = Math.round(cx - boxW / 2);
          const boxY = Math.round(cy - boxH / 2);

          // BgPill style: dark fill, no border, no shadow, always visible.
          const bgPillText = `{\\pos(${boxX},${boxY})\\an7\\1a&H${bgAlpha}&\\3a&HFF&\\4a&HFF&\\bord0\\shad0}${drawing}`;
          body.push(`Dialogue: 0,${blockStart},${blockEnd},BgPill,,0,0,0,,${bgPillText}`);
        }

        // --- Layer 1: Highlight pills for ACTIVE word (word timing) ---
        for (let wi = 0; wi < visual.words.length; wi++) {
          const w = visual.words[wi];
          const wordW = visual.wordWidths[wi];
          const wordOffset = visual.wordOffsets[wi];
          const cx = lineLeftX + (wordOffset + wordW / 2) * BOX_WIDTH_INK_RATIO;
          const cy = lineCenterY;
          const start = formatAssTime(w.startMs);
          const end = formatAssTime(w.endMs);

          const boxW = Math.round(wordW * BOX_WIDTH_INK_RATIO) + padX * 2;
          const boxH = Math.round(style.fontSize * BOX_HEIGHT_INK_RATIO) + padY * 2;
          const drawing = roundedRectDrawing(boxW, boxH, radius);
          const boxX = Math.round(cx - boxW / 2);
          const boxY = Math.round(cy - boxH / 2);

          // Highlight style: colored fill, no border, no shadow, word-timed.
          const hlPillText = `{\\pos(${boxX},${boxY})\\an7\\1a&H${boxAlpha}&\\3a&HFF&\\4a&HFF&\\bord0\\shad0}${drawing}`;
          body.push(`Dialogue: 1,${start},${end},Highlight,,0,0,0,,${hlPillText}`);
        }

        // --- Layer 2: Text ghost line (all words, full block duration) ---
        // No outline/shadow in pill mode — the dark pill backgrounds provide
        // the contrast. Text renders on top of both pill layers.
        const lineText = `{\\pos(${Math.round(lineCenterX)},${Math.round(lineCenterY)})\\an5\\bord0\\shad0}${esc(visual.text)}`;
        body.push(`Dialogue: 2,${blockStart},${blockEnd},Default,,0,0,0,,${lineText}`);

      } else {
        // =====================================================================
        // CLASSIC MODE "none": Only the active word gets a highlight box.
        // Text has outline + shadow from the style. Original behavior.
        // =====================================================================

        // --- Layer 2: the persistent ghost line (ALL words visible the whole
        // block). One Dialogue per visual line, timed to the block window, text
        // centered via \an5\pos. This is the line you read; the per-word accent
        // box steps across it in time with speech. Outline/shadow from style. ---
        const lineText = `{\\pos(${Math.round(lineCenterX)},${Math.round(lineCenterY)})\\an5}${esc(
          visual.text,
        )}`;
        body.push(`Dialogue: 2,${blockStart},${blockEnd},Default,,0,0,0,,${lineText}`);

        // --- Per-word Layer 0 box (accent stepping) + Layer 1 pop overlay. ---
        for (let wi = 0; wi < visual.words.length; wi++) {
          const w = visual.words[wi];
          const wordW = visual.wordWidths[wi];
          const wordOffset = visual.wordOffsets[wi];
          // cx uses the measured offset/width scaled to the ink ratio (see the
          // ink-scaled geometry above) so the box center matches the real glyph
          // center that libass lays out, not the over-estimated measured center.
          const cx =
            lineLeftX + (wordOffset + wordW / 2) * BOX_WIDTH_INK_RATIO;
          const cy = lineCenterY;
          const start = formatAssTime(w.startMs);
          const end = formatAssTime(w.endMs);

          // Layer 0: rounded highlight box for THIS word, centered on (cx, cy).
          // Drawing path is top-left-origin (0..boxW, 0..boxH) and the Dialogue
          // uses \an7\pos at the box's screen top-left corner — under \an7 the
          // drawing origin `(0,0)` lands exactly at \pos (no ascent-offset), so
          // the box centers on the text. Outline/shadow disabled so only the
          // fill shows. For `pop`, fade the box in over popMs.
          // Box hugs the rendered glyph ink, not the wider advance footprint:
          // shrink the measured word width to the ink ratio, then add padding.
          // Vertically the box uses cap-height (not the full em) + padding, so it
          // doesn't tower above/below the caps. Both ratios are calibrated against
          // the actual Arial-BoldMT render path (see BOX_*_INK_RATIO above).
          const boxW = Math.round(wordW * BOX_WIDTH_INK_RATIO) + padX * 2;
          const boxH = Math.round(style.fontSize * BOX_HEIGHT_INK_RATIO) + padY * 2;
          const drawing = roundedRectDrawing(boxW, boxH, radius);
          const boxFade = usePop ? `\\fad(${popMs},0)` : "";
          const boxX = Math.round(cx - boxW / 2);
          const boxY = Math.round(cy - boxH / 2);
          const boxText = `{\\pos(${boxX},${boxY})\\an7${boxFade}\\1a&H${boxAlpha}&\\3a&HFF&\\4a&HFF&\\bord0\\shad0}${drawing}`;
          body.push(`Dialogue: 0,${start},${end},Highlight,,0,0,0,,${boxText}`);

          // Layer 1 (pop overlay only): a copy of the active word's text placed
          // exactly over the ghost line's glyph for that word (same cx, cy),
          // timed to the word's window, with a \t scale 150->100 over popMs so
          // only the spoken word pops while the rest of the line stays flat.
          // The overlay tracks the box (fades over popMs) to mask its abrupt
          // appearance and keep the pop crisp.
          if (usePop) {
            const wordAnim = `\\t(0,${popMs},\\fscx150\\fscy150\\fscx100\\fscy100)`;
            const overlayText = `{\\pos(${Math.round(cx)},${Math.round(
              cy,
            )})\\an5${wordAnim}\\fad(${popMs},0)}${esc(w.text)}`;
            body.push(`Dialogue: 1,${start},${end},Default,,0,0,0,,${overlayText}`);
          }
        }
      }
    }
  }

  return header + body.join("\r\n") + "\r\n";
}

export type { LaidBlock } from "@/lib/subtitles/layout";
