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
  /**
   * Layout direction for per-word pill geometry. `"rtl"` flips word x-offsets
   * so karaoke boxes track Arabic (and other RTL) reading order. Default
   * `"ltr"` keeps the English path unchanged.
   */
  direction?: "ltr" | "rtl";

  /**
   * Target script/language for the theme. `"en"` = English (default), `"ar"` =
   * Arabic. The Subtitle Themes manager filters by this field; the renderer
   * picks an Arabic-flagged theme when `subtitleLanguage` = `"ar"`. Untagged
   * or unknown = assumed English (serves as a safe default for user-created
   * themes that predate this field).
   */
  language?: "en" | "ar";

  /**
   * Arabic path only. Carries the "Show inactive word pills" flag inline on a
   * client-posted theme (e.g. the Subtitle Themes preview route threads the
   * global General Settings toggle here so the preview frame matches the burn).
   * The renderer (pipeline/subtitles-ar.ts) overrides this with the live
   * General Settings value before calling buildAssArabic — i.e. the global
   * toggle is the single source of truth at render time, but a posted theme
   * can still *preview* the off state without persisting a settings change.
   * Default undefined -> buildAssArabic's own default (true) applies.
   */
  showInactiveWordPills?: boolean;
};

export type BuiltinTheme = {
  key: string;
  name: string;
  presetKey: string;
  /** "en" | "ar" — builtins are tagged so the manager can filter by script. */
  language: "en" | "ar";
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
    language: "en",
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
      language: "en",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. NEON RAVE — Neon green pills on a dark background, electric feel
  // ─────────────────────────────────────────────────────────────────────────────
{
    key: "neon-rave",
    name: "Neon Rave",
    presetKey: "neon-rave",
    language: "en",
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
    language: "en",
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
    language: "en",
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
    language: "en",
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
      language: "en",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. GOLD LUXURY — Gold highlights, dark background, high-status / finance
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "gold-luxury",
    name: "Gold Luxury",
    presetKey: "gold-luxury",
    language: "en",
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
      language: "en",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. ELECTRIC KINETIC — Electric blue outline, amber pop, MrBeast energy
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "electric-kinetic",
    name: "Electric Kinetic",
    presetKey: "electric-kinetic",
    language: "en",
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
      language: "en",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. CLEAN GHOST — White text, ultra-thin outline, minimal translucent box
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "clean-ghost",
    name: "Clean Ghost",
    presetKey: "clean-ghost",
    language: "en",
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
      language: "en",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ARABIC SAFE — line-level captions for Arabic burns. The original Arabic theme
  // kept here as the safe default. Tuned for conversation/dialogue content.
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "arabic-safe",
    name: "Arabic Safe",
    presetKey: "arabic-safe",
    language: "ar",
    styleJson: {
      font: "Noto Sans Arabic",
      fontMetricsKey: "arial-bold",
      fontSize: 78,
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
      highlightPaddingX: 12,
      highlightPaddingY: 10,
      highlightRadius: 12,
      maxChars: 22,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.45,
      direction: "rtl",
      language: "ar",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ARABIC MIRRORS — 7 AR themes that mirror the English builtins. each is tuned
  // for RTL Noto Sans Arabic: a smaller maxChars (Arabic glyphs connect and read
  // wider per character than Latin caps), tighter word spacing (already-shaped
  // Arabic words need less inter-word padding), and `uppercase: false` always
  // (Arabic has no case). Each keeps the energy/colour identity of its English
  // counterpart so EN/AR projects share a visual language across transcript runs.
  // ─────────────────────────────────────────────────────────────────────────────
  {
    key: "viral-ar",
    name: "Viral Arabic (Word Pills)",
    presetKey: "viral-ar",
    language: "ar",
    styleJson: {
      font: "Noto Sans Arabic",
      fontMetricsKey: "arial-bold",
      fontSize: 88,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 0,
      bold: 1,
      anchorY: 0.62,
      wordPillMode: "all",
      bgHsl: NEAR_BLACK,
      bgOpacity: 0.72,
      highlightHsl: PURPLE_HIGHLIGHT,
      highlightOpacity: 1,
      animationStyle: "none",
      animationSpeed: 1,
      safeMarginPct: 0.05,
      maxBlockWidthPct: 0.90,
      lineHeight: 1.15,
      highlightPaddingX: 12,
      highlightPaddingY: 6,
      highlightRadius: 10,
      maxChars: 18,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.30,
      direction: "rtl",
      language: "ar",
    },
  },
  {
    key: "neon-rave-ar",
    name: "Neon Rave Arabic",
    presetKey: "neon-rave-ar",
    language: "ar",
    styleJson: {
      font: "Noto Sans Arabic",
      fontMetricsKey: "arial-bold",
      fontSize: 82,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 0,
      bold: 1,
      anchorY: 0.62,
      wordPillMode: "all",
      bgHsl: DARK_PILL,
      bgOpacity: 0.80,
      highlightHsl: NEON_GREEN,
      highlightOpacity: 1,
      animationStyle: "pop",
      animationSpeed: 1.1,
      safeMarginPct: 0.05,
      maxBlockWidthPct: 0.90,
      lineHeight: 1.18,
      highlightPaddingX: 14,
      highlightPaddingY: 6,
      highlightRadius: 14,
      maxChars: 18,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.28,
      direction: "rtl",
      language: "ar",
    },
  },
  {
    key: "fire-speaker-ar",
    name: "Fire Speaker Arabic",
    presetKey: "fire-speaker-ar",
    language: "ar",
    styleJson: {
      font: "Noto Sans Arabic",
      fontMetricsKey: "arial-bold",
      fontSize: 96,
      primaryHsl: CREAM,
      outlineHsl: CRIMSON,
      outline: 10,
      shadow: 5,
      bold: 1,
      anchorY: 0.62,
      wordPillMode: "all",
      bgHsl: [0, 0, 0.05],
      bgOpacity: 0.78,
      highlightHsl: ORANGE,
      highlightOpacity: 1,
      animationStyle: "pop",
      animationSpeed: 1.2,
      safeMarginPct: 0.06,
      maxBlockWidthPct: 0.88,
      lineHeight: 1.1,
      highlightPaddingX: 16,
      highlightPaddingY: 6,
      highlightRadius: 8,
      maxChars: 16,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.26,
      direction: "rtl",
      language: "ar",
    },
  },
  {
    key: "ice-cold-ar",
    name: "Ice Cold Arabic",
    presetKey: "ice-cold-ar",
    language: "ar",
    styleJson: {
      font: "Noto Sans Arabic",
      fontMetricsKey: "arial-bold",
      fontSize: 84,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 0,
      bold: 1,
      anchorY: 0.63,
      wordPillMode: "all",
      bgHsl: DEEP_NAVY,
      bgOpacity: 0.84,
      highlightHsl: CYAN,
      highlightOpacity: 1,
      animationStyle: "none",
      animationSpeed: 1,
      safeMarginPct: 0.05,
      maxBlockWidthPct: 0.90,
      lineHeight: 1.15,
      highlightPaddingX: 14,
      highlightPaddingY: 6,
      highlightRadius: 20,
      maxChars: 19,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.28,
      direction: "rtl",
      language: "ar",
    },
  },
  {
    key: "pink-pop-ar",
    name: "Pink Pop Arabic",
    presetKey: "pink-pop-ar",
    language: "ar",
    styleJson: {
      font: "Noto Sans Arabic",
      fontMetricsKey: "arial-bold",
      fontSize: 82,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 0,
      bold: 1,
      anchorY: 0.62,
      wordPillMode: "all",
      bgHsl: [0, 0, 0.06],
      bgOpacity: 0.70,
      highlightHsl: HOT_PINK,
      highlightOpacity: 1,
      animationStyle: "pop",
      animationSpeed: 1.15,
      safeMarginPct: 0.05,
      maxBlockWidthPct: 0.90,
      lineHeight: 1.18,
      highlightPaddingX: 14,
      highlightPaddingY: 6,
      highlightRadius: 50,
      maxChars: 18,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.30,
      direction: "rtl",
      language: "ar",
    },
  },
  {
    key: "gold-luxury-ar",
    name: "Gold Luxury Arabic",
    presetKey: "gold-luxury-ar",
    language: "ar",
    styleJson: {
      font: "Noto Sans Arabic",
      fontMetricsKey: "arial-bold",
      fontSize: 86,
      primaryHsl: CREAM,
      outlineHsl: BLACK,
      outline: 0,
      shadow: 4,
      bold: 1,
      anchorY: 0.63,
      wordPillMode: "all",
      bgHsl: [0, 0, 0.04],
      bgOpacity: 0.88,
      highlightHsl: GOLD,
      highlightOpacity: 1,
      animationStyle: "none",
      animationSpeed: 1,
      safeMarginPct: 0.06,
      maxBlockWidthPct: 0.88,
      lineHeight: 1.2,
      highlightPaddingX: 16,
      highlightPaddingY: 6,
      highlightRadius: 6,
      maxChars: 19,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.28,
      direction: "rtl",
      language: "ar",
    },
  },
  {
    key: "electric-kinetic-ar",
    name: "Electric Kinetic Arabic",
    presetKey: "electric-kinetic-ar",
    language: "ar",
    styleJson: {
      font: "Noto Sans Arabic",
      fontMetricsKey: "arial-bold",
      // Slightly smaller than the English Impact version — Arabic at very large
      // sizes on RTL reading order takes more visual real estate per line.
      fontSize: 92,
      primaryHsl: WHITE,
      outlineHsl: ELECTRIC_BLUE,
      outline: 14,
      shadow: 5,
      bold: 1,
      anchorY: 0.62,
      wordPillMode: "all",
      bgHsl: [0, 0, 0.05],
      bgOpacity: 0.72,
      highlightHsl: AMBER,
      highlightOpacity: 1,
      animationStyle: "pop",
      animationSpeed: 1.2,
      safeMarginPct: 0.07,
      maxBlockWidthPct: 0.86,
      lineHeight: 1.0,
      highlightPaddingX: 18,
      highlightPaddingY: 6,
      highlightRadius: 20,
      maxChars: 22,
      maxLines: 2,
      uppercase: false,
      wordSpacingEm: 0.24,
      direction: "rtl",
      language: "ar",
    },
  },
];

export const DEFAULT_THEME_KEY = "viral";
export const ARABIC_THEME_KEY = "arabic-safe";

export function findBuiltinTheme(key: string): BuiltinTheme | undefined {
  return BUILTIN_THEMES.find((t) => t.key === key);
}
