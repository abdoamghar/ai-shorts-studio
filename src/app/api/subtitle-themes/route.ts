import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
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

const PostBody = z.object({
  name: z.string().trim().min(1, "Name is required.").max(60),
  styleJson: StyleJsonBody,
});

export type ThemeRow = {
  id: string;
  name: string;
  presetKey: string | null;
  styleJson: StyleJson;
  isBuiltin: boolean;
  createdAt: string;
};

function toRow(r: typeof subtitleThemes.$inferSelect): ThemeRow {
  let styleJson: StyleJson;
  try {
    styleJson = JSON.parse(r.styleJson) as StyleJson;
  } catch {
    // Should not happen for seeded themes; fall back to a sane default.
    styleJson = {
      font: "Inter",
      fontSize: 80,
      primaryHsl: [0, 0, 1],
      outlineHsl: [0, 0, 0],
      outline: 8,
      shadow: 0,
      bold: 1,
      alignment: 8,
      marginL: 80,
      marginV: 120,
      highlightHsl: [42, 1, 0.55],
      animationSpeed: 1,
      maxChars: 22,
      maxLines: 2,
    };
  }
  return {
    id: r.id,
    name: r.name,
    presetKey: r.presetKey,
    styleJson,
    isBuiltin: r.isBuiltin,
    createdAt: r.createdAt,
  };
}

/** List all themes. */
export async function GET() {
  const rows = db.select().from(subtitleThemes).all();
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Response.json({ themes: rows.map(toRow) });
}

/** Create a custom theme (a clone the user can freely edit). */
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

  const id = randomUUID();
  db.insert(subtitleThemes)
    .values({
      id,
      name: parsed.data.name,
      presetKey: null, // custom themes have no builtin preset key
      styleJson: JSON.stringify(parsed.data.styleJson),
      isBuiltin: false,
    })
    .run();

  const created = db
    .select()
    .from(subtitleThemes)
    .where(eq(subtitleThemes.id, id))
    .get();
  return Response.json({ theme: created ? toRow(created) : null }, { status: 201 });
}
