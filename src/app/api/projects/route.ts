import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { desc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clips as clipsTable, projects as projectsTable } from "@/lib/db/schema";
import { jobRunner } from "@/lib/jobs/runner";
// Side-effecting import: registers the `analyze` handler with the runner.
// (Instrumentation also does this, but importing here guarantees the handler is
// present even if this route is the first thing to touch the runner in a given
// server instance — e.g. a fresh worker that didn't run register() yet.)
import "@/lib/pipeline/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ProjectListItem = {
  id: string;
  url: string;
  videoId: string | null;
  title: string | null;
  channel: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  status: string;
  clipCount: number;
  createdAt: string | null;
}

/** List projects, newest first, with clip counts. */
export async function GET() {
  const rows = db
    .select()
    .from(projectsTable)
    .orderBy(desc(projectsTable.createdAt))
    .all();
  const clipCounts = new Map<string, number>();
  for (const c of db.select({ projectId: clipsTable.projectId }).from(clipsTable).all()) {
    clipCounts.set(c.projectId, (clipCounts.get(c.projectId) ?? 0) + 1);
  }
  const items: ProjectListItem[] = rows.map((p) => ({
    id: p.id,
    url: p.url,
    videoId: p.videoId,
    title: p.title,
    channel: p.channel,
    thumbnailUrl: p.thumbnailUrl,
    durationSec: p.durationSec,
    status: p.status,
    clipCount: clipCounts.get(p.id) ?? 0,
    createdAt: p.createdAt,
  }));
  return Response.json({ projects: items });
}

const Body = z.object({
  url: z.string().trim().min(1, "URL is required."),
  framingStyle: z.enum(["blur", "crop"]).optional(),
});

/** Extract the 11-char YouTube video id from any standard URL form. */
function parseVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === "youtu.be") {
    const id = u.pathname.slice(1);
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (
    u.hostname === "www.youtube.com" ||
    u.hostname === "youtube.com" ||
    u.hostname === "m.youtube.com" ||
    u.hostname === "music.youtube.com"
  ) {
    if (u.pathname === "/watch") {
      const v = u.searchParams.get("v");
      return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
    }
    const m = u.pathname.match(/^\/(shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/);
    return m ? m[2] : null;
  }
  return null;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const url = parsed.data.url.trim();
  const videoId = parseVideoId(url);
  if (!videoId) {
    return Response.json(
      { error: "That doesn't look like a YouTube URL." },
      { status: 400 },
    );
  }

  const id = randomUUID();
  const settingsJson = parsed.data.framingStyle ? JSON.stringify({ framingStyle: parsed.data.framingStyle }) : "{}";
  
  db.insert(projectsTable)
    .values({ id, url, videoId, status: "pending", settingsJson })
    .run();

  const job = jobRunner.enqueue({ projectId: id, type: "analyze" });

  return Response.json({ projectId: id, jobId: job.id }, { status: 201 });
}
