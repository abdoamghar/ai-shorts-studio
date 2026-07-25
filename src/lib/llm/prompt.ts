import "server-only";

import { CLIP_JSON_CONTRACT, SCORING_RUBRIC } from "@/lib/llm/schema";

/**
 * Build the user message for clip discovery from a transcript + project clip
 * settings + a category prompt template's guidance text.
 *
 * The transcript is reduced to compact `[{s,e,t}]` lines (sentence-level
 * segments already came from Whisper). If it's very long we chunk by an
 * estimated character budget (≈4 chars/token, leave headroom under the model's
 * context); chunks are numbered and the model is told to cover all chunks.
 */

export type ClipSettings = {
  targetClipSec: number; // desired clip length
  maxClips: number; // cap the model should aim to return
  promptTemplateText: string; // category-specific guidance (user-editable)
};

export type PromptInput = {
  segments: Array<{ idx: number; startMs: number; endMs: number; text: string }>;
  /** Total source duration in seconds, for context. */
  durationSec: number;
  settings: ClipSettings;
};

/** Rough token budget for the transcript payload (increased for full-video context with 1-2M ctx models). */
const TRANSCRIPT_TOKEN_BUDGET = 500_000;
const CHARS_PER_TOKEN = 4;

function fmtTs(ms: number): string {
  const s = ms / 1000;
  return s.toFixed(1).replace(/\.0$/, "");
}

/** Chunk lines so each chunk fits the token budget; return labeled chunks. */
function chunkTranscript(
  segments: PromptInput["segments"],
  charBudget: number,
): string[] {
  const lines = segments.map(
    (seg) => `[${fmtTs(seg.startMs)} - ${fmtTs(seg.endMs)}] ${seg.text}`,
  );
  if (lines.join("\n").length <= charBudget) {
    return [lines.join("\n")];
  }
  const chunks: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length > charBudget && buf.length > 0) {
      chunks.push(buf.join("\n"));
      buf = [line];
      len = line.length;
    } else {
      buf.push(line);
      len += line.length + 1;
    }
  }
  if (buf.length) chunks.push(buf.join("\n"));
  return chunks;
}

export function buildClipPrompt(input: PromptInput): string {
  const { settings, durationSec } = input;
  const rubric = SCORING_RUBRIC; // Now fully hardcoded in schema.ts

  const charBudget = TRANSCRIPT_TOKEN_BUDGET * CHARS_PER_TOKEN;
  const chunks = chunkTranscript(input.segments, charBudget);

  const transcriptBlock =
    chunks.length === 1
      ? segmentsBlock(chunks[0])
      : chunks
          .map((c, i) => `[TRANSCRIPT CHUNK ${i + 1}/${chunks.length}]\n${segmentsBlock(c)}`)
          .join("\n\n");

  return `${settings.promptTemplateText}

Source duration: ${Math.round(durationSec)}s. Aim for up to ${settings.maxClips} clips.

Respond with this EXACT JSON shape:
${CLIP_JSON_CONTRACT}

${rubric}

${transcriptBlock}`;

  function segmentsBlock(body: string): string {
    return `--- TRANSCRIPT (times in SECONDS, source-absolute) ---
${body}
--- END TRANSCRIPT ---`;
  }
}
