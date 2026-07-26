import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { projects, promptTemplates, transcript } from "@/lib/db/schema";
import { chatJson, type ChatMessage, type ChatJsonResult } from "@/lib/llm/client";
import { buildClipPrompt } from "@/lib/llm/prompt";
import {
  parseClipsResponse,
  persistClips,
  loadTranscriptSegments,
} from "@/lib/llm/clips";
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_KEY } from "@/lib/llm/templates";
import type { JobContext } from "@/lib/jobs/runner";

/**
 * Phase 6 "analyze" step: turn the transcript into ranked, persisted clips.
 *
 * Flow:
 *  1. Read project + settingsJson (targetClipSec, maxClips, promptTemplateKey).
 *  2. Load transcript segments.
 *  3. Resolve the prompt template (DB row by key, else builtin fallback).
 *  4. Build the prompt; call the LLM once.
 *  5. Validate the parsed result; if empty/malformed, re-prompt ONCE with the
 *     raw error appended, then validate again.
 *  6. dedup + cap + sort + persist to `clips`.
 *
 * LlmClientError (missing config / provider error) is rethrown verbatim so the
 * job log tells the user the fix. Other failures throw a clear message.
 */

type ProjectClipSettings = {
  targetClipSec: number;
  maxClips: number | null;
  promptTemplateKey: string;
};

const DEFAULT_TARGET_CLIP_SEC = 30;

import { readGeneralSettings } from "@/lib/settings/store";

function readSettings(project: { settingsJson: string | null }): ProjectClipSettings {
  const generalSettings = readGeneralSettings();
  const raw = project.settingsJson ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const targetClipSec =
    typeof parsed.targetClipSec === "number" && parsed.targetClipSec > 0
      ? parsed.targetClipSec
      : DEFAULT_TARGET_CLIP_SEC;
  const maxClips =
    typeof parsed.maxClips === "number" && (parsed.maxClips as number) > 0
      ? (parsed.maxClips as number)
      : generalSettings.maxClips;
  const promptTemplateKey =
    typeof parsed.promptTemplateKey === "string" && parsed.promptTemplateKey
      ? parsed.promptTemplateKey
      : DEFAULT_TEMPLATE_KEY;
  return { targetClipSec, maxClips, promptTemplateKey };
}

/** Resolve the editable prompt text for a template key (DB wins, else builtin). */
function resolveTemplateText(key: string): { name: string; promptText: string } {
  const row = db
    .select({ name: promptTemplates.name, promptText: promptTemplates.promptText })
    .from(promptTemplates)
    .where(eq(promptTemplates.key, key))
    .get();
  if (row) return { name: row.name, promptText: row.promptText };
  const builtin = BUILTIN_TEMPLATES.find((t) => t.key === key);
  if (builtin) return { name: builtin.name, promptText: builtin.promptText };
  // Fall back to the default builtin if the configured key is unknown.
  const def = BUILTIN_TEMPLATES.find((t) => t.key === DEFAULT_TEMPLATE_KEY)!;
  return { name: def.name, promptText: def.promptText };
}

function segmentsForPrompt(
  rows: Array<{ idx: number; startMs: number; endMs: number; text: string }>,
) {
  return rows.map((r) => ({
    idx: r.idx,
    startMs: r.startMs,
    endMs: r.endMs,
    text: r.text,
  }));
}

export async function runAnalyze(ctx: JobContext): Promise<void> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, ctx.projectId))
    .get();
  if (!project) throw new Error(`Project ${ctx.projectId} not found.`);

  const settings = readSettings(project);
  ctx.log(
    `Analyzing clips (template=${settings.promptTemplateKey}, target=${settings.targetClipSec}s, cap=${settings.maxClips ?? "auto"}).`,
  );

  // Load transcript (sentence-level segments).
  const rows = db
    .select({
      idx: transcript.idx,
      startMs: transcript.startMs,
      endMs: transcript.endMs,
      text: transcript.text,
    })
    .from(transcript)
    .where(eq(transcript.projectId, ctx.projectId))
    .all();

  if (rows.length === 0) {
    throw new Error("No transcript segments found — transcribe step did not run or produced nothing.");
  }

  const tmpl = resolveTemplateText(settings.promptTemplateKey);
  ctx.log(`Using prompt template "${tmpl.name}".`);

  const maxClipsForPrompt = settings.maxClips ?? (project.durationSec && project.durationSec >= 20 * 60 ? 10 : 5);
  const prompt = buildClipPrompt({
    segments: segmentsForPrompt(rows),
    durationSec: project.durationSec ?? 0,
    settings: {
      targetClipSec: settings.targetClipSec,
      maxClips: maxClipsForPrompt,
      promptTemplateText: tmpl.promptText,
    },
  });

  // ── Pre-flight: quick API connectivity test ──────────────────────────
  ctx.setProgress(5, "Testing API connection");
  try {
    await chatJson(
      [{ role: "user", content: "Reply with: {\"ok\":true}" }],
      { temperature: 0, maxTokens: 32 },
    );
    ctx.log("API connection test passed.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    throw new Error(
      `LLM API connection test failed before analysis: ${msg}. Check your API key and provider settings.`,
    );
  }

  // ── Main LLM call with retry (up to 3 attempts on timeout/transient) ─
  ctx.setProgress(10, "Calling LLM");

  const MAX_ATTEMPTS = 3;
  let result: ChatJsonResult | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      ctx.log(attempt > 1 ? `LLM attempt ${attempt}/${MAX_ATTEMPTS}…` : "Sending analysis prompt to LLM…");
      result = await chatJson([{ role: "user", content: prompt }], {
        temperature: 0.4,
        maxTokens: 8192,
      });
      break; // success
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTimeout = lastError.message.toLowerCase().includes("timed out");
      const isTransient =
        isTimeout ||
        lastError.message.toLowerCase().includes("429") ||
        lastError.message.toLowerCase().includes("500") ||
        lastError.message.toLowerCase().includes("502") ||
        lastError.message.toLowerCase().includes("503") ||
        lastError.message.toLowerCase().includes("504");

      if (!isTransient || attempt === MAX_ATTEMPTS) {
        ctx.log(`LLM failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${lastError.message}`, "error");
        throw lastError;
      }

      const delaySec = attempt * 5; // 5s, 10s backoff
      ctx.log(
        `LLM attempt ${attempt} failed (${isTimeout ? "timeout" : "transient error"}). Retrying in ${delaySec}s…`,
        "warn",
      );
      await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
  }

  if (!result) throw lastError ?? new Error("LLM call failed after all retries.");

  let candidates = parseClipsResponse(result.json);
  if (result.usage?.promptTokens) {
    ctx.log(
      `LLM tokens: prompt=${result.usage.promptTokens ?? "?"}, completion=${result.usage.completionTokens ?? "?"}.`,
    );
  }

  // Re-prompt once if the model returned nothing usable.
  if (candidates.length === 0) {
    ctx.log("No valid clips parsed; re-prompting once with correction.", "warn");
    const retryMessages: ChatMessage[] = [
      { role: "user", content: prompt },
      {
        role: "assistant",
        content: result.raw,
      },
      {
        role: "user",
        content:
          "Your previous response did not contain any parseable clips. " +
          "Return ONLY the JSON object with a `clips` array, no markdown or prose.",
      },
    ];
    const retry = await chatJson(retryMessages, { temperature: 0.2, maxTokens: 8192 });
    candidates = parseClipsResponse(retry.json);
    if (retry.usage?.promptTokens) {
      ctx.log(
        `LLM retry tokens: prompt=${retry.usage.promptTokens ?? "?"}, completion=${retry.usage.completionTokens ?? "?"}.`,
      );
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      "LLM analysis returned no usable clips after one retry. Check the prompt template or try a different model.",
    );
  }

  ctx.log(`Parsed ${candidates.length} candidate clip(s). Deduping + ranking.`);
  ctx.setProgress(60, "Ranking + persisting clips");

  const segments = loadTranscriptSegments(ctx.projectId);
  const outcome = persistClips(result.json, segments, {
    projectId: ctx.projectId,
    durationSec: project.durationSec ?? 0,
    maxClipsOverride: settings.maxClips ?? undefined,
  });

  ctx.log(
    `Persisted ${outcome.count} clip(s) (of ${outcome.rawCandidates} parsed, ${outcome.deduped} after dedup).`,
  );
  ctx.setProgress(100, `Saved ${outcome.count} clips`);
}
