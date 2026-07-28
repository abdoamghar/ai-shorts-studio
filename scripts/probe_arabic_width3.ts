// Render each Arabic word in isolation at a known x and measure the actual
// ink width by decoding the PNG. Compare to measureText's estimate.
// Run:  npx tsx scripts/probe_arabic_width3.ts
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const FONT_SIZE = 78;
const VIDEO_W = 1080;
const VIDEO_H = 200;       // short strip — one word per row
const LEFT_X = 60;         // \an4 -- anchored at left
const ROW_H = 150;

// Probe words spanning typical Arabic shapes (initial/medial/final/isolated,
// long/short, with shadda+tashkeel and without). Includes ones from the
// probe scripts plus a few common real-line words.
const WORDS = [
  "ماذا", "هل", "نعرف", "المستقبل", "بالحقيقة", "هذا", "عن",
  "الواقع", "نحن", "انه", "اي", "طريقة", "كلام", "العالم", "وحياتنا",
  "أريد", "أن", "أفهم", "اللّغة", "العربية",
];

const FONTS_DIR = path.resolve(process.cwd(), "assets", "fonts");
const OUT_DIR = path.resolve(process.cwd(), ".tmp_ar_probe");
const FCD = path.join(OUT_DIR, "fonts");

// metrics.ts inlined (server-only import can't be required from a tsx probe)
const AVG_ARABIC_EM = 0.72;
const ARABIC_INFLATE = 1.08;
const ARIAL_AVG = 0.556;
const SPACE_EM = 0.278;
function measureEstimate(text: string): number {
  let wEm = 0;
  for (const ch of text) {
    if (ch >= "\u0600" && ch <= "\u06FF") wEm += AVG_ARABIC_EM;
    else if (ch === " ") wEm += SPACE_EM;
    else wEm += ARIAL_AVG;
  }
  return Math.round(wEm * FONT_SIZE * ARABIC_INFLATE);
}

function pngHeader(): Buffer { throw new Error("unused"); }

// Decode an 8-bit, non-interlaced, color-type-2 (RGB) or color-type-6 (RGBA) PNG.
// (libass ffmpeg render uses RGB24 via the png encoder with `-q:v 2 -pix_fmt rgb24`.)
function decodePng(buf: Buffer): { w: number; h: number; bpp: number; data: Buffer } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let pos = 8;
  let width = 0, height = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (type === "IHDR") {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      colorType = buf.readUInt8(pos + 17);
      interlace = buf.readUInt8(pos + 20);
    } else if (type === "IDAT") {
      idat.push(buf.subarray(pos + 8, pos + 8 + len));
    } else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported colorType ${colorType}`);
  const stride = width * bpp + 1;
  const out = Buffer.alloc(width * height * bpp);
  const prevRow = Buffer.alloc(width * bpp);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const ftype = inflated[rowStart];
    const row = Buffer.alloc(width * bpp);
    for (let x = 0; x < width; x++) {
      const src = inflated.subarray(rowStart + 1 + x * bpp, rowStart + 1 + (x + 1) * bpp);
      const a = x > 0 ? row.subarray((x - 1) * bpp, x * bpp) : Buffer.alloc(bpp);
      const b = prevRow.subarray(x * bpp, (x + 1) * bpp);
      const c = x > 0 ? prevRow.subarray((x - 1) * bpp, x * bpp) : Buffer.alloc(bpp);
      for (let k = 0; k < bpp; k++) {
        const v = src[k];
        const left = a[k] ?? 0, up = b[k] ?? 0, ul = c[k] ?? 0;
        let recon = v;
        if (ftype === 1) recon = (v + left) & 0xff;
        else if (ftype === 2) recon = (v + up) & 0xff;
        else if (ftype === 3) recon = (v + ((left + up) >> 1)) & 0xff;
        else if (ftype === 4) {
          const p = left + up - ul;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
          const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
          recon = (v + pred) & 0xff;
        }
        row[x * bpp + k] = recon;
      }
    }
    out.set(row, y * width * bpp);
    prevRow.set(row);
  }
  return { w: width, h: height, bpp, data: out };
}

async function render(wordsForOneRender: string[]): Promise<string | null> {
  // Build an ASS that stacks each word on its own row at \an4 LEFT_X, so we can
  // measure one word at a time without adjacent-word interference.
  const events = wordsForOneRender.map((w, i) => {
    const y = ROW_H / 2 + i * ROW_H + 20;
    return `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\pos(${LEFT_X},${y})\\an4\\bord0\\shad0}${w}`;
  });
  const ass = [
    "[Script Info]", "; probe", "ScriptType: v4.00+",
    "PlayResX: 1080", `PlayResY: ${VIDEO_H}`, "WrapStyle: 2",
    "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Noto Sans Arabic,${FONT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,4,0,0,0,1`,
    "", "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
  ].join("\r\n") + "\r\n";
  writeFileSync(path.join(OUT_DIR, "probe.ass"), ass, "utf8");

  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=0x000000:s=${VIDEO_W}x${VIDEO_H}:d=1`,
    "-filter_complex", "subtitles=probe.ass:fontsdir='fonts'",
    "-frames:v", "1", "-update", "1", "-q:v", "2", "-pix_fmt", "rgb24",
    "probe.png",
  ];
  const code = await new Promise<number>((resolve) => {
    const p = spawn("ffmpeg", args, { cwd: OUT_DIR, windowsHide: true });
    p.on("close", resolve);
    p.on("error", () => resolve(1));
  });
  const pngPath = path.join(OUT_DIR, "probe.png");
  if (code !== 0 || !existsSync(pngPath)) return "FAIL_RENDER";
  return pngPath;
}

interface WordMeasure { word: string; est: number; real: number; ratio: number; }

function measure(pngPath: string, words: string[]): WordMeasure[] {
  const { w: W, h: H, bpp, data } = decodePng(readFileSync(pngPath));
  const INK = 120; // ink threshold on white-ish glyphs over black bg
  // For each word, scan its row band (top of row to top of next row), find
  // min/max ink X.
  const results: WordMeasure[] = [];
  for (let i = 0; i < words.length; i++) {
    const y0 = Math.round(0 + i * ROW_H + 10);
    const y1 = Math.min(H - 1, Math.round(y0 + ROW_H - 20));
    let minX = W, maxX = -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * bpp;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        // text is white on black; ink = high luminance.
        if (r >= INK && g >= INK && b >= INK) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    const real = maxX >= 0 ? (maxX - minX + 1) : 0;
    const est = measureEstimate(words[i]);
    results.push({ word: words[i], est, real, ratio: est > 0 && real > 0 ? real / est : 0 });
  }
  return results;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(FCD, { recursive: true });
  for (const name of readdirSync(FONTS_DIR)) if (/\.ttf$/i.test(name)) copyFileSync(path.join(FONTS_DIR, name), path.join(FCD, name));

  // one render with ALL words stacked, one row each (faster than N renders).
  const png = await render(WORDS);
  if (png === "FAIL_RENDER" || !png) {
    console.error("render failed");
    process.exit(1);
  }
  const measures = measure(png as string, WORDS);
  console.log("\nWord, estPx(measured), realPx(ink), ratio(real/est):");
  let sum = 0, n = 0;
  for (const m of measures) {
    console.log(`  ${m.word.padEnd(14)} est=${String(m.est).padStart(4)}  real=${String(m.real).padStart(4)}  ratio=${m.ratio.toFixed(3)}`);
    if (m.ratio > 0) { sum += m.ratio; n++; }
  }
  if (n > 0) {
    const mean = sum / n;
    console.log(`\nMean real/measured ratio = ${mean.toFixed(3)}`);
    console.log(`=> Arabic BOX_WIDTH_INK_RATIO to apply in ass-ar.ts (replace the 1.0 implicit): ${mean.toFixed(3)}`);
    // Suggest what to change metrics.ts to instead so ESTIMATES are close to real,
    // so the per-word measured grid used for line wrapping is honest too.
    const impliedCharEm = 0.72 * mean / 1.08; // current is 0.72*1.08; replace those.
    console.log(`=> To make measureText HONEST for Arabic: replace the 0.72 advance + 1.08 inflate (line 189 + 196 in metrics.ts)`);
    console.log(`   with an Arabic per-char advance of ~${impliedCharEm.toFixed(3)} em (and remove the 1.08 inflate branch).`);
  }
  rmSync(OUT_DIR, { recursive: true, force: true });
}

void main();
