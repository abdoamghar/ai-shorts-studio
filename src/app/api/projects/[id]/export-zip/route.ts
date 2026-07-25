import "server-only";
import { eq } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects as projectsTable, renders as rendersTable } from "@/lib/db/schema";
import { subtitlesDir } from "@/lib/storage/paths";
import { buildZip } from "@/lib/archive/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clipFileBase(idx: number): string {
  return `clip_${idx.toString().padStart(2, "0")}`;
}
function slugify(s: string, fallback: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return out || fallback;
}
function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return Response.json({ error: "Missing project id." }, { status: 400 });
  const project = db.select().from(projectsTable).where(eq(projectsTable.id, id)).get();
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

  const clips = db.select().from(clipsTable).where(eq(clipsTable.projectId, id)).all().sort((a, b) => a.idx - b.idx);
  if (clips.length === 0) {
    return Response.json({ error: "No clips to export." }, { status: 404 });
  }

  const slug = slugify(project.title ?? "", id);
  const entries: { name: string; data: Buffer }[] = [];

  for (const clip of clips) {
    const base = clipFileBase(clip.idx);
    const render = db.select().from(rendersTable).where(eq(rendersTable.clipId, clip.id)).get();
    if (render && existsSync(render.path)) {
      entries.push({ name: `${base}.mp4`, data: readFileSync(render.path) });
    }
    const srt = path.join(subtitlesDir(id), `${base}.srt`);
    const ass = path.join(subtitlesDir(id), `${base}.ass`);
    if (existsSync(srt)) entries.push({ name: `${base}.srt`, data: readFileSync(srt) });
    if (existsSync(ass)) entries.push({ name: `${base}.ass`, data: readFileSync(ass) });
    // Per-clip metadata JSON.
    const meta = {
      project: { id: project.id, title: project.title },
      clip: {
        id: clip.id,
        idx: clip.idx,
        title: clip.title,
        hook: clip.hook,
        summary: clip.summary,
        emotion: clip.emotion,
        category: clip.category,
        startMs: clip.startMs,
        endMs: clip.endMs,
        overallScore: clip.overallScore,
        scores: safeJson(clip.scoresJson, {}),
        hashtags: safeJson(clip.hashtagsJson, []),
        keywords: safeJson(clip.keywordsJson, []),
      },
    };
    entries.push({ name: `${base}.json`, data: Buffer.from(JSON.stringify(meta, null, 2), "utf8") });
  }

  if (entries.length === 0) {
    return Response.json({ error: "No rendered files to zip." }, { status: 404 });
  }

  const zip = buildZip(entries);
  return new Response(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}_shorts.zip"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "private, no-store",
    },
  });
}
