import "server-only";
import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveFfmpeg } from "@/lib/binaries";
import { buildAss } from "@/lib/subtitles/ass";
import { buildLines } from "@/lib/subtitles/lines";
import type { StyleJson } from "@/lib/subtitles/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StyleJsonBody = z.object({
  font: z.string().min(1).max(80),
  fontSize: z.number().int().min(20).max(200),
  primaryHsl: z.tuple([z.number(), z.number(), z.number()]),
  outlineHsl: z.tuple([z.number(), z.number(), z.number()]),
  outline: z.number().min(0).max(40),
  shadow: z.number().min(0).max(40),
  bold: z.number().min(-1).max(1),
  alignment: z.number().int().min(1).max(9),
  marginL: z.number().int().min(0).max(400),
  marginV: z.number().int().min(0).max(960),
  highlightHsl: z.tuple([z.number(), z.number(), z.number()]),
  animationSpeed: z.number().min(0.1).max(4),
  maxChars: z.number().int().min(8).max(80),
  maxLines: z.number().int().min(1).max(5),
});

const Body = z.object({
  styleJson: StyleJsonBody,
  /** Optional sample line to render. */
  sample: z.string().min(1).max(140).optional(),
});

const DEFAULT_SAMPLE = "This is what your subtitle looks like";

function hslToHex([h, s, l]: [number, number, number]): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp < 6) [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `0x${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const style = parsed.data.styleJson as StyleJson;

  const sample = parsed.data.sample ?? DEFAULT_SAMPLE;
  // Build a single clip-relative line from the sample words (fake even timing)
  // so the karaoke highlight positions on a readable word.
  const words = sample.split(/\s+/).map((text, i) => ({
    text,
    startMs: i * 250,
    endMs: (i + 1) * 250,
  }));
  const lines = buildLines(words, 0, style.maxChars, style.maxLines);
  const ass = buildAss(lines, style);

  const dir = mkdtempSync(path.join(tmpdir(), "shorts-preview-"));
  const assPath = path.join(dir, "sample.ass");
  const pngPath = path.join(dir, "sample.png");
  writeFileSync(assPath, ass, "utf8");

  const color = hslToHex([222, 0.16, 0.16]); // charcoal background
  const relAss = path.relative(dir, assPath).split(path.sep).join("/");
  const subsFilterArg = relAss.replace(/\\/g, "/").replace(/:/g, "\\:");

  const ffmpeg = resolveFfmpeg();
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=1080x1920:d=1`,
    "-filter_complex",
    `subtitles=${subsFilterArg}`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    pngPath,
  ];

  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(ffmpeg, args, { cwd: dir, windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });

  if (!ok) {
    rmSync(dir, { recursive: true, force: true });
    return Response.json({ error: "Preview render failed." }, { status: 500 });
  }

  try {
    const png = await import("node:fs/promises");
    const buf = await png.readFile(pngPath);
    rmSync(dir, { recursive: true, force: true });
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return Response.json({ error: "Preview render failed." }, { status: 500 });
  }
}
