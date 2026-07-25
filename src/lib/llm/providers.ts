/**
 * Built-in LLM provider presets for the API Settings page.
 * All are used through their OpenAI-compatible endpoint.
 * baseUrl values mirror the plan's documented endpoints.
 * Safe to import on the client: pure data, no server-only APIs.
 */
export type ProviderId =
  | "openai"
  | "openrouter"
  | "deepseek"
  | "glm"
  | "anthropic"
  | "google"
  | "custom";

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  /** OpenAI-compatible chat completions + models base. */
  baseUrl: string;
  /** A reasonable default model id for the provider. */
  defaultModel: string;
  /** Short note shown under the baseUrl field. */
  hint: string;
  /** Link to where the user gets an API key. */
  keyUrl: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    hint: "Native OpenAI API. Use any gpt-4o / gpt-4.1 model id.",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-3.5-sonnet",
    hint: "Gateway to many providers (Anthropic, Google, Meta, …). Model ids are provider-scoped.",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    hint: "OpenAI-compatible. deepseek-chat (V3) is a good default.",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "glm",
    label: "GLM (Zhipu)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    hint: "Zhipu BigModel OpenAI-compatible endpoint.",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "anthropic",
    label: "Anthropic (compat)",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-latest",
    hint: "Anthropic's OpenAI-compat shim. Some headers differ; if it errors, route via OpenRouter instead.",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    label: "Google (compat)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-1.5-flash",
    hint: "Google's OpenAI-compatible endpoint (v1beta/openai). Use a gemini-* model id.",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    defaultModel: "",
    hint: "Any OpenAI-compatible endpoint (LM Studio, Ollama, vLLM, …).",
    keyUrl: "",
  },
];

export const PROVIDER_PRESET_BY_ID = Object.fromEntries(
  PROVIDER_PRESETS.map((p) => [p.id, p]),
) as Record<ProviderId, ProviderPreset>;
