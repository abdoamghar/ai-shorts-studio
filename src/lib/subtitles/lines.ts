import "server-only";

/**
 * Shared subtitle-line building. Turns a clip's transcript segment(s) into
 * clip-relative subtitle "lines" — each line is a chunk of words that fits
 * within the theme's maxChars/maxLines, timed from the first to last word.
 *
 * Both the SRT writer (plain wrapped text) and the ASS writer (per-word
 * karaoke) consume these. The pipeline step (`subtitles.ts`) loads the
 * transcript words for a clip's window and calls `buildLines`.
 */

export type WordLine = {
  /** Clip-relative start, ms. */
  startMs: number;
  /** Clip-relative end, ms. */
  endMs: number;
  /** Joined display text (words separated by single spaces). */
  text: string;
  /** The words composing this line (ASS karaoke needs these). */
  words: Array<{ text: string; startMs: number; endMs: number }>;
};

export type ClipWord = {
  text: string;
  startMs: number;
  endMs: number;
};

/** Greedy-wrap a line of text to <= maxChars per visual line, up to maxLines. */
export function wrapLine(text: string, maxChars: number, maxLines: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const visual: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > maxChars && cur) {
      visual.push(cur);
      cur = w;
      if (visual.length >= maxLines - 1) {
        // last line swallows the rest.
        cur = w;
        break;
      }
    } else {
      cur = candidate;
    }
  }
  if (cur) visual.push(cur);
  // If the last line overflowed words (we broke early), append remaining.
  if (visual.length === maxLines && cur) {
    // already handled; nothing to do.
  }
  return visual.join("\r\n");
}

/**
 * Group clip words into subtitle lines. Each line spans up to ~2 visual rows
 * of maxChars; a new line also starts whenever the previous line is "full".
 * Times are shifted to be clip-relative: word.startMs is expected to be
 * SOURCE-absolute, and we subtract the clip's start so the first word is ~0.
 */
export function buildLines(
  words: ClipWord[],
  clipStartMs: number,
  maxChars: number,
  maxLines: number,
): WordLine[] {
  if (words.length === 0) return [];
  const lines: WordLine[] = [];
  let buf: ClipWord[] = [];
  let lineLen = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const text = buf.map((w) => w.text).join(" ");
    lines.push({
      startMs: buf[0].startMs - clipStartMs,
      endMs: buf[buf.length - 1].endMs - clipStartMs,
      text,
      words: buf.map((w) => ({
        text: w.text,
        startMs: w.startMs - clipStartMs,
        endMs: w.endMs - clipStartMs,
      })),
    });
    buf = [];
    lineLen = 0;
  };

  for (const w of words) {
    const addLen = (lineLen ? lineLen + 1 : 0) + w.text.length;
    if (lineLen > 0 && addLen > maxChars * maxLines) {
      flush();
    }
    buf.push(w);
    lineLen = lineLen ? lineLen + 1 + w.text.length : w.text.length;
  }
  flush();
  return lines;
}
