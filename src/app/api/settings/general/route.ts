import "server-only";
import { z } from "zod";
import {
  GeneralSettingsSchema,
  readGeneralSettings,
  writeGeneralSettings,
} from "@/lib/settings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = readGeneralSettings();
  return Response.json(settings);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = GeneralSettingsSchema.partial().safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid payload", details: parsed.error }, { status: 400 });
    }
    writeGeneralSettings(parsed.data);
    const updated = readGeneralSettings();
    return Response.json(updated);
  } catch (err) {
    console.error("General settings save error:", err);
    return Response.json({ error: "Failed to save settings." }, { status: 500 });
  }
}
