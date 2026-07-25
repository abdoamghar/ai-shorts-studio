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
 *   2. Emit the karaoke text line on layer 1 (centered, \\N between visual
 *      lines) with the classic per-word \\k timing. Per spec the highlighted
 *      word's text stays white and the box (layer 0) carries the accent color.
 *   3. Emit a rounded-box highlight for the active word on layer 0, drawn with
 *      ASS vector commands (`\\p1`), sized to the measured word width + padding,
 *      positioned with `\\pos` so it hugs the word exactly. This is the
 *      Vozo/Captions signature look; libass has no native rounded box so we
 *      draw the rounded rectangle ourselves.
 *
 * The box follows the karaoke: at any playback time the box sits under whatever
 * word's window is currently active (the word being spoken), giving the
 * per-word pop highlight. Times are CLIP-RELATIVE (0-based) so the burn-in
 * filter and the trimmed source share a timeline.
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
 * Build a rounded-rectangle ASS vector drawing centered at the drawing origin
 * (0,0), spanning [-w/2, -h/2] .. [w/2, h/2], with corner radius `r` (clamped
 * to half the smaller dimension). Returns the `{\p1}...{\p}` drawing string.
 *
 * libass vector drawing uses `m`/`l` path commands in script-resolution units
 * relative to the event's `\pos`. libass has no native arc, so each corner is
 * approximated as a small polygonal arc (N straight segments sampled along the
 * quarter circle). N=6 is smooth enough at 1080p while keeping the path short.
 * The path is a single closed, non-self-intersecting clockwise outline, which
 * libass fills cleanly with the default even-odd-free winding.
 */
function roundedRectDrawing(w: number, h: number, radius: number): string {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.max(0, Math.min(radius, Math.min(hw, hh)));
  const N = 6; // segments per corner arc
  const rnd = (n: number) => Math.round(n).toString();

  // Points on a corner arcade: the quarter-arc from angle a0 to a1 (degrees,
  // measured CCW from +x) about center (cx, cy) with radius r.
  const arc = (cx: number, cy: number, a0: number, a1: number): string => {
    let s = "";
    for (let i = 1; i <= N; i++) {
      const a = (a0 + ((a1 - a0) * i) / N) * (Math.PI / 180);
      s += ` l ${rnd(cx + r * Math.cos(a))} ${rnd(cy + r * Math.sin(a))}`;
    }
    return s;
  };

  // Clockwise outline: top edge -> TR arc (270°->360°) -> right edge ->
  // BR arc (0°->90°) -> bottom edge -> BL arc (90°->180°) -> left edge ->
  // TL arc (180°->270°) -> close. Top edge starts at the end of the TL arc
  // so we begin the `m` there.
  //
  // NOTE: the tags MUST be emitted as literal `\p1` and `\p` on disk for
  // libass to enter/leave vector-drawing mode. In a JS template literal a
  // single `\p` is an unrecognized escape and the backslash is STRIPPED
  // (yielding `{p1}`), which libass then renders as literal text — the
  // drawing path digits appear on screen. Use `\\p` so the runtime string
  // keeps the single backslash libass requires.
  let path = `m ${rnd(-hw + r)} ${rnd(-hh)}`;
  path += ` l ${rnd(hw - r)} ${rnd(-hh)}`; // top edge
  path += arc(hw - r, -hh + r, 270, 360); // TR
  path += ` l ${rnd(hw)} ${rnd(hh - r)}`; // right edge
  path += arc(hw - r, hh - r, 0, 90); // BR
  path += ` l ${rnd(-hw + r)} ${rnd(hh)}`; // bottom edge
  path += arc(-hw + r, hh - r, 90, 180); // BL
  path += ` l ${rnd(-hw)} ${rnd(-hh + r)}`; // left edge
  path += arc(-hw + r, -hh + r, 180, 270); // TL
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

  // Default style: bottom-center (alignment 2); per-line events override
  // MarginV so every block's CENTER sits at anchorY regardless of line count.
  // WrapStyle 2 = no auto-wrap (we control breaks via \\N). BorderStyle 1 =
  // outline + shadow. The Highlight style is used for the box drawing layer;
  // its alignment is center (5) and per-event \\pos places each box.
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
    const line = lines[li];
    const block = laid[li];

    // MarginV override positions this block at its anchor (block.marginV already
    // accounts for line count so the block's CENTER sits at anchorY).
    const marginV = block.marginV;

    // --- Layer 1: the karaoke text line (centered, hard-broken with \\N). ---
    const parts: string[] = [];
    for (let li2 = 0; li2 < block.lines.length; li2++) {
      const visual = block.lines[li2];
      for (let wi = 0; wi < visual.words.length; wi++) {
        const w = visual.words[wi];
        const durCs = Math.max(1, Math.round((w.endMs - w.startMs) / 10));
        const word = esc(w.text);
        const trail = wi < visual.words.length - 1 ? " " : "";
        // All text stays primary (white); the box on layer 0 carries the color.
        // For `pop`: animate THIS syllable's scale from 150% to 100% over popMs.
        // The `\t` transform is scoped to the syllable it precedes (libass
        // karaoke semantics), so each word independently pops in as it's spoken.
        const anim = usePop
          ? `\\t(0,${popMs},\\fscx150\\fscy150\\fscx100\\fscy100)`
          : "";
        parts.push(`{\\k${durCs}${anim}}${word}${trail}`);
      }
      if (li2 < block.lines.length - 1) parts.push("\\N");
    }
    body.push(
      `Dialogue: 1,${formatAssTime(line.startMs)},${formatAssTime(line.endMs)},Default,,0,0,${marginV},,${parts.join("")}`,
    );

    // --- Layer 0: rounded-box highlight for the currently-spoken word. ---
    // One box Dialogue per word, each timed to that word's [startMs, endMs]
    // and positioned with \\pos at the word's measured center. Only one box
    // is on-screen at a time (the active word) — the per-word pop.
    for (let li2 = 0; li2 < block.lines.length; li2++) {
      const visual = block.lines[li2];
      // Screen x of this visual line's LEFT edge (block is centered as a unit;
      // each visual line is centered within the block width). For degenerate
      // over-wide blocks (a line wider than the safe band, e.g. one very long
      // word wrapped onto a filled last line under a tight maxLines), clamp
      // the line into the safe band so no box renders off-screen — a long line
      // left-aligns at the safe margin rather than centering off-screen.
      const marginH = Math.round(videoW * (style.safeMarginPct ?? 0.09));
      const safeRight = videoW - marginH;
      const centered = videoW / 2 - block.blockWidthPx / 2 + (block.blockWidthPx - visual.widthPx) / 2;
      // Clamp the centered left-edge into the safe band [marginH, safeRight-width].
      // When the line is wider than the band the interval collapses; Math.max
      // with marginH pins it to the left safe margin (right edge bleeds, never
      // the left, and the block still reads as left-justified rather than
      // centered off-screen).
      const lineLeftX = Math.max(marginH, Math.min(safeRight - visual.widthPx, centered));
      // Screen y of this visual line's CENTER:
      //   marginV is from the bottom -> block bottom = videoH - marginV
      //   block center = block bottom - blockHeight/2
      //   line k = blockCenter - (numLines - 1)/2 * lineHeight + k * lineHeight
      const blockCenterY = videoH - block.marginV - block.blockHeightPx / 2;
      const lineCenterY =
        blockCenterY - ((block.lines.length - 1) * lineHeightPx) / 2 + li2 * lineHeightPx;

      for (let wi = 0; wi < visual.words.length; wi++) {
        const w = visual.words[wi];
        const wordW = visual.wordWidths[wi];
        const wordOffset = visual.wordOffsets[wi];
        const padX = style.highlightPaddingX ?? 12;
        const padY = style.highlightPaddingY ?? 6;
        const radius = style.highlightRadius ?? 16;
        const boxW = wordW + padX * 2;
        const boxH = style.fontSize + padY * 2;
        const cx = lineLeftX + wordOffset + wordW / 2;
        const cy = lineCenterY;
        const drawing = roundedRectDrawing(boxW, boxH, radius);
        // an5 = center align; \pos places box center at (cx, cy); the drawing
        // is centered at origin so it renders around (cx, cy). Disable the
        // outline/shadow on the box drawing so only the fill shows.
        // For `pop`: fade the box in over popMs (fade-in only, no fade-out) so
        // the highlight pops in alongside the word's scale transform.
        const boxFade = usePop ? `\\fad(${popMs},0)` : "";
        const boxText = `{\\pos(${Math.round(cx)},${Math.round(cy)})\\an5${boxFade}\\1a&H${boxAlpha}&\\3a&HFF&\\4a&HFF&\\bord0\\shad0}${drawing}`;
        body.push(
          `Dialogue: 0,${formatAssTime(w.startMs)},${formatAssTime(w.endMs)},Highlight,,0,0,0,,${boxText}`,
        );
      }
    }
  }

  return header + body.join("\r\n") + "\r\n";
}

export type { LaidBlock } from "@/lib/subtitles/layout";
