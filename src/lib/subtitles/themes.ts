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
  /** Karaoke highlight animation speed multiplier (1 = word duration). */
  animationSpeed: number;
  /** Rounded-box highlight horizontal padding (px at PlayResY=1920). */
  highlightPaddingX?: number;
  /** Rounded-box highlight vertical padding (px at PlayResY=1920). */
  highlightPaddingY?: number;
  /** Rounded-box corner radius (px at PlayResY=1920). 0 = square corners. */
  highlightRadius?: number;
  /** Rounded-box fill opacity 0-1 (1 = solid). */
  highlightOpacity?: number;
  /** Max characters per line (advisory; used only by the SRT companion path). */
  maxChars: number;
  /** Max lines per subtitle event (hard-capped at 3 by the layout). */
  maxLines: number;
};

export type BuiltinTheme = {
  key: string;
  name: string;
  presetKey: string;
  styleJson: StyleJson;
};

const VIOLET: [number, number, number] = [262, 0.83, 0.65];
const WHITE: [number, number, number] = [0, 0, 1];
const BLACK: [number, number, number] = [0, 0, 0];
const AMBER: [number, number, number] = [42, 1, 0.55];
const YELLOW: [number, number, number] = [54, 1, 0.5];
const BLUE: [number, number, number] = [210, 1, 0.45];

export const BUILTIN_THEMES: BuiltinTheme[] = [
  {
    key: "tiktok",
    name: "TikTok",
    presetKey: "tiktok",
    styleJson: {
      font: "Inter",
      fontMetricsKey: "inter-bold",
      fontSize: 82,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 10,
      shadow: 0,
      bold: 1,
      anchorY: 0.66,
      highlightHsl: AMBER,
      animationSpeed: 1,
      safeMarginPct: 0.09,
      maxBlockWidthPct: 0.82,
      lineHeight: 1.0,
      highlightPaddingX: 14,
      highlightPaddingY: 8,
      highlightRadius: 18,
      highlightOpacity: 1,
      maxChars: 22,
      maxLines: 2,
    },
  },
  {
    key: "hormozi",
    name: "Hormozi",
    presetKey: "hormozi",
    styleJson: {
      font: "Inter",
      fontMetricsKey: "inter-bold",
      fontSize: 88,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 14,
      shadow: 0,
      bold: 1,
      anchorY: 0.64,
      highlightHsl: VIOLET,
      animationSpeed: 1.1,
      safeMarginPct: 0.1,
      maxBlockWidthPct: 0.8,
      lineHeight: 1.0,
      highlightPaddingX: 16,
      highlightPaddingY: 10,
      highlightRadius: 20,
      highlightOpacity: 1,
      maxChars: 20,
      maxLines: 3,
    },
  },
  {
    key: "minimal",
    name: "Minimal",
    presetKey: "minimal",
    styleJson: {
      font: "Inter",
      fontMetricsKey: "inter-regular",
      fontSize: 60,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 4,
      shadow: 2,
      bold: 0,
      anchorY: 0.66,
      highlightHsl: AMBER,
      animationSpeed: 1,
      safeMarginPct: 0.1,
      maxBlockWidthPct: 0.84,
      lineHeight: 1.05,
      // Minimal keeps the subtle per-word recolor (no big box): tiny padding,
      // small radius, low opacity — a faint accent, not a pill.
      highlightPaddingX: 6,
      highlightPaddingY: 2,
      highlightRadius: 4,
      highlightOpacity: 0.25,
      maxChars: 30,
      maxLines: 2,
    },
  },
  {
    key: "bold",
    name: "Bold",
    presetKey: "bold",
    styleJson: {
      font: "Inter",
      fontMetricsKey: "inter-bold",
      fontSize: 96,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 16,
      shadow: 4,
      bold: 1,
      anchorY: 0.64,
      highlightHsl: YELLOW,
      animationSpeed: 1,
      safeMarginPct: 0.1,
      maxBlockWidthPct: 0.8,
      lineHeight: 1.0,
      highlightPaddingX: 18,
      highlightPaddingY: 12,
      highlightRadius: 22,
      highlightOpacity: 1,
      maxChars: 18,
      maxLines: 2,
    },
  },
  {
    key: "classic",
    name: "Classic",
    presetKey: "classic",
    styleJson: {
      font: "Inter",
      fontMetricsKey: "inter-regular",
      fontSize: 64,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 6,
      shadow: 2,
      bold: 0,
      anchorY: 0.65,
      highlightHsl: AMBER,
      animationSpeed: 1,
      safeMarginPct: 0.1,
      maxBlockWidthPct: 0.84,
      lineHeight: 1.05,
      // Classic: small amber box, modest radius — restrained but present.
      highlightPaddingX: 10,
      highlightPaddingY: 6,
      highlightRadius: 12,
      highlightOpacity: 0.9,
      maxChars: 28,
      maxLines: 2,
    },
  },
  {
    key: "mrbeast",
    name: "MrBeast",
    presetKey: "mrbeast",
    styleJson: {
      font: "Inter",
      fontMetricsKey: "inter-bold",
      fontSize: 90,
      primaryHsl: WHITE,
      outlineHsl: BLUE,
      outline: 18,
      shadow: 6,
      bold: 1,
      anchorY: 0.64,
      highlightHsl: AMBER,
      animationSpeed: 1.1,
      safeMarginPct: 0.1,
      maxBlockWidthPct: 0.8,
      lineHeight: 1.0,
      highlightPaddingX: 18,
      highlightPaddingY: 10,
      highlightRadius: 20,
      highlightOpacity: 1,
      maxChars: 18,
      maxLines: 2,
    },
  },
];

export const DEFAULT_THEME_KEY = "tiktok";

export function findBuiltinTheme(key: string): BuiltinTheme | undefined {
  return BUILTIN_THEMES.find((t) => t.key === key);
}
