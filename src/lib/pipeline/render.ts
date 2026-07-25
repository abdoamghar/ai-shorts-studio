import "server-only";
import { eq } from "drizzle-orm";
import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects, renders as rendersTable } from "@/lib/db/schema";
import { rendersDir, subtitlesDir } from "@/lib/storage/paths";
import { renderClip } from "@/lib/video/render";
import type { JobContext } from "@/lib/jobs/runner";

/**
 * Step 6 — render every clip into a 9:16 MP4 with burned subtitles.
 *
 * Render order is SCORE-TIERED: clips sorted by overallScore desc so the
 * strongest shorts export first. A user gets usable exports within ~5min even
 * for a multi-clip job. Each clip's ASS (from the subtitles step) is burned in;
 * on success we record a `renders` row and flip the clip's status to "rendered".
 * A failed clip flips to "failed" and the step continues so one bad clip doesn't
 * block the rest (the user can retry the whole job or re-render individually
 * later).
 */

function clipAssPath(projectId: string, idx: number): string {
  const base = `clip_${idx.toString().padStart(2, "0")}`;
  return path.join(subtitlesDir(projectId), `${base}.ass`);
}

function clipRenderPath(projectId: string, idx: number): string {
  return path.join(rendersDir(projectId), `clip_${idx.toString().padStart(2, "0")}_tiktok.mp4`);
}

export async function runRender(ctx: JobContext): Promise<void> {
  ctx.log("Rendering clips (9:16, burned subtitles).");

  const project = db.select().from(projects).where(eq(projects.id, ctx.projectId)).get();
  if (!project) throw new Error(`Project ${ctx.projectId} not found.`);

  const clips = db
    .select()
    .from(clipsTable)
    .where(eq(clipsTable.projectId, ctx.projectId))
    .all()
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
  if (clips.length === 0) {
    ctx.log("No clips to render.", "warn");
    return;
  }

  let done = 0;
  let failed = 0;
  for (const clip of clips) {
    const assPath = clipAssPath(ctx.projectId, clip.idx);
    if (!existsSync(assPath)) {
      ctx.log(`Skipping clip ${clip.idx}: missing ASS (run the subtitles step).`, "warn");
      db.update(clipsTable)
        .set({ status: "failed" })
        .where(eq(clipsTable.id, clip.id))
        .run();
      failed++;
      continue;
    }
    const outPath = clipRenderPath(ctx.projectId, clip.idx);
    db.update(clipsTable)
      .set({ status: "rendering" })
      .where(eq(clipsTable.id, clip.id))
      .run();

    // We report aggregate per-clip progress (done/total) for the step window;
    // renderClip's intra-ffmpeg progress is intentionally not forwarded here
    // (the orchestrator already mapped this step's ctx to the global window).
    try {
      await renderClip({
        projectId: ctx.projectId,
        startMs: clip.startMs,
        endMs: clip.endMs,
        assPath,
        outPath,
      });
    } catch (err) {
      ctx.log(`Clip ${clip.idx} render failed: ${err instanceof Error ? err.message : "unknown"}`, "error");
      db.update(clipsTable)
        .set({ status: "failed" })
        .where(eq(clipsTable.id, clip.id))
        .run();
      failed++;
      done++;
      ctx.setProgress(Math.round((done / clips.length) * 100), `Rendered ${done}/${clips.length} (1 failed)`);
      continue;
    }

    // Record metadata in `renders`. Delete any prior render row for this clip.
    db.delete(rendersTable).where(eq(rendersTable.clipId, clip.id)).run();
    let sizeBytes: number | null = null;
    try {
      sizeBytes = statSync(outPath).size;
    } catch {
      sizeBytes = null;
    }
    const durationMs = Math.max(0, clip.endMs - clip.startMs);
    db.insert(rendersTable)
      .values({
        id: randomUUID(),
        clipId: clip.id,
        format: "mp4",
        resolution: "1080x1920",
        themeId: null,
        path: outPath,
        sizeBytes,
        durationMs,
      })
      .run();
    db.update(clipsTable)
      .set({ status: "rendered" })
      .where(eq(clipsTable.id, clip.id))
      .run();

    done++;
    ctx.setProgress(Math.round((done / clips.length) * 100), `Rendered ${done}/${clips.length}`);
  }
  ctx.log(`Render complete: ${done - failed} rendered, ${failed} failed.`);
}
