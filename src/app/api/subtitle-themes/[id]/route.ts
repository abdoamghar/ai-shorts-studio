import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { subtitleThemes } from "@/lib/db/schema";
import type { StyleJson } from "@/lib/subtitles/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StyleJsonBody = z.object({
  font: z.string().min(1).max(80),
  fontSize: z.number().int().min(20).max(200),
  primaryHsl: z.tuple([z.number(), z.number(), z.number()]),
  outlineHsl: z.tuple([z.number(), z.number(), z.number()]),
  outline: z.number().min(0).max(40),
  shadow: z.number().min(0).max(40),
  bold: z.number().min(-1).max(1),
  alignment: z.number().int().min(1).max(9),
  marginL: z.number().int().min(0).max(400),
  marginV: z.number().int().min(0).max(960),
  highlightHsl: z.tuple([z.number(), z.number(), z.number()]),
  animationSpeed: z.number().min(0.1).max(4),
  maxChars: z.number().int().min(8).max(80),
  maxLines: z.number().int().min(1).max(5),
});

const PutBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  styleJson: StyleJsonBody.optional(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

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
    .from(subtitleThemes)
    .where(eq(subtitleThemes.id, id))
    .get();
  if (!existing) {
    return Response.json({ error: "Theme not found." }, { status: 404 });
  }

  const set: Record<string, unknown> = { createdAt: new Date().toISOString() };
  if (parsed.data.name !== undefined) set.name = parsed.data.name;
  if (parsed.data.styleJson !== undefined) {
    set.styleJson = JSON.stringify(parsed.data.styleJson as StyleJson);
  }

  if (Object.keys(set).length > 1) {
    db.update(subtitleThemes).set(set).where(eq(subtitleThemes.id, id)).run();
  }

  return Response.json({ ok: true });
}
