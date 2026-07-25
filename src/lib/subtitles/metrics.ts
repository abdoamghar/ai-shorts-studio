import "server-only";

/**
 * Font metrics for offline subtitle width measurement. The ASS path needs to
 * know each word's pixel width BEFORE rendering so it can wrap lines to a max
 * block width and position per-word rounded-box highlights with `\\pos`. We
 * can't query libass for widths without rendering, so we ship a measured
 * metrics table (widths normalized to em — multiply by fontSize to get ASS
 * units at PlayResY=1920) and estimate per-word widths from per-character
 * advances plus an average fallback.
 *
 * IMPORTANT (verified on this machine): the theme font "Inter" is NOT
 * installed; libass's DirectWrite provider falls back `Inter -> Arial`
 * (`Inter 700 -> Arial-BoldMT`, `Inter 400 -> ArialMT`). So Arial is the font
 * actually being burned in. Arial's metrics are extremely stable and
 * well-documented (units-per-em = 2048 in the TrueType `hmtx`), so we ship
 * Arial as the primary metrics row and treat "Inter" as an alias for it. Any
 * other unknown font also falls back to the Arial table under our
 * DirectWrite/libass substitution, keeping the estimate honest.
 *
 * All character widths below are ADVANCE WIDTHS in em units (1 em = fontSize
 * ASS units), derived from Arial's published advance widths at 2048 upem and
 * rounded to 3dp. Bold is ~6% wider than regular; we ship both rows. Values
 * are for LATIN glyphs only (the app's current language scope).
 */

export type FontMetrics = {
  /** Per-character advance widths in em, keyed by character. */
  advances: Record<string, number>;
  /** Average advance for characters not in `advances` (em). */
  avgAdvance: number;
  /** Space advance (em). */
  spaceAdvance: number;
  /** Approximate line gap between consecutive baselines, as a fontSize multiple. */
  lineGap: number;
};

// Arial / Arial-Bold advance widths (em) for common Latin glyphs. Uppercase
// letters are ~0.72em; lowercase ~0.48em; digits ~0.55em; space ~0.278em.
// Sourced from Arial's published hmtx (upem 2048), rounded to 3dp.
const ARIAL_UPPER: Record<string, number> = {
  A: 0.666, B: 0.666, C: 0.722, D: 0.722, E: 0.666, F: 0.611, G: 0.778,
  H: 0.722, I: 0.278, J: 0.5, K: 0.666, L: 0.556, M: 0.833, N: 0.722,
  O: 0.778, P: 0.666, Q: 0.778, R: 0.722, S: 0.666, T: 0.611, U: 0.722,
  V: 0.666, W: 0.944, X: 0.666, Y: 0.666, Z: 0.611,
};
const ARIAL_LOWER: Record<string, number> = {
  a: 0.556, b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278, g: 0.556,
  h: 0.556, i: 0.222, j: 0.222, k: 0.5, l: 0.222, m: 0.833, n: 0.556,
  o: 0.556, p: 0.556, q: 0.556, r: 0.333, s: 0.5, t: 0.278, u: 0.556,
  v: 0.5, w: 0.722, x: 0.5, y: 0.5, z: 0.5,
};
const ARIAL_DIGITS: Record<string, number> = {
  "0": 0.556, "1": 0.556, "2": 0.556, "3": 0.556, "4": 0.556, "5": 0.556,
  "6": 0.556, "7": 0.556, "8": 0.556, "9": 0.556,
};
const ARIAL_PUNCT: Record<string, number> = {
  ".": 0.278, ",": 0.278, "!": 0.333, "?": 0.444, "'": 0.194, "\"": 0.355,
  "-": 0.333, "(": 0.333, ")": 0.333, ":": 0.278, ";": 0.278, " ": 0.278,
  "&": 0.778, "@": 0.778, "#": 0.556, "%": 0.833,
};

function buildArialAdvances(bold: number): Record<string, number> {
  // Bold is ~6% wider than regular; the base values above are already regular,
  // so inflate by the bold factor for the bold row.
  const scale = bold;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(ARIAL_UPPER)) out[k] = +(v * scale).toFixed(3);
  for (const [k, v] of Object.entries(ARIAL_LOWER)) out[k] = +(v * scale).toFixed(3);
  for (const [k, v] of Object.entries(ARIAL_DIGITS)) out[k] = +(v * scale).toFixed(3);
  for (const [k, v] of Object.entries(ARIAL_PUNCT)) out[k] = +(v * scale).toFixed(3);
  return out;
}

const ARIAL_REG_METRICS: FontMetrics = {
  advances: buildArialAdvances(1),
  // Weighted-ish average of lowercase (most common in subtitle prose).
  avgAdvance: 0.556,
  spaceAdvance: 0.278,
  lineGap: 1.0,
};

const ARIAL_BOLD_METRICS: FontMetrics = {
  advances: buildArialAdvances(1.06),
  avgAdvance: 0.556 * 1.06, // ~0.589
  spaceAdvance: 0.278,
  lineGap: 1.0,
};

/**
 * Ordered list of (fontKey, metrics) — the first one whose key matches the
 * requested font (case-insensitive, ignoring weight suffixes) wins. "inter"
 * aliases to Arial metrics because libass substitutes Inter->Arial on this
 * machine (see header). Any unknown font falls back to Arial too, since
 * DirectWrite's substitution produces an Arial-family result in practice.
 */
export const FONT_METRICS: Record<string, FontMetrics> = {
  "inter-bold": ARIAL_BOLD_METRICS,
  "inter": ARIAL_BOLD_METRICS, // alias: app's default theme font name
  "inter-regular": ARIAL_REG_METRICS,
  "arial-bold": ARIAL_BOLD_METRICS,
  "arial": ARIAL_BOLD_METRICS,
  "arial-regular": ARIAL_REG_METRICS,
};

/**
 * Look up the metrics row for a font + bold flag. Unknown fonts fall back to
 * Arial bold/regular (DirectWrite substitutes to an Arial-family font).
 */
export function fontMetrics(fontKey: string, bold: number): FontMetrics {
  const key = fontKey.toLowerCase();
  const boldKey = `${key}-bold`;
  if (FONT_METRICS[boldKey]) return FONT_METRICS[boldKey];
  if (FONT_METRICS[key]) return FONT_METRICS[key];
  return bold === 1 ? ARIAL_BOLD_METRICS : ARIAL_REG_METRICS;
}

/**
 * Estimate the rendered width (ASS units at PlayResY=1920) of `text` in the
 * given font + size. Sums per-character advance widths, falling back to the
 * font's average advance for any glyph not in the table. The result is
 * inflated by ~3% so we err toward wrapping slightly early (never overshoot
 * the safe margin / never let a box overflow).
 */
export function measureText(
  text: string,
  fontKey: string,
  fontSize: number,
  bold: number,
): number {
  if (!text) return 0;
  const m = fontMetrics(fontKey, bold);
  let widthEm = 0;
  for (const ch of text) {
    const adv = m.advances[ch];
    if (adv !== undefined) widthEm += adv;
    else if (ch === " ") widthEm += m.spaceAdvance;
    else widthEm += m.avgAdvance;
  }
  // 3% safety inflation so we never overshoot a safe margin.
  const widthPx = widthEm * fontSize * 1.03;
  return Math.round(widthPx);
}

/**
 * Available text width inside the safe margins.
 * `safeMarginPct` is the fraction of video width reserved on EACH side
 * (e.g. 0.09 = 9% left + 9% right). Result is the usable text band.
 */
export function availableWidth(videoW: number, safeMarginPct: number): number {
  const side = videoW * Math.min(0.45, Math.max(0, safeMarginPct));
  return Math.round(videoW - 2 * side);
}
