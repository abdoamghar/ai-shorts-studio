// Calibrate the Arabic ink ratio: render each word on its own single frame
// (no stacking) and use ffmpeg cropdetect to get the real pixel width.
// Usage:  npx tsx scripts/probe_arabic_width2.ts

import { spawn } from "node:child_process";
import { writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";

const FONT_SIZE = 78;
const VIDEO_W = 1080;
const VIDEO_H = 120;
const LEFT_X = 60;
const OUT_DIR = path.resolve(process.cwd(), ".tmp_ar_probe");
const FONTS_DIR = path.resolve(process.cwd(), "assets", "fonts");

const WORDS = ["ماذا", "هل", "نعرف", "المستقبل", "بالحقيقة", "هذا", "عن"];

function assForWord(word: string): string {
  return [
    "[Script Info]", "; probe",
    "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 120",
    "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Noto Sans Arabic,${FONT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,4,0,0,0,1`,
    "", "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\pos(${LEFT_X},60)\\an4\\bord0\\shad0}${word}`,
  ].join("\r\n") + "\r\n";
}

// measure as metrics.ts would
const AVG_ARABIC_EM = 0.72;
const ARABIC_INFLATE = 1.08;
function measureMw(word: string): number {
  let wEm = 0;
  for (const ch of word) {
    if (ch >= "\u0600" && ch <= "\u06FF") wEm += AVG_ARABIC_EM;
    else if (ch === " ") wEm += 0.278;
    else wEm += 0.556;
  }
  return Math.round(wEm * FONT_SIZE * ARABIC_INFLATE);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // Copy fonts
  const fcd = path.join(OUT_DIR, "fonts");
  mkdirSync(fcd, { recursive: true });
  for (const name of readdirSync(FONTS_DIR)) {
    if (/\.ttf$/i.test(name)) copyFileSync(path.join(FONTS_DIR, name), path.join(fcd, name));
  }

  console.log("Word,mCharCount,measuredPx,realPx,ratio");
  for (const w of WORDS) {
    const assPath = path.join(OUT_DIR, `${w}.ass`);
    const pngPath = path.join(OUT_DIR, `${w}.png`);
    writeFileSync(assPath, assForWord(w), "utf8");

    const filter = `subtitles=${w}.ass:fontsdir='fonts'`;
    const args = [
"-y", "-hide_banner", "-loglevel", "info",
      "-f", "lavfi", "-i", "color=c=0x101820:s=1080x120:d=1",
      "-filter_complex", `${filter},cropdetect=24:2:0`,
      "-frames:v", "1", "-q:v", "2", pngPath,
    ];
    const p = spawn("ffmpeg", args, { cwd: OUT_DIR, windowsHide: true });
    let stderr = "";
    p.stderr?.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    const [code] = await once(p, "close");
    if (code !== 0 || !existsSync(pngPath)) {
      console.error(`FAIL ${w}: ffmpeg exit ${code}`);
      continue;
    }

    // Parse cropdetect output: crop=W:H:X:Y
    const m = stderr.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
    if (!m) { console.error(`FAIL ${w}: no cropdetect`); continue; }
    const realW = parseInt(m[1], 10);
    const measured = measureMw(w);
    const ratio = realW / measured;
    console.log(`${w},${Array.from(w).length},${measured},${realW},${ratio.toFixed(3)}`);
    rmSync(assPath, { force: true });
    rmSync(pngPath, { force: true });
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
}

void main();