import "server-only";
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { projects as projectsTable, transcript } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Word = {
  text: string;
  startMs: number;
  endMs: number;
  probability: number | null;
};

type Segment = {
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  words: Word[];
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
    .select({
      idx: transcript.idx,
      startMs: transcript.startMs,
      endMs: transcript.endMs,
      text: transcript.text,
      confidence: transcript.confidence,
      wordsJson: transcript.wordsJson,
    })
    .from(transcript)
    .where(eq(transcript.projectId, id))
    .orderBy(asc(transcript.idx))
    .all();

  const segments: Segment[] = rows.map((r) => {
    let words: Word[] = [];
    try {
      words = JSON.parse(r.wordsJson) as Word[];
    } catch {
      words = [];
    }
    return {
      idx: r.idx,
      startMs: r.startMs,
      endMs: r.endMs,
      text: r.text,
      confidence: r.confidence,
      words,
    };
  });

  return Response.json({ segments });
}
