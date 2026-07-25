/**
 * Builtin subtitle themes. Each theme's `styleJson` maps to ASS force_style
 * fields (and a few app-only fields for layout/animation). The ASS serializer
 * in `ass.ts` turns these into `[V4+ Styles]` + per-word karaoke highlight with
 * a measured rounded-box highlight drawn on a background layer.
 *
 * Layout model (v2): the block is bottom-center anchored at `anchorY` of the
 * video height and horizontally centered as a unit with `safeMarginPct`
 * margins on each side. Words are measured (see metrics.ts) so the block is
 * wrapped to `maxBlockWidthPct` and balanced, never edge-touching.
 *
 * Colors are stored as HSL triples (h 0-360, s/l 0-1) so we can keep the
 * design-system tokens as the source of truth; `ass.ts` converts to
 * `&HAABBGGRR` for libass.
 */

export type StyleJson = {
  /** Font family. (Note: on machines without the font, libass substitutes an
   *  installed family — e.g. Inter -> Arial — so the metrics table keys off
   * `fontMetricsKey`, which should name the actually-rendered font.) */
  font: string;
  /** Metrics-table row key for measurement (defaults to a bold-Arial row). */
  fontMetricsKey?: string;
  /** Font size (ASS units at 1080x1920; libass auto-scales with PlayResY). */
  fontSize: number;
  /** Primary (fill) color, HSL. */
  primaryHsl: [number, number, number];
  /** Outline color, HSL. */
  outlineHsl: [number, number, number];
  /** Outline thickness (px at PlayResY=1920). */
  outline: number;
  /** Shadow depth (px). */
  shadow: number;
  /** Bold weight (0/1/-1 = inherit). */
  bold: number;
  /** Vertical anchor as a fraction of video height (0=top, 1=bottom). The
   *  block's visual center is placed here. Default 0.65 — lower-middle, clear
   *  of TikTok top + bottom UI. Replaces the old `alignment` field. */
  anchorY?: number;
  /** [back-compat, optional] Legacy ASS alignment (1-9). Ignored by the v2
   *  layout, which always bottom-center-aligns at `anchorY`. Kept only so
   *  old DB rows parse without error. */
  alignment?: number;
  /** [back-compat, optional] Legacy left/right margin (ASS units). Ignored by
   *  the v2 layout, which derives margins from `safeMarginPct`. */
  marginL?: number;
  /** [back-compat, optional] Legacy vertical margin (ASS units). Used only as
   *  a small downward nudge of `anchorY` (see layout.ts). */
  marginV?: number;
  /** Safe left/right margin as a fraction of video width (EACH side).
   *  Default 0.09 = 9% per side -> ~82% usable band. */
  safeMarginPct?: number;
  /** Max subtitle block width as a fraction of video width (default 0.82). */
  maxBlockWidthPct?: number;
  /** Line height multiplier (default 1.0 — tight but readable). */
  lineHeight?: number;
  /** Highlight (karaoke sweep) color for the active word's rounded box, HSL. */
  highlightHsl: [number, number, number];
  /** Karaoke highlight animation speed multiplier (1 = word duration). For
   *  `animationStyle: "pop"` this also scales the pop settle time (faster
   *  speed = snappier, shorter settle). */
  animationSpeed: number;
  /** Per-word motion style. `"none"` (default) = the classic flat karaoke
   *  highlight with no transform. `"pop"` = each spoken word scales in from
   *  ~150% to 100% and its rounded highlight box fades+pops in, the
   *  MrBeast-style kinetic feel. Implemented in ass.ts via libass `\t`
   *  (transform over time) and `\fad` so it survives the burned-in render. */
  animationStyle?: "none" | "pop";
  /** Rounded-box highlight horizontal padding (px at PlayResY=1920). */
  highlightPaddingX?: number;
  /** Rounded-box highlight vertical padding (px at PlayResY=1920). */
  highlightPaddingY?: number;
  /** Rounded-box corner radius (px at PlayResY=1920). 0 = square corners. */
  highlightRadius?: number;
  /** Rounded-box fill opacity 0-1 (1 = solid). */
  highlightOpacity?: number;
  /**
   * Word-pill mode. Controls whether every word gets its own dark background
   * pill (always visible for the full block), with the active word's pill
   * replaced by the highlight color.
   *
   * - `"none"` (default): classic karaoke — only the active word gets a
   *   highlight box; non-active words show with outline/shadow only.
   * - `"all"`: EVERY word has a dark `bgHsl` pill for the full block window.
   *   The active word's pill is replaced by the `highlightHsl` colored pill
   *   for the duration of that word. This matches the viral TikTok style where
   *   all words are always "boxed" and the spoken word pops with color.
   */
  wordPillMode?: "none" | "all";
  /**
   * Background pill color (HSL). Only used when `wordPillMode: "all"`.
   * Default near-black: [0, 0, 0.06].
   */
  bgHsl?: [number, number, number];
  /**
   * Background pill fill opacity 0-1. Only used when `wordPillMode: "all"`.
   * Default 0.7 — dark but not fully opaque so the video peeks through.
   */
  bgOpacity?: number;
  /** Max characters per line (advisory; used only by the SRT companion path). */
  maxChars: number;
  /** Max lines per subtitle event (hard-capped at 3 by the layout). */
  maxLines: number;
  /** If true, the subtitle text is forced to uppercase. */
  uppercase?: boolean;
  /** Em-width space between words. Defaults to 0.278. Increase for wider gaps. */
  wordSpacingEm?: number;
};

export type BuiltinTheme = {
  key: string;
  name: string;
  presetKey: string;
  styleJson: StyleJson;
};

// ── Color palette ──────────────────────────────────────────────────────────────
const WHITE: [number, number, number]       = [0, 0, 1];
const BLACK: [number, number, number]       = [0, 0, 0];
const NEAR_BLACK: [number, number, number]  = [0, 0, 0.06];
const AMBER: [number, number, number]       = [42, 1, 0.55];
const PURPLE_HIGHLIGHT: [number, number, number] = [258, 0.75, 0.6];

// New creative palette
const NEON_GREEN: [number, number, number]  = [145, 1, 0.5];     // #00ff80 energy
const HOT_PINK: [number, number, number]    = [330, 1, 0.58];    // hot pink
const CYAN: [number, number, number]        = [189, 1, 0.5];     // electric cyan
const ORANGE: [number, number, number]      = [22, 1, 0.55];     // punchy orange
const GOLD: [number, number, number]        = [45, 0.95, 0.52];  // luxury gold
const DEEP_NAVY: [number, number, number]   = [222, 0.47, 0.11]; // near-black navy
const CRIMSON: [number, number, number]     = [348, 0.9, 0.45];  // deep red
const ELECTRIC_BLUE: [number, number, number] = [217, 1, 0.6];  // electric blue
const CREAM: [number, number, number]       = [45, 0.4, 0.92];   // warm off-white
const DARK_PILL: [number, number, number]   = [220, 0.15, 0.1];  // dark blue-gray pill

export const BUILTIN_THEMES: BuiltinTheme[] = [
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. VIRAL (Word Pills) — original viral style, kept as default
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "viral",
    name: "Viral (Word Pills)",
    presetKey: "viral",
    styleJson: {
      font: "Arial",
      fontMetricsKey: "arial-bold",
      fontSize: 85,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 0,
      bold: 1,
      anchorY: 0.65,
      wordPillMode: "all",
      bgHsl: NEAR_BLACK,
      bgOpacity: 0.72,
      highlightHsl: PURPLE_HIGHLIGHT,
      highlightOpacity: 1,
      animationStyle: "none",
      animationSpeed: 1,
      safeMarginPct: 0.08,
      maxBlockWidthPct: 0.84,
      lineHeight: 1.15,
      highlightPaddingX: 10,
      highlightPaddingY: 10,
      highlightRadius: 10,
      maxChars: 13,
      maxLines: 2,
      uppercase: true,
      wordSpacingEm: 0.5,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. NEON RAVE — Neon green pills on a dark background, electric feel
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "neon-rave",
    name: "Neon Rave",
    presetKey: "neon-rave",
    styleJson: {
      font: "Verdana",
      fontMetricsKey: "verdana-bold",
      fontSize: 78,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 0,
      bold: 1,
      anchorY: 0.65,
      wordPillMode: "all",
      bgHsl: DARK_PILL,
      bgOpacity: 0.8,
      highlightHsl: NEON_GREEN,
      highlightOpacity: 1,
      animationStyle: "pop",
      animationSpeed: 1.1,
      safeMarginPct: 0.08,
      maxBlockWidthPct: 0.84,
      lineHeight: 1.18,
      highlightPaddingX: 14,
      highlightPaddingY: 10,
      highlightRadius: 14,
      maxChars: 13,
      maxLines: 2,
      uppercase: true,
      wordSpacingEm: 0.45,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. FIRE SPEAKER — Crimson & orange, aggressive energy, debates & rants
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "fire-speaker",
    name: "Fire Speaker",
    presetKey: "fire-speaker",
    styleJson: {
      font: "Impact",
      fontMetricsKey: "impact",
      fontSize: 105,
      primaryHsl: CREAM,
      outlineHsl: CRIMSON,
      outline: 12,
      shadow: 6,
      bold: 1,
      anchorY: 0.64,
      wordPillMode: "all",
      bgHsl: [0, 0, 0.05],
      bgOpacity: 0.75,
      highlightHsl: ORANGE,
      highlightOpacity: 1,
      animationStyle: "pop",
      animationSpeed: 1.2,
      safeMarginPct: 0.09,
      maxBlockWidthPct: 0.82,
      lineHeight: 1.1,
      highlightPaddingX: 16,
      highlightPaddingY: 10,
      highlightRadius: 8,
      maxChars: 13,
      maxLines: 2,
      uppercase: true,
      wordSpacingEm: 0.4,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. ICE COLD — Cyan / electric blue, cool and premium podcast style
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "ice-cold",
    name: "Ice Cold",
    presetKey: "ice-cold",
    styleJson: {
      font: "Tahoma",
      fontMetricsKey: "tahoma-bold",
      fontSize: 80,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 0,
      bold: 1,
      anchorY: 0.66,
      wordPillMode: "all",
      bgHsl: DEEP_NAVY,
      bgOpacity: 0.82,
      highlightHsl: CYAN,
      highlightOpacity: 1,
      animationStyle: "none",
      animationSpeed: 1,
      safeMarginPct: 0.09,
      maxBlockWidthPct: 0.84,
      lineHeight: 1.15,
      highlightPaddingX: 14,
      highlightPaddingY: 10,
      highlightRadius: 20,
      maxChars: 14,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.45,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. PINK POP — Hot pink highlight pop, high-energy entertainment/lifestyle
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "pink-pop",
    name: "Pink Pop",
    presetKey: "pink-pop",
    styleJson: {
      font: "Verdana",
      fontMetricsKey: "verdana-bold",
      fontSize: 76,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 0,
      bold: 1,
      anchorY: 0.65,
      wordPillMode: "all",
      bgHsl: [0, 0, 0.06],
      bgOpacity: 0.70,
      highlightHsl: HOT_PINK,
      highlightOpacity: 1,
      animationStyle: "pop",
      animationSpeed: 1.15,
      safeMarginPct: 0.08,
      maxBlockWidthPct: 0.84,
      lineHeight: 1.18,
      highlightPaddingX: 14,
      highlightPaddingY: 10,
      highlightRadius: 50, // fully rounded = pill shape
      maxChars: 13,
      maxLines: 2,
      uppercase: true,
      wordSpacingEm: 0.5,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. GOLD LUXURY — Gold highlights, dark background, high-status / finance
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "gold-luxury",
    name: "Gold Luxury",
    presetKey: "gold-luxury",
    styleJson: {
      font: "Arial",
      fontMetricsKey: "arial-bold",
      fontSize: 84,
      primaryHsl: CREAM,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 4,
      bold: 1,
      anchorY: 0.65,
      wordPillMode: "all",
      bgHsl: [0, 0, 0.04],
      bgOpacity: 0.88,
      highlightHsl: GOLD,
      highlightOpacity: 1,
      animationStyle: "none",
      animationSpeed: 1,
      safeMarginPct: 0.09,
      maxBlockWidthPct: 0.82,
      lineHeight: 1.2,
      highlightPaddingX: 16,
      highlightPaddingY: 10,
      highlightRadius: 6,
      maxChars: 14,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.45,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. ELECTRIC KINETIC — Electric blue outline, amber pop, MrBeast energy
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "electric-kinetic",
    name: "Electric Kinetic",
    presetKey: "electric-kinetic",
    styleJson: {
      font: "Impact",
      fontMetricsKey: "impact",
      fontSize: 110,
      primaryHsl: WHITE,
      outlineHsl: ELECTRIC_BLUE,
      outline: 18,
      shadow: 6,
      bold: 1,
      anchorY: 0.64,
      highlightHsl: AMBER,
      highlightOpacity: 1,
      animationStyle: "pop",
      animationSpeed: 1.2,
      safeMarginPct: 0.1,
      maxBlockWidthPct: 0.8,
      lineHeight: 1.0,
      highlightPaddingX: 18,
      highlightPaddingY: 10,
      highlightRadius: 20,
      maxChars: 18,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.3,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. CLEAN GHOST — White text, ultra-thin outline, minimal translucent box
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "clean-ghost",
    name: "Clean Ghost",
    presetKey: "clean-ghost",
    styleJson: {
      font: "Tahoma",
      fontMetricsKey: "tahoma",
      fontSize: 66,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 3,
      shadow: 0,
      bold: 0,
      anchorY: 0.67,
      wordPillMode: "none",
      highlightHsl: WHITE,
      highlightOpacity: 0.15,
      animationStyle: "none",
      animationSpeed: 1,
      safeMarginPct: 0.1,
      maxBlockWidthPct: 0.84,
      lineHeight: 1.1,
      highlightPaddingX: 10,
      highlightPaddingY: 6,
      highlightRadius: 8,
      maxChars: 28,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.28,
    },
  },
];

export const DEFAULT_THEME_KEY = "viral";

export function findBuiltinTheme(key: string): BuiltinTheme | undefined {
  return BUILTIN_THEMES.find((t) => t.key === key);
}
