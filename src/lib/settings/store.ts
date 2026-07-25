import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { decryptString, encryptString, maskApiKey } from "@/lib/crypto/settings-cipher";
import { PROVIDER_PRESET_BY_ID, type ProviderId } from "@/lib/llm/providers";

/**
 * Typed read/write layer over the encrypted `settings` table.
 *
 * Each logical config group is stored as one row: key = group name, value =
 * JSON string, encrypted with AES-256-GCM (iv + tag stored alongside). This
 * keeps the schema simple (one row per group rather than one per field) while
 * secrets stay encrypted at rest.
 *
 * v1 ships the `llm` group: provider config used by the analysis pipeline and
 * the API Settings page.
 */

const LLM_SETTINGS_KEY = "llm";

export const LlmSettingsSchema = z.object({
  providerId: z.string().min(1).catch("openai") as z.ZodType<ProviderId>,
  baseUrl: z.string().trim().min(1),
  apiKey: z.string().trim().min(0).default(""),
  model: z.string().trim().min(1),
});

export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

/** Shape returned to the client: never includes the plaintext API key. */
export type LlmSettingsDisplay = Omit<LlmSettings, "apiKey"> & {
  apiKeyMask: string;
  apiKeySet: boolean;
};

export const EMPTY_LLM_DISPLAY: LlmSettingsDisplay = {
  providerId: "openai",
  baseUrl: PROVIDER_PRESET_BY_ID.openai.baseUrl,
  model: PROVIDER_PRESET_BY_ID.openai.defaultModel,
  apiKeyMask: "",
  apiKeySet: false,
};

/** Read the LLM group for internal use (plaintext apiKey included). */
export function readLlmSettings(): LlmSettings | null {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, LLM_SETTINGS_KEY))
    .get();
  if (!row) return null;

  const json = decryptString(row.valueEnc, row.iv, row.tag);
  const parsed = z.safeParse(LlmSettingsSchema, safeJson(json));
  if (!parsed.success) return null;
  return parsed.data;
}

/** Read the LLM group for display (apiKey masked, never plaintext to client). */
export function readLlmSettingsForDisplay(): LlmSettingsDisplay {
  const s = readLlmSettings() ?? null;
  if (!s) return { ...EMPTY_LLM_DISPLAY };
  return {
    providerId: s.providerId,
    baseUrl: s.baseUrl,
    model: s.model,
    apiKeyMask: maskApiKey(s.apiKey),
    apiKeySet: Boolean(s.apiKey),
  };
}

/**
 * Write the LLM group. If `apiKey` is falsy or the sentinel "••••....", keep
 * the existing key so a save from the UI (where the key field shows the mask)
 * doesn't wipe a previously stored key.
 */
export function writeLlmSettings(input: Partial<LlmSettings>): void {
  const prev = readLlmSettings();
  const MASK = /^[•]+/;
  const apiKey =
    input.apiKey && !MASK.test(input.apiKey)
      ? input.apiKey
      : (prev?.apiKey ?? "");
  const merged = LlmSettingsSchema.parse({
    providerId: input.providerId ?? prev?.providerId ?? "openai",
    baseUrl: input.baseUrl ?? prev?.baseUrl ?? PROVIDER_PRESET_BY_ID.openai.baseUrl,
    model: input.model ?? prev?.model ?? PROVIDER_PRESET_BY_ID.openai.defaultModel,
    apiKey,
  });
  const { valueEnc, iv, tag } = encryptString(JSON.stringify(merged));
  db.insert(settings)
    .values({ key: LLM_SETTINGS_KEY, valueEnc, iv, tag, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { valueEnc, iv, tag, updatedAt: new Date().toISOString() },
    })
    .run();
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
