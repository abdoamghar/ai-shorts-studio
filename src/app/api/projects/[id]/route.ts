import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import {
  jobs as jobsTable,
  projects as projectsTable,
  subtitleThemes,
} from "@/lib/db/schema";
import { jobRunner } from "@/lib/jobs/runner";
import { removeProjectDir } from "@/lib/storage/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing project id." }, { status: 400 });
  }

  const project = db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .get();
  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  // Most recent job for this project (for live status / progress).
  const latestJob = db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.projectId, id))
    .orderBy(desc(jobsTable.createdAt))
    .limit(1)
    .get();

  return Response.json({ project, latestJob });
}

/** DELETE /api/projects/[id]
 *  Cancels any in-flight job, deletes the project row (cascades transcript /
 *  clips / renders), wipes the project's storage folder, and clears leftover
 *  job rows referencing the project. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing project id." }, { status: 400 });
  }

  const project = db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .get();
  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  // Cancel any active job for this project before tearing down its DB row, so
  // the runner doesn't keep writing progress to a doomed job.
  const activeJobs = db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.projectId, id))
    .all();
  for (const j of activeJobs) {
    try {
      jobRunner.cancel(j.id);
    } catch {
      /* ignore — already terminal or missing */
    }
  }

  // Delete the project row. Schema cascades transcript, clips, and renders
  // (clicks reference projects.id ON DELETE SET NULL, handled by SQLite).
  db.delete(projectsTable).where(eq(projectsTable.id, id)).run();

  // Remove leftover job rows that referenced this project (jobs.projectId is
  // ON DELETE SET NULL, so they'd otherwise linger with a null projectId).
  db.delete(jobsTable)
    .where(eq(jobsTable.projectId, id))
    .run();

  // Wipe the storage folder (video, audio, subs, renders).
  removeProjectDir(id);

  return Response.json({ ok: true, id });
}

/**
 * PATCH /api/projects/[id]
 *
 * Lightweight per-project settings patch. Currently supports:
 *   - subtitleThemeId    : English-project subtitle theme id
 *   - subtitleThemeIdAr  : Arabic-project subtitle theme id
 *
 * Both are optional. Either present value must reference an existing row in
 * `subtitle_themes` (we validate before persisting so a stale client-side
 * value can't wedge the renderer's theme-resolution fallback). Other
 * settingsJson fields are preserved — we merge the incoming keys into the
 * existing JSON blob rather than overwriting it.
 */
const PatchBody = z.object({
  subtitleThemeId: z.string().trim().min(1).max(80).optional(),
  subtitleThemeIdAr: z.string().trim().min(1).max(80).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing project id." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const patch = parsed.data;
  if (patch.subtitleThemeId === undefined && patch.subtitleThemeIdAr === undefined) {
    return Response.json({ error: "No fields to update." }, { status: 400 });
  }

  const project = db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .get();
  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  // Validate each provided theme id actually references a row. better-sqlite3
  // is synchronous so this is a single cheap get().
  function themeExists(themeId: string): boolean {
    const row = db
      .select({ id: subtitleThemes.id })
      .from(subtitleThemes)
      .where(eq(subtitleThemes.id, themeId))
      .get();
    return Boolean(row);
  }

  if (patch.subtitleThemeId !== undefined && !themeExists(patch.subtitleThemeId)) {
    return Response.json(
      { error: `Theme '${patch.subtitleThemeId}' does not exist.` },
      { status: 400 },
    );
  }
  if (patch.subtitleThemeIdAr !== undefined && !themeExists(patch.subtitleThemeIdAr)) {
    return Response.json(
      { error: `Theme '${patch.subtitleThemeIdAr}' does not exist.` },
      { status: 400 },
    );
  }

  // Merge into the existing settingsJson so unrelated fields (framingStyle,
  // subtitleLanguage, etc.) are preserved. settingsJson is a flat dict of
  // primitives, so a shallow merge is sufficient.
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(project.settingsJson ?? "{}") as Record<string, unknown>;
  } catch {
    existing = {};
  }
  const next = { ...existing };
  if (patch.subtitleThemeId !== undefined) next.subtitleThemeId = patch.subtitleThemeId;
  if (patch.subtitleThemeIdAr !== undefined) next.subtitleThemeIdAr = patch.subtitleThemeIdAr;

  db.update(projectsTable)
    .set({
      settingsJson: JSON.stringify(next),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projectsTable.id, id))
    .run();

  return Response.json({ ok: true, id, settings: next });
}
