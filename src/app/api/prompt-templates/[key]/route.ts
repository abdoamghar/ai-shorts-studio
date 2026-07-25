import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { promptTemplates } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBody = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80).optional(),
  category: z.string().trim().min(1, "Category is required.").max(40).optional(),
  promptText: z.string().trim().min(10, "Prompt text is too short.").max(8000).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  const row = db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.key, key))
    .get();
  if (!row) {
    return Response.json({ error: "Template not found." }, { status: 404 });
  }
  return Response.json({ template: row });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;

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

  const existing = db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.key, key))
    .get();
  if (!existing) {
    return Response.json({ error: "Template not found." }, { status: 404 });
  }

  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.name !== undefined) set.name = parsed.data.name;
  if (parsed.data.category !== undefined) set.category = parsed.data.category;
  if (parsed.data.promptText !== undefined) set.promptText = parsed.data.promptText;

  if (Object.keys(set).length > 1) {
    db.update(promptTemplates).set(set).where(eq(promptTemplates.key, key)).run();
  }

  const updated = db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.key, key))
    .get();
  return Response.json({ template: updated });
}
