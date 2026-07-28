import "server-only";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { jobs as jobsTable, jobLogs as jobLogsTable } from "@/lib/db/schema";
import { jobRunner } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/jobs/[id] — job row + recent logs (for queue cards after failure). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing job id." }, { status: 400 });
  }

  const job = db.select().from(jobsTable).where(eq(jobsTable.id, id)).get();
  if (!job) {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }

  const logs = db
    .select({
      ts: jobLogsTable.ts,
      level: jobLogsTable.level,
      message: jobLogsTable.message,
      step: jobLogsTable.step,
    })
    .from(jobLogsTable)
    .where(eq(jobLogsTable.jobId, id))
    .orderBy(desc(jobLogsTable.id))
    .limit(200)
    .all()
    .reverse();

  return Response.json({ job, logs });
}

/** DELETE /api/jobs/[id]
 *  Cancels the job if it is still active, then removes the job row and its logs.
 *  This only removes the queue entry; the project and its storage folder are
 *  left intact (use DELETE /api/projects/[id] to wipe a project entirely). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing job id." }, { status: 400 });
  }

  const job = db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .get();
  if (!job) {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }

  // Cancel first if it could still be active (queued/running). cancel() is a
  // no-op for terminal jobs.
  try {
    jobRunner.cancel(id);
  } catch {
    /* ignore */
  }

  // job_logs reference this job via ON DELETE CASCADE, so deleting the job row
  // removes its logs too. Delete logs explicitly anyway in case the FK was not
  // enforced (belt + suspenders).
  db.delete(jobLogsTable).where(eq(jobLogsTable.jobId, id)).run();
  db.delete(jobsTable).where(eq(jobsTable.id, id)).run();

  return Response.json({ ok: true, id });
}
