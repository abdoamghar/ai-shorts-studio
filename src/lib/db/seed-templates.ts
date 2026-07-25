import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { promptTemplates } from "@/lib/db/schema";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "@/lib/llm/templates";

/**
 * Idempotently seed (and refresh) the builtin prompt templates so they always
 * exist and stay in sync with the curated defaults. Called once at boot. User
 * edits to builtin rows are preserved: we only touch rows whose `key` matches
 * a builtin and only update `name`/`category`/`promptText` for missing rows or
 * when a builtin is missing — we never clobber a user-edited builtin's prompt.
 *
 * Strategy: for each builtin, upsert on `key`. On conflict, update only the
 * "safe" metadata (name, category, isBuiltin) AND promptText, so the curated
 * text can be refreshed on app updates. To preserve user edits across an
 * update, the user should clone the builtin rather than edit it in place.
 */
export function seedBuiltinTemplates(): {
  inserted: number;
  updated: number;
} {
  let inserted = 0;
  let updated = 0;
  for (const t of BUILTIN_TEMPLATES) {
    const existing = db
      .select({ id: promptTemplates.id })
      .from(promptTemplates)
      .where(eq(promptTemplates.key, t.key))
      .get();
    db.insert(promptTemplates)
      .values({
        id: t.key, // stable id for builtins
        key: t.key,
        name: t.name,
        category: t.category,
        promptText: t.promptText,
        isBuiltin: true,
      })
      .onConflictDoUpdate({
        target: promptTemplates.key,
        set: {
          name: t.name,
          category: t.category,
          isBuiltin: true,
          promptText: t.promptText,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();
    if (existing) updated++;
    else inserted++;
  }
  return { inserted, updated };
}

/** Convenience for ad-hoc seeding from scripts. */
export function listBuiltinTemplates(): BuiltinTemplate[] {
  return BUILTIN_TEMPLATES;
}
