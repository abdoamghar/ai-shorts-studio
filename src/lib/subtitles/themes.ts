/**
 * Builtin subtitle themes. Each theme's `styleJson` maps to ASS force_style
 * fields (and a few app-only fields for layout/animation). The ASS serializer
 * in `ass.ts` turns these into `[V4+ Styles]` + per-word karaoke highlight.
 *
 * Colors are stored as HSL triples (h 0-360, s/l 0-1) so we can keep the
 * design-system tokens as the source of truth; `ass.ts` converts to
 * `&HAABBGGRR` for libass.
 */

export type StyleJson = {
  /** Font family. */
  font: string;
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
  /** ASS alignment (1-9 numpad; 2 = bottom-center, 8 = top-center). */
  alignment: number;
  /** Left/right margin (ASS units). */
  marginL: number;
  /** Vertical margin from the alignment edge (ASS units). */
  marginV: number;
  /** Highlight (karaoke sweep) color for the active word, HSL. */
  highlightHsl: [number, number, number];
  /** Karaoke highlight animation speed multiplier (1 = word duration). */
  animationSpeed: number;
  /** Max characters per line before wrapping. */
  maxChars: number;
  /** Max lines per subtitle event. */
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

export const BUILTIN_THEMES: BuiltinTheme[] = [
  {
    key: "tiktok",
    name: "TikTok",
    presetKey: "tiktok",
    styleJson: {
      font: "Inter",
      fontSize: 82,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 10,
      shadow: 0,
      bold: 1,
      alignment: 8,
      marginL: 80,
      marginV: 120,
      highlightHsl: AMBER,
      animationSpeed: 1,
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
      fontSize: 88,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 14,
      shadow: 0,
      bold: 1,
      alignment: 8,
      marginL: 70,
      marginV: 110,
      highlightHsl: VIOLET,
      animationSpeed: 1.1,
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
      fontSize: 60,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 4,
      shadow: 2,
      bold: 0,
      alignment: 2,
      marginL: 90,
      marginV: 140,
      highlightHsl: AMBER,
      animationSpeed: 1,
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
      fontSize: 96,
      primaryHsl: YELLOW,
      outlineHsl: BLACK,
      outline: 16,
      shadow: 4,
      bold: 1,
      alignment: 8,
      marginL: 70,
      marginV: 120,
      highlightHsl: AMBER,
      animationSpeed: 1,
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
      fontSize: 64,
      primaryHsl: WHITE,
      outlineHsl: BLACK,
      outline: 6,
      shadow: 2,
      bold: 0,
      alignment: 2,
      marginL: 80,
      marginV: 130,
      highlightHsl: AMBER,
      animationSpeed: 1,
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
      fontSize: 90,
      primaryHsl: WHITE,
      outlineHsl: [210, 1, 0.45],
      outline: 18,
      shadow: 6,
      bold: 1,
      alignment: 8,
      marginL: 70,
      marginV: 120,
      highlightHsl: AMBER,
      animationSpeed: 1.1,
      maxChars: 18,
      maxLines: 2,
    },
  },
];

export const DEFAULT_THEME_KEY = "tiktok";

export function findBuiltinTheme(key: string): BuiltinTheme | undefined {
  return BUILTIN_THEMES.find((t) => t.key === key);
}
