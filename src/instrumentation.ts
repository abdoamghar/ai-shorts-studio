// Runs once when a new Next.js server instance starts, before requests.
// We use it to (1) ensure the SQLite schema exists, (2) register the analyze
// job handler, and (3) recover interrupted jobs so the user can retry. In
// production you'd run `npm run db:migrate` instead of applySchema().
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applySchema } = await import("./lib/db/client");
  try {
    applySchema();
    console.log("[shorts] schema applied");
  } catch (err) {
    console.error("[shorts] failed to apply schema:", err);
  }
  try {
    const { seedBuiltinTemplates } = await import("./lib/db/seed-templates");
    const counts = seedBuiltinTemplates();
    console.log(
      `[shorts] prompt templates: ${counts.inserted} inserted, ${counts.updated} refreshed`,
    );
  } catch (err) {
    console.error("[shorts] failed to seed prompt templates:", err);
  }
  try {
    const { seedBuiltinThemes } = await import("./lib/db/seed-themes");
    const counts = seedBuiltinThemes();
    console.log(
      `[shorts] subtitle themes: ${counts.inserted} inserted, ${counts.refreshed} refreshed`,
    );
  } catch (err) {
    console.error("[shorts] failed to seed subtitle themes:", err);
  }
  try {
    // Importing the analyze module registers its handler with the runner
    // (side-effecting import). It is server-only and safe to load here.
    // Use a bare specifier so Turbopack bundles it rather than evaluating raw.
    await import("./lib/pipeline/analyze");
    const { jobRunner } = await import("./lib/jobs/runner");
    jobRunner.recover();
    console.log("[shorts] job runner ready");
  } catch (err) {
    console.error("[shorts] failed to start job runner:", err);
  }
}
