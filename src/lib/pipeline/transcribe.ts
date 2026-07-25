import "server-only";
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { projects, transcript } from "@/lib/db/schema";
import { resolvePython } from "@/lib/binaries";
import { assetPath, PROJECT_ROOT } from "@/lib/storage/paths";
import { audioPath } from "@/lib/pipeline/audio";
import type { JobContext } from "@/lib/jobs/runner";

/**
 * Step 3 — Transcribe the extracted audio with faster-whisper (Python subprocess).
 *
 * spawns `python scripts/whisper_compat.py …` which emits NDJSON on stdout:
 *   {"type":"ready",...}{"type":"segment",...}{"type":"progress",...}{"type":"done",...}
 *
 * Each segment becomes a row in `transcript` (idx, startMs, endMs, text,
 * wordsJson). Progress is the segment's end-vs-total ratio.
 *
 * Reads the whisper model + language from the project's `settingsJson` (with
 * env fallbacks WHISPER_MODEL / WHISPER_LANGUAGE).
 */

export function transcriptPath(projectId: string): string {
  return assetPath(projectId, "transcript.json");
}

export type WhisperSettings = {
  model: string;
  language: string; // "auto" or a code like "en"
  modelDir?: string;
};

const VALID_MODELS = new Set(["tiny", "base", "small", "medium", "large", "large-v3"]);

function readWhisperSettings(projectId: string): WhisperSettings {
  const row = db.select().from(projects).where(eq(projects.id, projectId)).get();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = row?.settingsJson ? JSON.parse(row.settingsJson) : {};
  } catch {
    parsed = {};
  }
  const modelRaw = (parsed.whisperModel as string) ?? process.env.WHISPER_MODEL ?? "base";
  const model = VALID_MODELS.has(modelRaw) ? modelRaw : "base";
  const languageRaw =
    (parsed.language as string) ?? process.env.WHISPER_LANGUAGE ?? "auto";
  const modelDir = (parsed.whisperModelDir as string) ?? process.env.WHISPER_MODEL_DIR;
  return {
    model,
    language: languageRaw && languageRaw.toLowerCase() !== "auto" ? languageRaw : "auto",
    modelDir: modelDir || undefined,
  };
}

type ReadyLine = { type: "ready"; model: string; language: string; duration_sec: number };
type SegmentLine = {
  type: "segment";
  idx: number;
  start: number;
  end: number;
  text: string;
  words: Array<{ start: number; end: number; word: string; probability: number }>;
};
type ProgressLine = { type: "progress"; done_sec: number };
type DoneLine = { type: "done"; segments: number };
type ErrorLine = { type: "error"; message: string };
type StreamLine = ReadyLine | SegmentLine | ProgressLine | DoneLine | ErrorLine;

export async function runTranscribe(ctx: JobContext): Promise<void> {
  ctx.log("faster-whisper transcribing audio");
  const python = resolvePython();
  const audio = audioPath(ctx.projectId);
  if (!existsSync(audio)) {
    throw new Error(`Audio file missing for transcription: ${audio}`);
  }

  const ws = readWhisperSettings(ctx.projectId);
  const script = path.join(PROJECT_ROOT, "scripts", "whisper_compat.py");

  // Reset transcript for this project on (re)transcription.
  // The schema FK is RESTRICT-less; we delete + re-insert in order.
  // (transcript.projectId references projects.id onDelete cascade — deleting
  // projects would cascade; here we just clear rows for this project.)
  await clearTranscript(ctx.projectId);

  const args = [
    script,
    "--audio",
    audio,
    "--model",
    ws.model,
    "--language",
    ws.language,
    "--word-timestamps",
    "--vad",
  ];
  if (ws.modelDir) {
    args.push("--model-dir", ws.modelDir);
  }
  ctx.log(`python whisper_compat.py --model ${ws.model} --language ${ws.language}`);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(python, args, { windowsHide: true });

    let stdoutBuf = "";
    let stderrBuf = "";
    let totalSec = 0;
    let lastPct = -1;
    let segmentCount = 0;
    let pendingRows: Array<{
      idx: number;
      startMs: number;
      endMs: number;
      text: string;
      wordsJson: string;
    }> = [];

    const flushRows = () => {
      if (pendingRows.length === 0) return;
      // Insert in order; idx is monotonic from faster-whisper.
      for (const r of pendingRows) {
        db.insert(transcript)
          .values({
            projectId: ctx.projectId,
            idx: r.idx,
            startMs: r.startMs,
            endMs: r.endMs,
            text: r.text,
            wordsJson: r.wordsJson,
          })
          .run();
      }
      pendingRows = [];
    };

    const handleLine = (line: string) => {
      if (!line) return;
      let evt: StreamLine;
      try {
        evt = JSON.parse(line) as StreamLine;
      } catch {
        return; // ignore non-JSON noise (e.g. python warnings)
      }
      switch (evt.type) {
        case "ready":
          totalSec = evt.duration_sec || 0;
          ctx.log(
            `Whisper ready (model=${evt.model}, language=${evt.language}, ${totalSec.toFixed(0)}s).`,
          );
          break;
        case "segment":
          segmentCount++;
          pendingRows.push({
            idx: evt.idx,
            startMs: Math.round(evt.start * 1000),
            endMs: Math.round(evt.end * 1000),
            text: evt.text,
            wordsJson: JSON.stringify(
              evt.words.map((w) => ({
                text: w.word,
                startMs: Math.round(w.start * 1000),
                endMs: Math.round(w.end * 1000),
                probability: w.probability,
              })),
            ),
          });
          // Insert each segment immediately so a crash mid-transcription keeps
          // partial progress durable.
          flushRows();
          // Progress from segment end.
          if (totalSec > 0) {
            const pct = Math.min(100, Math.round((evt.end / totalSec) * 100));
            if (pct !== lastPct) {
              lastPct = pct;
              ctx.setProgress(pct, `Transcribing… ${segmentCount} segments (${pct}%)`);
            }
          } else {
            ctx.setProgress(50, `Transcribing… ${segmentCount} segments`);
          }
          break;
        case "progress":
          if (totalSec > 0) {
            const pct = Math.min(100, Math.round((evt.done_sec / totalSec) * 100));
            if (pct !== lastPct) {
              lastPct = pct;
              ctx.setProgress(pct, `Transcribing… ${pct}%`);
            }
          }
          break;
        case "done":
          flushRows();
          ctx.log(`Transcription complete: ${evt.segments} segments.`);
          break;
        case "error":
          flushRows();
          reject(new Error(`Whisper error: ${evt.message}`));
          return;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? "";
      for (const l of lines) handleLine(l.trim());
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? "";
      for (const l of lines) {
        const s = l.trim();
        if (!s) continue;
        // faster-whisper / ctranslate2 print warnings to stderr; surface them.
        if (/error|exception|traceback/i.test(s)) {
          ctx.log(s, "error");
        } else if (/warning/i.test(s)) {
          ctx.log(s, "warn");
        }
      }
    });

    child.on("error", (err) => reject(new Error(`Failed to start python: ${err.message}`)));

    child.on("close", (code) => {
      if (stdoutBuf.trim()) handleLine(stdoutBuf.trim());
      if (code !== 0) {
        reject(
          new Error(
            `python whisper_compat.py exited with code ${code}.` +
              (stderrBuf.trim() ? ` stderr: ${stderrBuf.trim().slice(0, 500)}` : ""),
          ),
        );
        return;
      }
      flushRows();
      if (segmentCount === 0) {
        reject(new Error("Transcription produced no segments (audio may be silent)."));
        return;
      }
      // Persist a transcript.json snapshot for debugging / future use.
      try {
        const all = db
          .select()
          .from(transcript)
          .where(eq(transcript.projectId, ctx.projectId))
          .all();
        const snap = all.map((r) => ({
          idx: r.idx,
          startMs: r.startMs,
          endMs: r.endMs,
          text: r.text,
          words: JSON.parse(r.wordsJson),
        }));
        writeFileSync(transcriptPath(ctx.projectId), JSON.stringify({ segments: snap }, null, 2));
      } catch {
        /* snapshot is best-effort */
      }
      ctx.setProgress(100, `Transcribed ${segmentCount} segments`);
      resolve();
    });
  });
}

/** Delete existing transcript rows for a project (idempotent re-transcription). */
async function clearTranscript(projectId: string): Promise<void> {
  db.delete(transcript).where(eq(transcript.projectId, projectId)).run();
  const t = transcriptPath(projectId);
  if (existsSync(t)) rmSync(t, { force: true });
}
