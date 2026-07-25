import "server-only";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { jobs as jobsTable, projects as projectsTable } from "@/lib/db/schema";
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
