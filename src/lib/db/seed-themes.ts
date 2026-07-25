import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { subtitleThemes } from "@/lib/db/schema";
import { BUILTIN_THEMES } from "@/lib/subtitles/themes";

/**
 * Idempotently seed (and refresh) the builtin subtitle themes so they always
 * exist. Upsert on the stable `id` (= the preset key). On conflict we refresh
 * name, isBuiltin, AND styleJson — builtin themes are read-only in the UI
 * (the editor only exposes Preview/Clone for builtins), so overwriting their
 * styleJson across app updates is safe and is how we migrate builtins to the
 * v2 premium schema. User-owned clones have their own `id` and are untouched.
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
          styleJson: JSON.stringify(t.styleJson),
        },
      })
      .run();
    if (existing) refreshed++;
    else inserted++;
  }
  return { inserted, refreshed };
}
