import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { promptTemplates } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBody = z.object({
  key: z
    .string()
    .trim()
    .min(2, "Key must be at least 2 characters.")
    .max(64, "Key must be at most 64 characters.")
    .regex(/^[a-z0-9-]+$/, "Key must be lowercase letters, numbers, or dashes."),
  name: z.string().trim().min(1, "Name is required.").max(80),
  category: z.string().trim().min(1, "Category is required.").max(40),
  promptText: z.string().trim().min(10, "Prompt text is too short.").max(8000),
});

/** List all templates, newest-updated first. */
export async function GET() {
  const rows = db
    .select()
    .from(promptTemplates)
    .all();
  rows.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return Response.json({ templates: rows });
}

/** Create a user template. Builtins are seeded at boot, not via this route. */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    db.insert(promptTemplates)
      .values({
        id: randomUUID(),
        key: parsed.data.key,
        name: parsed.data.name,
        category: parsed.data.category,
        promptText: parsed.data.promptText,
        isBuiltin: false,
      })
      .run();
  } catch (err) {
    // Unique-key violation (SQLite UNIQUE) — give a friendly message.
    const msg = err instanceof Error ? err.message : "";
    if (/UNIQUE/i.test(msg)) {
      return Response.json(
        { error: `A template with key "${parsed.data.key}" already exists.` },
        { status: 409 },
      );
    }
    console.error("[prompt-templates] insert failed:", err);
    return Response.json({ error: "Failed to create template." }, { status: 500 });
  }

  const created = db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.key, parsed.data.key))
    .get();
  return Response.json({ template: created }, { status: 201 });
}
