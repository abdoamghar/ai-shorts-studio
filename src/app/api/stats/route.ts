import "server-only";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects as projectsTable, renders as rendersTable } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type Stats = {
  projects: number;
  clips: number;
  renders: number;
  avgOverallScore: number | null;
};

export async function GET() {
  const projectCount = db.select({ id: projectsTable.id }).from(projectsTable).all().length;
  const clipRows = db
    .select({ overallScore: clipsTable.overallScore })
    .from(clipsTable)
    .all();
  const renderCount = db.select({ id: rendersTable.id }).from(rendersTable).all().length;
  const scored = clipRows.map((c) => c.overallScore).filter((s): s is number => s != null);
  const avg = scored.length > 0 ? scored.reduce((a, b) => a + b, 0) / scored.length : null;

  const stats: Stats = {
    projects: projectCount,
    clips: clipRows.length,
    renders: renderCount,
    avgOverallScore: avg != null ? Math.round(avg * 10) / 10 : null,
  };
  return Response.json({ stats });
}
