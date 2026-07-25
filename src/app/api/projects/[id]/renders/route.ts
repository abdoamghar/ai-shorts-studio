import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects as projectsTable, renders as rendersTable } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type RenderItem = {
  id: string;
  clipId: string;
  idx: number;
  title: string;
  startMs: number;
  endMs: number;
  overallScore: number | null;
  status: string;
  format: string;
  resolution: string;
  sizeBytes: number | null;
  durationMs: number | null;
  exists: boolean;
  createdAt: string | null;
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return Response.json({ error: "Missing project id." }, { status: 400 });
  const project = db.select().from(projectsTable).where(eq(projectsTable.id, id)).get();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

  const clips = db
    .select()
    .from(clipsTable)
    .where(eq(clipsTable.projectId, id))
    .all();
  const renders = db
    .select()
    .from(rendersTable)
    .all()
    .filter((r) => clips.some((c) => c.id === r.clipId));

  // Join clips to their latest render, keeping un-rendered clips too so the UI
  // can show per-clip render status alongside the export buttons.
  const items: RenderItem[] = clips
    .sort((a, b) => a.idx - b.idx)
    .map((c) => {
      const r = renders.find((rr) => rr.clipId === c.id);
      return {
        id: r?.id ?? c.id,
        clipId: c.id,
        idx: c.idx,
        title: c.title,
        startMs: c.startMs,
        endMs: c.endMs,
        overallScore: c.overallScore,
        status: c.status,
        format: r?.format ?? "",
        resolution: r?.resolution ?? "",
        sizeBytes: r?.sizeBytes ?? null,
        durationMs: r?.durationMs ?? null,
        exists: r != null,
        createdAt: r?.createdAt ?? null,
      };
    });

  return Response.json({ renders: items });
}
