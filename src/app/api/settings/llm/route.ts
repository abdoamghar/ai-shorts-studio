import "server-only";
import { z } from "zod";

import {
  readLlmSettingsForDisplay,
  writeLlmSettings,
} from "@/lib/settings/store";
import { PROVIDER_PRESET_BY_ID, type ProviderId } from "@/lib/llm/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providerIds = Object.keys(PROVIDER_PRESET_BY_ID) as ProviderId[];

const PutBody = z.object({
  providerId: z.enum(providerIds as [ProviderId, ...ProviderId[]]),
  baseUrl: z.string().trim().min(1, "Base URL is required."),
  model: z.string().trim().min(1, "Model is required."),
  // Optional: blank or the masked sentinel preserves the existing key.
  apiKey: z.string().optional().default(""),
});

export async function GET() {
  const data = readLlmSettingsForDisplay();
  return Response.json(data);
}

export async function PUT(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = PutBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    writeLlmSettings(parsed.data);
    const data = readLlmSettingsForDisplay();
    return Response.json(data);
  } catch (err) {
    console.error("[settings] write failed:", err);
    return Response.json({ error: "Failed to save settings." }, { status: 500 });
  }
}
