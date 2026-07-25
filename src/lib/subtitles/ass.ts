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
 *   2. Emit EVERY word as its own Dialogue event, on BOTH layers, each timed to
 *      the word's CLIP-RELATIVE [startMs, endMs] window:
 *        - Layer 1: the word's TEXT, positioned with `\an5\pos` at the word's
 *          measured center (cx, cy) — `\an5` centers the glyph box on `\pos`.
 *        - Layer 0: a rounded-box highlight for that word, drawn with ASS
 *          vector commands (`\p1`) in top-left-origin coords (0..boxW,
 *          0..boxH), positioned with `\an7\pos` at the box's screen-space
 *          top-left corner `(cx - boxW/2, cy - boxH/2)`. Under `\an7` the
 *          drawing origin `(0,0)` lands exactly at `\pos` (no ascent-offset),
 *          so the box is centered on the SAME (cx, cy) as the text. libass has
 *          no native rounded box so we draw it ourselves. (`\an5` would
 *          shift a centered drawing up by ~half the line height — verified.)
 *
 * Because the text (`\an5` at (cx,cy)) and the box (`\an7` top-left derived
 * from the same (cx,cy)) both target the word's measured center, the box always
 * lands under the word regardless of the font's ascent/descent metrics (we
 * never rely on libass's `\N` line-stacking whose baseline math we can't
 * replicate in JS). And because both layers are timed to the word's ABSOLUTE
 * window, the highlight is always synced to the spoken word — there is no
 * cumulative-`\k` drift when Whisper word timings have gaps. This is the
 * per-event positioning approach libass maintainers recommend (issue #625).
 * The active-word cue comes from the box being on screen exactly while its word
 * is spoken; for `animationStyle: "pop"` the word scales in (150->100% via
 * `\t`) and the box fades in (`\fad`) in step. Times are CLIP-RELATIVE (0-based)
 * so the burn-in filter and the trimmed source share a timeline.
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

  // Compute each line's laid-out block geometry (lines + per-word offsets).
  const laid: LaidBlock[] = lines.map((ln) => layoutBlock(ln.words, style, videoW, videoH));

  // Styles: every per-word Dialogue overrides both alignment (\an5 = center)
  // and position (\pos) per-event, so the Default style's alignment/margins
  // are largely inert — we keep alignment 2 + a nominal MarginV only as a
  // sane fallback if a renderer ever ignores per-event tags. WrapStyle 2 =
  // no auto-wrap (breaks are explicit: one event per word, no \N). BorderStyle
  // 1 = outline + shadow. The Highlight style drives the box drawing layer;
  // its alignment is center (5) and per-event \pos places each box.
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
    `Style: Default,${style.font},${style.fontSize},${primary},${primary},${outline},${outline},${style.bold},0,0,0,100,100,0,0,1,${style.outline},${style.shadow},2,${marginH},${marginH},${defaultMarginV},1`,
    `Style: Highlight,${style.font},${style.fontSize},${highlight},${highlight},${outline},${outline},${style.bold},0,0,0,100,100,0,0,1,0,0,5,0,0,${defaultMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\r\n") + "\r\n";

  const body: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    const block = laid[li];

    // Per-word emit. Both the text (layer 1) and the highlight box (layer 0)
    // are emitted as ONE Dialogue per word, each timed to that word's CLIP-
    // RELATIVE [startMs, endMs] and positioned with \an5\pos at the word's
    // measured center (cx, cy). Because the text and the box for a word share
    // the SAME \pos, the box is guaranteed to sit under the word regardless
    // of the font's ascent/descent metrics — we no longer rely on libass's
    // \N line-stacking (whose baseline math we can't replicate in JS).
    //
    // Timing is also shared and ABSOLUTE per word on both layers, so there is no
    // cumulative-\k drift: when Whisper word timings have gaps/overlaps, the
    // box and the (now per-word) text both appear at that word's exact window.
    // This is the approach libass maintainers recommend for per-line positioning
    // (issue #625) and it doubles as the fix for both observed bugs (box not
    // under text; box not synced to speech).
    for (let li2 = 0; li2 < block.lines.length; li2++) {
      const visual = block.lines[li2];
      // Screen x of this visual line's LEFT edge (block is centered as a unit;
      // each visual line is centered within the block width). For degenerate
      // over-wide blocks (a line wider than the safe band), clamp the line into
      // the safe band so no word/box renders off-screen — a long line
      // left-aligns at the safe margin rather than centering off-screen.
      const safeRight = videoW - marginH;
      const centered = videoW / 2 - block.blockWidthPx / 2 + (block.blockWidthPx - visual.widthPx) / 2;
      const lineLeftX = Math.max(marginH, Math.min(safeRight - visual.widthPx, centered));
      // Screen y of this visual line's CENTER, derived directly from the
      // anchor (not from libass's \N stacking): block center sits at
      // anchorY*videoH (+ legacy marginV nudge via block.marginV), and the k
      // visual lines stack lineHeightPx apart around it. Since BOTH the text
      // and box events for this line use this cy with \an5, they coincide by
      // construction; the value just needs to be visually centered, which the
      // existing anchor math provides.
      const blockCenterY = videoH - block.marginV - block.blockHeightPx / 2;
      const lineCenterY =
        blockCenterY - ((block.lines.length - 1) * lineHeightPx) / 2 + li2 * lineHeightPx;

      for (let wi = 0; wi < visual.words.length; wi++) {
        const w = visual.words[wi];
        const wordW = visual.wordWidths[wi];
        const wordOffset = visual.wordOffsets[wi];
        const cx = lineLeftX + wordOffset + wordW / 2;
        const cy = lineCenterY;
        const start = formatAssTime(w.startMs);
        const end = formatAssTime(w.endMs);
        // Layer 1: the word's text, centered at (cx, cy), on screen only while
        // spoken. No \k (each event IS exactly one word) and no \N (each visual
        // line is its own row of per-word events). For `pop`, scale the word in
        // 150%->100% over popMs. Outline/shadow come from the Default style.
        const wordAnim = usePop
          ? `\\t(0,${popMs},\\fscx150\\fscy150\\fscx100\\fscy100)`
          : "";
        const textText = `{\\pos(${Math.round(cx)},${Math.round(cy)})\\an5${wordAnim}}${esc(w.text)}`;
        body.push(`Dialogue: 1,${start},${end},Default,,0,0,0,,${textText}`);

        // Layer 0: the rounded highlight box for THIS word, centered on the
        // SAME (cx, cy) as the text so it sits directly behind it. Box sized
        // to the measured word width + padding. The drawing path uses
        // TOP-LEFT-origin coords (0..boxW, 0..boxH) and the Dialogue uses
        // \an7\pos at the box's screen top-left corner — under \an7 the
        // drawing origin lands exactly at \pos (no ascent-offset like \an5),
        // so the box is vertically centered on the text. Outline/shadow
        // disabled so only the fill shows. For `pop`, fade the box in over
        // popMs alongside the word's scale.
        const padX = style.highlightPaddingX ?? 12;
        const padY = style.highlightPaddingY ?? 6;
        const radius = style.highlightRadius ?? 16;
        const boxW = wordW + padX * 2;
        const boxH = style.fontSize + padY * 2;
        const drawing = roundedRectDrawing(boxW, boxH, radius);
        const boxFade = usePop ? `\\fad(${popMs},0)` : "";
        // Box uses `\an7` (top-left anchor) with `\pos` at the box's screen
        // top-left corner and a top-left-origin drawing path. Under `\an7` the
        // drawing origin `(0,0)` lands exactly at `\pos`, so the box (0..boxW,
        // 0..boxH) is centered on the text's (cx, cy). `\an5` would instead
        // shift the centered drawing up by ~half the line height (verified),
        // leaving the box floating above the word.
        const boxX = Math.round(cx - boxW / 2);
        const boxY = Math.round(cy - boxH / 2);
        const boxText = `{\\pos(${boxX},${boxY})\\an7${boxFade}\\1a&H${boxAlpha}&\\3a&HFF&\\4a&HFF&\\bord0\\shad0}${drawing}`;
        body.push(`Dialogue: 0,${start},${end},Highlight,,0,0,0,,${boxText}`);
      }
    }
  }

  return header + body.join("\r\n") + "\r\n";
}

export type { LaidBlock } from "@/lib/subtitles/layout";
