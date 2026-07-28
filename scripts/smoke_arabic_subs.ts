/**
 * Local smoke: English karaoke ASS unchanged structure + Arabic line-level ASS
 * + ffmpeg fontsdir preview. Does not call the LLM or hit YouTube.
 *
 * Run: npx tsx scripts/smoke_arabic_subs.ts
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { resolveFfmpeg } from "../src/lib/binaries";
import { buildAss } from "../src/lib/subtitles/ass";
import { buildAssArabic, ARABIC_SAFE_STYLE } from "../src/lib/subtitles/ass-ar";
import {
  escapeFontsDirForFilter,
  resolveArabicFontsDir,
  resolveArabicFontFamily,
} from "../src/lib/subtitles/fonts-ar";
import { buildLines } from "../src/lib/subtitles/lines";

const outDir = path.resolve("storage/_smoke_ar");
mkdirSync(outDir, { recursive: true });

const enWords = [
  { text: "THEY", startMs: 0, endMs: 300 },
  { text: "KNOW", startMs: 300, endMs: 600 },
  { text: "WHO", startMs: 600, endMs: 900 },
];
const enLines = buildLines(enWords, 0, 22, 2);
const enAss = buildAss(enLines, {
  font: "Arial",
  fontSize: 82,
  primaryHsl: [0, 0, 1],
  outlineHsl: [0, 0, 0],
  outline: 10,
  shadow: 0,
  bold: 1,
  highlightHsl: [42, 1, 0.55],
  animationSpeed: 1,
  maxChars: 22,
  maxLines: 2,
  wordPillMode: "all",
  uppercase: true,
});
writeFileSync(path.join(outDir, "en_sample.ass"), enAss, "utf8");

const arAss = buildAssArabic(
  [{ startMs: 0, endMs: 2000, text: "هذا اختبار للترجمة العربية القصيرة" }],
  ARABIC_SAFE_STYLE,
);
writeFileSync(path.join(outDir, "ar_sample.ass"), arAss, "utf8");

const fontsDir = resolveArabicFontsDir();
const fontFamily = resolveArabicFontFamily();
const arHasArabic = /[\u0600-\u06FF]/.test(arAss);
// Arabic ASS IS the per-word pill karaoke design (BgPill + Highlight + per-word
// \pos text), so it MUST contain vector drawings. The OLD line-level-only
// assertion is stale since the pill-mode redesign — guard the structural shape
// instead: BgPill + Highlight layers + Dialogue events.
const arHasPills = arAss.includes("\\p1");

console.log(
  JSON.stringify(
    {
      enDialogue: enAss.includes("Dialogue:"),
      enBytes: Buffer.byteLength(enAss),
      arBytes: Buffer.byteLength(arAss),
      arHasArabic,
      arHasPills,
      arPillLayers: arAss.includes("BgPill") && arAss.includes("Highlight"),
      fontFamily,
      fontsDir,
    },
    null,
    2,
  ),
);

if (!fontsDir) throw new Error("No Arabic fonts dir resolved");
if (!arHasArabic) throw new Error("Arabic ASS missing Arabic script");
if (!arHasPills) throw new Error("Arabic ASS missing per-word vector pills (BgPill/Highlight)");
if (!arAss.includes("BgPill") || !arAss.includes("Highlight")) {
  throw new Error("Arabic ASS missing BgPill/Highlight style layer");
}

const ffmpeg = resolveFfmpeg();
const fontsEsc = escapeFontsDirForFilter(fontsDir);
const filter = `subtitles=ar_sample.ass:fontsdir='${fontsEsc}'`;
const png = path.join(outDir, "ar_preview.png");
const r = spawnSync(
  ffmpeg,
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x1a1f2e:s=1080x1920:d=1",
    "-filter_complex",
    filter,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    png,
  ],
  { cwd: outDir, encoding: "utf8" },
);

console.log(
  JSON.stringify(
    {
      ffmpegCode: r.status,
      pngExists: existsSync(png),
      stderr: (r.stderr || "").slice(0, 400),
    },
    null,
    2,
  ),
);

if (r.status !== 0 || !existsSync(png)) {
  process.exit(1);
}

console.log("SMOKE_OK");
