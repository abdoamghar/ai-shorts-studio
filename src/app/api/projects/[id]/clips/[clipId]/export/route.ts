import "server-only";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects as projectsTable, renders as rendersTable } from "@/lib/db/schema";
import { subtitlesDir } from "@/lib/storage/paths";
import { fileResponse } from "@/lib/video/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Fmt = "mp4" | "srt" | "ass" | "json";

const CLIP_JSON_FIELDS = (c: typeof clipsTable.$inferSelect) => ({
  id: c.id,
  idx: c.idx,
  title: c.title,
  hook: c.hook,
  summary: c.summary,
  emotion: c.emotion,
  category: c.category,
  startMs: c.startMs,
  endMs: c.endMs,
  overallScore: c.overallScore,
  viralityScore: c.viralityScore,
  retentionScore: c.retentionScore,
  engagementScore: c.engagementScore,
  scores: safeJson(c.scoresJson, {}),
  hashtags: safeJson(c.hashtagsJson, []),
  keywords: safeJson(c.keywordsJson, []),
  startWordIdx: c.startWordIdx,
  endWordIdx: c.endWordIdx,
});

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clipFileBase(idx: number): string {
  return `clip_${idx.toString().padStart(2, "0")}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  if (!id || !clipId) {
    return Response.json({ error: "Missing project or clip id." }, { status: 400 });
  }

  const project = db.select().from(projectsTable).where(eq(projectsTable.id, id)).get();
  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }
  const clip = db.select().from(clipsTable).where(eq(clipsTable.id, clipId)).get();
  if (!clip || clip.projectId !== id) {
    return Response.json({ error: "Clip not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const fmt = (url.searchParams.get("fmt") ?? "mp4") as Fmt;
  const base = clipFileBase(clip.idx);
  const slug = project.title
    ? project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
    : id;

  if (fmt === "json") {
    // Metadata JSON; no file on disk needed.
    return Response.json(
      { project: { id: project.id, title: project.title }, clip: CLIP_JSON_FIELDS(clip) },
      { headers: { "Content-Disposition": `attachment; filename="${slug}_clip${clip.idx + 1}.json"` } },
    );
  }

  if (fmt === "mp4") {
    const render = db.select().from(rendersTable).where(eq(rendersTable.clipId, clipId)).get();
    if (!render) {
      return Response.json({ error: "Render not available (clip hasn't rendered yet)." }, { status: 404 });
    }
    if (!existsSync(render.path)) {
      return Response.json({ error: "Render file missing." }, { status: 404 });
    }
    return fileResponse(render.path, {
      contentType: "video/mp4",
      downloadName: `${slug}_clip${clip.idx + 1}.mp4`,
      request,
    });
  }

  if (fmt === "srt" || fmt === "ass") {
    const filePath = path.join(subtitlesDir(id), `${base}.${fmt}`);
    return fileResponse(filePath, {
      contentType: fmt === "srt" ? "application/x-subrip" : "text/plain",
      downloadName: `${slug}_clip${clip.idx + 1}.${fmt}`,
      request,
    });
  }

  return Response.json({ error: `Unknown format "${fmt}".` }, { status: 400 });
}
