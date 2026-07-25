import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { subtitleThemes } from "@/lib/db/schema";
import { BUILTIN_THEMES } from "@/lib/subtitles/themes";

/**
 * Idempotently seed (and refresh) the builtin subtitle themes so they always
 * exist. Strategy mirrors the prompt-templates seed: upsert on the stable
 * `presetKey`. On conflict we refresh name (and keep isBuiltin true); we do
 * NOT overwrite a user's edited styleJson — once a user tweaks a builtin's
 * style in the editor we preserve their version across app updates.
 * Call once at boot from instrumentation.
 */
export function seedBuiltinThemes(): {
  inserted: number;
  refreshed: number;
} {
  let inserted = 0;
  let refreshed = 0;
  for (const t of BUILTIN_THEMES) {
    const existing = db
      .select({ id: subtitleThemes.id })
      .from(subtitleThemes)
      .where(eq(subtitleThemes.id, t.key))
      .get();
    db.insert(subtitleThemes)
      .values({
        id: t.key, // stable id for builtins (conflict target = PK)
        name: t.name,
        presetKey: t.key,
        styleJson: JSON.stringify(t.styleJson),
        isBuiltin: true,
      })
      .onConflictDoUpdate({
        target: subtitleThemes.id,
        set: {
          name: t.name,
          isBuiltin: true,
        },
      })
      .run();
    if (existing) refreshed++;
    else inserted++;
  }
  return { inserted, refreshed };
}
