import "server-only";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { jobs as jobsTable, projects as projectsTable } from "@/lib/db/schema";

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
