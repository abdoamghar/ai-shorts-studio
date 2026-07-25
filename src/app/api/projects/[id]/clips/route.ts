import "server-only";
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects as projectsTable } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Scores = {
  hook?: number;
  emotion?: number;
  curiosity?: number;
  shareability?: number;
  retention?: number;
  educational?: number;
  overall?: number;
};

export type ClipCard = {
  id: string;
  idx: number;
  title: string;
  hook: string | null;
  summary: string | null;
  emotion: string | null;
  category: string | null;
  startMs: number;
  endMs: number;
  overallScore: number | null;
  viralityScore: number | null;
  retentionScore: number | null;
  engagementScore: number | null;
  scores: Scores;
  hashtags: string[];
  keywords: string[];
  startWordIdx: number | null;
  endWordIdx: number | null;
  status: string;
  favorite: boolean;
};

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

  const rows = db
    .select()
    .from(clipsTable)
    .where(eq(clipsTable.projectId, id))
    .orderBy(asc(clipsTable.idx))
    .all();

  const clips: ClipCard[] = rows.map((r) => {
    let scores: Scores = {};
    try {
      scores = JSON.parse(r.scoresJson) as Scores;
    } catch {
      scores = {};
    }
    let hashtags: string[] = [];
    try {
      hashtags = JSON.parse(r.hashtagsJson) as string[];
    } catch {
      hashtags = [];
    }
    let keywords: string[] = [];
    try {
      keywords = JSON.parse(r.keywordsJson) as string[];
    } catch {
      keywords = [];
    }
    return {
      id: r.id,
      idx: r.idx,
      title: r.title,
      hook: r.hook,
      summary: r.summary,
      emotion: r.emotion,
      category: r.category,
      startMs: r.startMs,
      endMs: r.endMs,
      overallScore: r.overallScore,
      viralityScore: r.viralityScore,
      retentionScore: r.retentionScore,
      engagementScore: r.engagementScore,
      scores,
      hashtags,
      keywords,
      startWordIdx: r.startWordIdx,
      endWordIdx: r.endWordIdx,
      status: r.status,
      favorite: r.favorite,
    };
  });

  return Response.json({ clips });
}
