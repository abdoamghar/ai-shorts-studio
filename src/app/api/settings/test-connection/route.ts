import "server-only";
import { z } from "zod";

import { readLlmSettings } from "@/lib/settings/store";
import { PROVIDER_PRESET_BY_ID, type ProviderId } from "@/lib/llm/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providerIds = Object.keys(PROVIDER_PRESET_BY_ID) as ProviderId[];

const Body = z
  .object({
    providerId: z.enum(providerIds as [ProviderId, ...ProviderId[]]).optional(),
    baseUrl: z.string().trim().optional(),
    model: z.string().trim().optional(),
    apiKey: z.string().optional(),
  })
  .optional();

/**
 * Test the LLM connection by hitting the OpenAI-compatible /v1/models
 * endpoint. If the body omits a field, fall back to the stored config so the
 * user can test either a pending change or the saved config. A masked key in
 * the body is ignored in favour of the stored key.
 */
export async function POST(request: Request) {
  const MASK = /^[•]+/;
  const stored = readLlmSettings();
  let body: z.infer<typeof Body> = undefined;
  try {
    body = Body.parse(await request.json().catch(() => undefined));
  } catch {
    return Response.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const providerId = body?.providerId ?? stored?.providerId ?? "openai";
  const preset = PROVIDER_PRESET_BY_ID[providerId];
  const baseUrl = (body?.baseUrl || stored?.baseUrl || preset.baseUrl || "")
    .replace(/\/+$/, "");
  const model = body?.model || stored?.model || preset.defaultModel;
  // Never use a masked value; only a freshly typed key or the stored one.
  const apiKey =
    body?.apiKey && !MASK.test(body.apiKey) ? body.apiKey : stored?.apiKey ?? "";

  if (!baseUrl) {
    return Response.json({ ok: false, error: "Base URL is required." }, { status: 400 });
  }
  if (!apiKey) {
    return Response.json(
      { ok: false, error: "No API key set. Save a key first or enter one to test." },
      { status: 400 },
    );
  }

  const url = `${baseUrl}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(providerId, apiKey),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      return Response.json(
        {
          ok: false,
          error: `Provider responded ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
        },
        { status: 200 },
      );
    }

    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (data.data ?? []).map((m) => m.id).filter(Boolean);
    const modelOk = !model || ids.length === 0 || ids.includes(model);

    return Response.json({
      ok: true,
      modelCount: ids.length,
      models: ids.slice(0, 20),
      modelAvailable: modelOk,
      modelChecked: model ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Request timed out after 20s."
          : err.message
        : "Unknown network error.";
    return Response.json({ ok: false, error: message }, { status: 200 });
  } finally {
    clearTimeout(timeout);
  }
}

/** Per-provider headers for the OpenAI-compatible /v1/models call. */
function buildHeaders(providerId: ProviderId, apiKey: string): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  // OpenRouter recommends these for attribution; harmless elsewhere.
  if (providerId === "openrouter") {
    h["HTTP-Referer"] = "https://shorts-studio.local";
    h["X-Title"] = "AI Shorts Studio";
  }
  return h;
}
