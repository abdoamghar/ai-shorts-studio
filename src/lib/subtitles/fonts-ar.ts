import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the directory containing Arabic fonts for libass `fontsdir=`.
 *
 * Prefers bundled Noto Sans Arabic under `assets/fonts/`. Falls back to the
 * Windows Fonts folder when the bundle is missing (dev machines).
 */

// The three weights shipped under assets/fonts/ (OFL 1.1, from Google Noto).
// Keep this list in sync with the actual files on disk so resolveArabicFontsDir()
// only returns the bundled dir when a real Noto weight is present.
const BUNDLED_FONT_NAMES = [
  "NotoSansArabic-Bold.ttf",
  "NotoSansArabic-SemiBold.ttf",
  "NotoSansArabic-Regular.ttf",
];

/** Absolute path to `assets/fonts` (or a usable Windows Fonts fallback). */
export function resolveArabicFontsDir(): string | null {
  const bundled = path.resolve(process.cwd(), "assets", "fonts");
  if (BUNDLED_FONT_NAMES.some((name) => existsSync(path.join(bundled, name)))) {
    return bundled;
  }

  // Windows system fonts — Tahoma / Segoe UI cover Arabic.
  const winFonts = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
  if (
    existsSync(path.join(winFonts, "tahoma.ttf")) ||
    existsSync(path.join(winFonts, "segoeui.ttf")) ||
    existsSync(path.join(winFonts, "arial.ttf"))
  ) {
    return winFonts;
  }

  return null;
}

/** Font family name to put in the ASS Style line. libass picks the matching
 * weight from fontsdir= automatically based on the style's Bold flag. */
export function resolveArabicFontFamily(): string {
  const bundled = path.resolve(process.cwd(), "assets", "fonts");
  if (BUNDLED_FONT_NAMES.some((name) => existsSync(path.join(bundled, name)))) {
    return "Noto Sans Arabic";
  }
  // System fallbacks (Windows).
  const winFonts = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
  if (existsSync(path.join(winFonts, "segoeui.ttf"))) return "Segoe UI";
  if (existsSync(path.join(winFonts, "tahoma.ttf"))) return "Tahoma";
  return "Arial";
}

/** Escape a path for use inside an ffmpeg `subtitles=` filter option. */
export function escapeFontsDirForFilter(fontsDir: string): string {
  return fontsDir.split(path.sep).join("/").replace(/:/g, "\\:");
}
