import "server-only";

/** Per-project subtitle / metadata output language. */
export type SubtitleLanguage = "en" | "ar";

/** Read `subtitleLanguage` from project settingsJson (default English). */
export function readSubtitleLanguage(settingsJson: string | null | undefined): SubtitleLanguage {
  try {
    const parsed = JSON.parse(settingsJson ?? "{}") as Record<string, unknown>;
    return parsed.subtitleLanguage === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}
