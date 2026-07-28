import "server-only";

import { readLlmSettings } from "@/lib/settings/store";
import { PROVIDER_PRESET_BY_ID, type ProviderId } from "@/lib/llm/providers";

/**
 * Single OpenAI-compatible LLM client used by the analysis pipeline.
 *
 * All providers (OpenAI, OpenRouter, DeepSeek, GLM, Anthropic-compat, Google,
 * custom) are reached via their `/chat/completions` endpoint with the stored
 * config. Request `{type:"json_object"}` response format where supported so the
 * model returns structured clip candidates; providers that don't support it are
 * handled by a tolerant JSON extractor.
 */

export class LlmClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LlmClientError";
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatJsonResult = {
  /** Best-effort parsed JSON object the model returned. */
  json: unknown;
  /** Raw content string (for debugging / re-prompting). */
  raw: string;
  /** Tokens reported by the provider, if any. */
  usage?: { promptTokens?: number; completionTokens?: number };
};

export type ChatJsonOptions = {
  /** Override the system message; defaults to a JSON-only instruction. */
  system?: string;
  /** Request temperature (default 0.4 for analytical scoring). */
  temperature?: number;
  /** Max completion tokens (default 4096). */
  maxTokens?: number;
  /** AbortSignal for the caller (job cancellation). */
  signal?: AbortSignal;
  /**
   * Called roughly every `heartbeatMs` while the request is in flight so the
   * job UI can show live progress during long LLM waits (otherwise the bar
   * looks frozen until the provider responds).
   */
  onHeartbeat?: (elapsedMs: number) => void;
  /** Heartbeat interval in ms (default 2500). */
  heartbeatMs?: number;
};

const DEFAULT_TIMEOUT_MS = 120_000; // transcription-chunk analysis can be slow
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.4;

function buildHeaders(providerId: ProviderId, apiKey: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (providerId === "openrouter") {
    h["HTTP-Referer"] = "https://shorts-studio.local";
    h["X-Title"] = "AI Shorts Studio";
  }
  return h;
}

/** Resolve stored config into a request-ready triple. */
function resolveConfig(): {
  baseUrl: string;
  model: string;
  providerId: ProviderId;
  apiKey: string;
} {
  const s = readLlmSettings();
  if (!s) {
    throw new LlmClientError(
      "No LLM provider configured. Open API Settings and save a provider + key + model.",
    );
  }
  const preset = PROVIDER_PRESET_BY_ID[s.providerId];
  const baseUrl = (s.baseUrl || preset.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new LlmClientError("LLM base URL is empty. Check API Settings.");
  if (!s.apiKey) throw new LlmClientError("LLM API key is missing. Save a key in API Settings.");
  if (!s.model) throw new LlmClientError("LLM model is missing. Set a model in API Settings.");
  return { baseUrl, model: s.model, providerId: s.providerId, apiKey: s.apiKey };
}

/**
 * Tolerant JSON extraction. Strips code fences, leading prose, trailing prose,
 * and unwraps a leading `{ "clips": [...] }` wrapper to get at an array.
 */
export function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip ```json ... ``` or ``` ... ``` fences.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // Try direct parse first.
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through */
  }

  // Find the first balanced { ... } or [ ... ] block.
  for (const [open, close] of ["{}", "[]"] as const) {
    const start = candidate.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch {
            break; // try the other opener type
          }
        }
      }
    }
  }
  return null;
}

/** Submit a chat completion and return the parsed JSON the model produced. */
export async function chatJson(
  messages: ChatMessage[],
  opts: ChatJsonOptions = {},
): Promise<ChatJsonResult> {
  const { baseUrl, model, providerId, apiKey } = resolveConfig();

  const system =
    opts.system ??
    "You are an expert short-form video editor. Respond with a single valid JSON object and nothing else.";
  const fullMessages: ChatMessage[] = [{ role: "system", content: system }, ...messages];

  const body = {
    model,
    messages: fullMessages,
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    response_format: { type: "json_object" },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  // If the caller passes a signal (job cancel), wire it up too.
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const startedAt = Date.now();
  const heartbeatMs = opts.heartbeatMs ?? 2500;
  const heartbeat =
    opts.onHeartbeat &&
    setInterval(() => {
      try {
        opts.onHeartbeat!(Date.now() - startedAt);
      } catch {
        /* ignore heartbeat errors */
      }
    }, heartbeatMs);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(providerId, apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 500);
      throw new LlmClientError(
        `LLM request failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };

    if (data.error?.message) {
      throw new LlmClientError(`Provider error: ${data.error.message}`);
    }

    const raw = data.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      throw new LlmClientError("LLM returned an empty response.");
    }

    const json = extractJsonObject(raw);
    return {
      json,
      raw,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
    };
  } catch (err) {
    if (err instanceof LlmClientError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmClientError("LLM request timed out (120s).");
    }
    throw new LlmClientError(
      `LLM request failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    clearTimeout(timeout);
  }
}
