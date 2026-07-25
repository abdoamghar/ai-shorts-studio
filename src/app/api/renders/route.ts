import "server-only";
import { existsSync } from "node:fs";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects as projectsTable, renders as rendersTable } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type GlobalRenderItem = {
  id: string;
  clipId: string;
  projectId: string;
  projectTitle: string | null;
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

export async function GET() {
  const renders = db.select().from(rendersTable).all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const clips = db.select().from(clipsTable).all();
  const projects = db.select().from(projectsTable).all();

  const items: GlobalRenderItem[] = renders.map((r) => {
    const clip = clips.find((c) => c.id === r.clipId);
    const project = clip ? projects.find((p) => p.id === clip.projectId) : undefined;
    return {
      id: r.id,
      clipId: r.clipId,
      projectId: clip?.projectId ?? project?.id ?? "",
      projectTitle: project?.title ?? null,
      idx: clip?.idx ?? 0,
      title: clip?.title ?? "",
      startMs: clip?.startMs ?? 0,
      endMs: clip?.endMs ?? 0,
      overallScore: clip?.overallScore ?? null,
      status: clip?.status ?? "rendered",
      format: r.format,
      resolution: r.resolution,
      sizeBytes: r.sizeBytes,
      durationMs: r.durationMs,
      exists: existsSync(r.path),
      createdAt: r.createdAt,
    };
  });

  return Response.json({ renders: items });
}
