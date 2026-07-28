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
const GENERAL_SETTINGS_KEY = "general";

export const GeneralSettingsSchema = z.object({
  whisperModel: z.enum(["tiny", "base", "small", "medium", "large", "large-v3"]).default("base"),
  maxClips: z.number().int().min(1).max(20).default(5),
  defaultSubtitleThemeId: z.string().default("theme-system"),
  defaultFramingStyle: z.enum(["blur", "crop", "auto-crop"]).default("blur"),
  defaultSubtitleLanguage: z.enum(["en", "ar"]).default("en"),
  /**
   * Arabic path only. When true (default) every word carries a dark ghost
   * pill behind it for the whole block window — the viral TikTok look. When
   * false, the ghost pills are suppressed and only the active word's colored
   * highlight pill draws; inactive words render as plain white text (with a
   * thin outline for legibility, added inside buildAssArabic). The active
   * word's green/violet highlight and per-word timing are never affected.
   */
  arabicShowInactiveWordPills: z.boolean().default(true),
});

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const EMPTY_GENERAL_SETTINGS: GeneralSettings = {
  whisperModel: "base",
  maxClips: 5,
  defaultSubtitleThemeId: "theme-system",
  defaultFramingStyle: "blur",
  defaultSubtitleLanguage: "en",
  arabicShowInactiveWordPills: true,
};

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

/** Read the General group */
export function readGeneralSettings(): GeneralSettings {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, GENERAL_SETTINGS_KEY))
    .get();
  if (!row) return { ...EMPTY_GENERAL_SETTINGS };

  const json = decryptString(row.valueEnc, row.iv, row.tag);
  const parsed = z.safeParse(GeneralSettingsSchema, safeJson(json));
  if (!parsed.success) return { ...EMPTY_GENERAL_SETTINGS };
  return parsed.data;
}

/** Write the General group */
export function writeGeneralSettings(input: Partial<GeneralSettings>): void {
  const prev = readGeneralSettings();
  const merged = GeneralSettingsSchema.parse({
    whisperModel: input.whisperModel ?? prev.whisperModel,
    maxClips: input.maxClips ?? prev.maxClips,
    defaultSubtitleThemeId: input.defaultSubtitleThemeId ?? prev.defaultSubtitleThemeId,
    defaultFramingStyle: input.defaultFramingStyle ?? prev.defaultFramingStyle,
    defaultSubtitleLanguage:
      input.defaultSubtitleLanguage ?? prev.defaultSubtitleLanguage,
    arabicShowInactiveWordPills:
      input.arabicShowInactiveWordPills ?? prev.arabicShowInactiveWordPills,
  });
  
  const { valueEnc, iv, tag } = encryptString(JSON.stringify(merged));
  db.insert(settings)
    .values({ key: GENERAL_SETTINGS_KEY, valueEnc, iv, tag, updatedAt: new Date().toISOString() })
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
