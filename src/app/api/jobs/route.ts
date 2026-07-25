import "server-only";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { jobs as jobsTable, projects as projectsTable } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Recent first, capped. Joins project for url/title thumbnail display.
  const rows = db
    .select({
      id: jobsTable.id,
      projectId: jobsTable.projectId,
      type: jobsTable.type,
      status: jobsTable.status,
      progress: jobsTable.progress,
      step: jobsTable.step,
      message: jobsTable.message,
      error: jobsTable.error,
      startedAt: jobsTable.startedAt,
      finishedAt: jobsTable.finishedAt,
      createdAt: jobsTable.createdAt,
      projectUrl: projectsTable.url,
      projectTitle: projectsTable.title,
      projectVideoId: projectsTable.videoId,
      projectThumbnailUrl: projectsTable.thumbnailUrl,
    })
    .from(jobsTable)
    .leftJoin(projectsTable, eq(jobsTable.projectId, projectsTable.id))
    .orderBy(desc(jobsTable.createdAt))
    .limit(50)
    .all();

  return Response.json({ jobs: rows });
}
