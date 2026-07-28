// Calibrate the Arabic ink ratio: render known Arabic words with Noto Sans
// Arabic, decode the PNG, find each word's real ink width, and compare to
// measureText's output. The ratio (real / measured) is what ass-ar.ts should
// apply like ass.ts's BOX_WIDTH_INK_RATIO does for English.
//
// Usage:  npx tsx scripts/probe_arabic_width.ts
// No "server-only" import — keep this pure TS for tsx.

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Inline-replicate measureText so we don't depend on the "server-only" import
// in metrics.ts. Keep these numbers in sync with src/lib/subtitles/metrics.ts.
const AVG_ARABIC_EM = 0.72; // metrics.ts:189 fallback per char
const ARABIC_INFLATE = 1.08; // metrics.ts:196
const SPACE_EM_ARIAL = 0.278; // metrics.ts ARIAL spaceAdvance

function measureTextArabic(text: string, fontSize: number): number {
  let widthEm = 0;
  for (const ch of text) {
    if (ch >= "\u0600" && ch <= "\u06FF") widthEm += AVG_ARABIC_EM;
    else if (ch === " ") widthEm += SPACE_EM_ARIAL;
    else widthEm += 0.556; // latin avg
  }
  return Math.round(widthEm * fontSize * ARABIC_INFLATE);
}

const FONT_SIZE = 78; // matches ARABIC_SAFE_STYLE.fontSize
const VIDEO_W = 1080;
const VIDEO_H = 1920;
const LEFT_X = 80;

const SAMPLE_WORDS = ["ماذا", "هل", "نعرف", "المستقبل", "بالحقيقة", "هذا"];

function makeHeader(): string {
  return [
    "[Script Info]", "; probe", "ScriptType: v4.00+",
    "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2",
    "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Noto Sans Arabic,${FONT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,4,0,0,0,1`,
    "", "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\r\n") + "\r\n";
}

function buildProbeAss(): string {
  const events: string[] = [];
  const lineHeightPx = Math.round(FONT_SIZE * 1.4);
  const topMarginV = VIDEO_H - lineHeightPx * (SAMPLE_WORDS.length + 1);
  SAMPLE_WORDS.forEach((w, i) => {
    const mv = topMarginV + i * lineHeightPx;
    const text = `{\\pos(${LEFT_X},${VIDEO_H - mv})\\an4\\bord0\\shad0}${w}`;
    events.push(`Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,${text}`);
  });
  return makeHeader() + events.join("\r\n") + "\r\n";
}

// Tiny portable PNG decoder (8-bit, no interlace, single IDAT).
function decodePng(buf: Buffer): { w: number; h: number; bpp: number; data: Buffer } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let pos = 8;
  let width = 0, height = 0, colorType = 0, interlace = 0;
  const idatChunks: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (type === "IHDR") {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      colorType = buf.readUInt8(pos + 17);
      interlace = buf.readUInt8(pos + 20);
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  // PNG IDAT chunks are zlib-wrapped deflate (RFC 1950), not raw deflate
  // (RFC 1951). Use inflateSync (zlib wrapper) — inflateRawSync errors with
  // "invalid stored block lengths" on the 2-byte zlib header.
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp + 1;
  if (inflated.length !== stride * height)
    throw new Error(`inflate size mismatch: got ${inflated.length} expected ${stride * height}`);
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
        const left = a[k] ?? 0;
        const up = b[k] ?? 0;
        const ul = c[k] ?? 0;
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

async function main(): Promise<void> {
  const ROOT = process.cwd();
  const OUT_DIR = path.join(ROOT, ".tmp_ar_probe");
  mkdirSync(OUT_DIR, { recursive: true });
  const ASS_PATH = path.join(OUT_DIR, "probe.ass");
  const PNG_PATH = path.join(OUT_DIR, "probe.png");
  const FONTS_DIR = path.resolve(ROOT, "assets", "fonts");
  writeFileSync(ASS_PATH, buildProbeAss(), "utf8");

  console.log(`\nWords measured by metrics.ts (size=${FONT_SIZE}):`);
  for (const w of SAMPLE_WORDS) {
    console.log(`  ${w.padEnd(12)} => ${measureTextArabic(w, FONT_SIZE)} px`);
  }

  // ffmpeg/libass on Windows chokes on drive-letter colons in the
  // subtitles= path even when escaped. Mirror the app's working render
  // (video/render.ts) by running with cwd=OUT_DIR and passing BARE
  // relative paths for both the .ass and the fontsdir, copying the bundled
  // Noto weights into the temp dir so fontsdir stays a relative name.
  const fontsCopyDir = path.join(OUT_DIR, "fonts");
  mkdirSync(fontsCopyDir, { recursive: true });
  for (const name of readdirSync(FONTS_DIR)) {
    if (/\.ttf$/i.test(name)) copyFileSync(path.join(FONTS_DIR, name), path.join(fontsCopyDir, name));
  }
  const filter = `subtitles=probe.ass:fontsdir='fonts'`;

  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x101820:s=1080x1920:d=1",
    "-filter_complex", filter,
    "-frames:v", "1", "-q:v", "2", "probe.png",
  ];

  const stderrBuf: string[] = [];
  const code = await new Promise<number>((resolve) => {
    const p = spawn("ffmpeg", args, { cwd: OUT_DIR, windowsHide: true });
    p.stderr?.on("data", (c: Buffer) => stderrBuf.push(c.toString("utf8")));
    p.on("close", resolve);
    p.on("error", (e) => { console.error("ffmpeg spawn error:", e.message); resolve(1); });
  });
  if (code !== 0 || !existsSync(PNG_PATH)) {
    console.error("Render failed (code=" + code + ").");
    console.error("ffmpeg stderr:\n" + stderrBuf.join(""));
    console.error("filter: " + filter);
    process.exit(1);
  }

  const { w: W, h: H, bpp, data } = decodePng(readFileSync(PNG_PATH));
  const lum = (x: number, y: number): number => {
    const i = (y * W + x) * bpp;
    if (bpp >= 3) return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    return data[i] * 3;
  };
  const INK = 180;

  const brightRows: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (lum(x, y) >= INK) { brightRows.push(y); break; }
    }
  }
  const bands: { y0: number; y1: number }[] = [];
  let curStart = brightRows[0] ?? 0;
  let curEnd = curStart;
  const gapTol = Math.round(FONT_SIZE * 0.6);
  for (let i = 1; i < brightRows.length; i++) {
    if (brightRows[i] - curEnd <= gapTol) curEnd = brightRows[i];
    else { bands.push({ y0: curStart, y1: curEnd }); curStart = brightRows[i]; curEnd = curStart; }
  }
  if (brightRows.length) bands.push({ y0: curStart, y1: curEnd });

  console.log(`\nDetected ${bands.length} word band(s) in render:`);
  let ratioSum = 0;
  let ratioCount = 0;
  for (let bi = 0; bi < bands.length; bi++) {
    const b = bands[bi];
    let minX = W, maxX = -1;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = 0; x < W; x++) {
        if (lum(x, y) >= INK) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      }
    }
    const realW = maxX - minX + 1;
    const idx = Math.min(bi, SAMPLE_WORDS.length - 1);
    const measured = measureTextArabic(SAMPLE_WORDS[idx], FONT_SIZE);
    const ratio = measured > 0 ? realW / measured : 0;
    if (measured > 0) { ratioSum += ratio; ratioCount++; }
    console.log(
      `  #${idx} ${SAMPLE_WORDS[idx].padEnd(12)} band y=${b.y0}-${b.y1}  leftInk=${minX}  realW=${realW}px  measured=${measured}px  ratio(real/measured)=${ratio.toFixed(3)}`,
    );
  }
  if (ratioCount > 0) {
    const mean = ratioSum / ratioCount;
    console.log(`\nMean ratio (real/measured) = ${mean.toFixed(3)}`);
    console.log(`=> Arabic ink-ratio to apply in ass-ar.ts: ${mean.toFixed(3)}`);
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
}

void main();
