import "server-only";

import { wrapLine } from "@/lib/subtitles/lines";

/**
 * SRT writer. Each line becomes one cue; words within maxChars are grouped
 * onto up to maxLines by simple greedy fill. Times are CLIP-RELATIVE so the
 * SRT can be exported alongside the trimmed clip and stays in sync with the
 * burned-in ASS (which ffmpeg burns using the same timeline).
 */

export function buildSrt(
  lines: Array<{ startMs: number; endMs: number; text: string }>,
  maxChars: number,
  maxLines: number,
): string {
  const cues: string[] = [];
  lines.forEach((line, i) => {
    const wrapped = wrapLine(line.text, maxChars, maxLines);
    cues.push(
      [
        String(i + 1),
        `${srtTime(line.startMs)} --> ${srtTime(line.endMs)}`,
        wrapped,
        "",
      ].join("\r\n"),
    );
  });
  return cues.join("\r\n");
}

function srtTime(ms: number): string {
  const csTotal = Math.max(0, Math.round(ms / 10));
  const cs = csTotal % 100;
  const sTotal = Math.floor(csTotal / 100);
  const s = sTotal % 60;
  const mTotal = Math.floor(sTotal / 60);
  const m = mTotal % 60;
  const h = Math.floor(mTotal / 60);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(cs)}`;
}
