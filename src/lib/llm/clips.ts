import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clips as clipsTable, transcript } from "@/lib/db/schema";
import { ClipCandidateSchema, type ClipCandidate } from "@/lib/llm/schema";

/**
 * Post-processing of raw LLM clip output:
 *  - tolerant parse (accept {clips:[]} | [] | {candidates:[]} and per-item failures)
 *  - zod validate (drop malformed candidates, keep the good ones)
 *  - overlap de-duplication (>30% IoU → keep the higher-scoring clip)
 *  - clip cap (default 10; auto 5 if source < 20min; user override wins)
 *  - sort by overallScore desc
 *  - resolve start/end transcript segment indices + persist to `clips`
 */

export type ParsedClip = ClipCandidate & { raw?: unknown };

export type TranscriptSegment = {
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type ClipPersistOpts = {
  projectId: string;
  /** Source duration in seconds (for auto cap). */
  durationSec: number;
  /** User override cap; if set, used as-is. */
  maxClipsOverride?: number;
};

/** Any reasonable wrapper the model might return. */
export function parseClipsResponse(data: unknown): ClipCandidate[] {
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  let arr: unknown = null;
  if (Array.isArray(root)) {
    arr = root;
  } else if (Array.isArray(root.clips)) {
    arr = root.clips;
  } else if (root.clips && typeof root.clips === "object") {
    // Some models nest {clips:{...}} or echo the schema.
    const inner = (root.clips as Record<string, unknown>)?.clips;
    arr = Array.isArray(inner) ? inner : Array.isArray(root.clips) ? root.clips : null;
  } else if (Array.isArray(root.candidates)) {
    arr = root.candidates;
  } else if (Array.isArray(root.items)) {
    arr = root.items;
  }
  if (!Array.isArray(arr)) return [];

  const out: ClipCandidate[] = [];
  for (const item of arr) {
    const parsed = ClipCandidateSchema.safeParse(item);
    if (parsed.success) {
      const c = parsed.data;
      // Sanity: end must be after start, and start within a plausible range.
      if (c.end > c.start && c.start >= 0) {
        out.push({ ...c, start: round1(c.start), end: round1(c.end) });
      }
    }
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Intersection-over-union of two ms intervals. */
export function overlapIoU(
  a: { start: number; end: number },
  b: { start: number; end: number },
): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  if (inter === 0) return 0;
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union <= 0 ? 0 : inter / union;
}

const OVERLAP_THRESHOLD = 0.3;

/** Greedy keep-best on >30% IoU, processing by descending score. */
export function dedupClips(cs: ClipCandidate[]): ClipCandidate[] {
  const sorted = [...cs].sort((a, b) => b.overallScore - a.overallScore);
  const kept: ClipCandidate[] = [];
  for (const c of sorted) {
    const overlaps = kept.some(
      (k) => overlapIoU(k, c) > OVERLAP_THRESHOLD,
    );
    if (!overlaps) kept.push(c);
  }
  return kept;
}

/** Auto cap: 10 for >=20min sources, 5 for shorter; user override wins. */
export function resolveMaxClips(durationSec: number, override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.min(30, Math.max(1, Math.round(override)));
  }
  return durationSec >= 20 * 60 ? 10 : 5;
}

/** Sort by overallScore desc (ties broken by viralityScore). */
export function sortClips(cs: ClipCandidate[]): ClipCandidate[] {
  return [...cs].sort(
    (a, b) =>
      b.overallScore - a.overallScore ||
      (b.viralityScore ?? 0) - (a.viralityScore ?? 0),
  );
}

/** Cut down to N by score order. */
export function capClips(cs: ClipCandidate[], n: number): ClipCandidate[] {
  return sortClips(cs).slice(0, n);
}

/**
 * Resolve the transcript segment index that best anchors the clip's start/end,
 * so subtitles/timeline can pull the right word window later. Finds the
 * transcript segment whose span contains the clip start (and clip end).
 */
export function resolveSegmentIndices(
  clip: { start: number; end: number },
  segments: TranscriptSegment[],
): { startIdx: number | null; endIdx: number | null } {
  if (segments.length === 0) return { startIdx: null, endIdx: null };
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);

  // startIdx: last segment whose start <= clip.start (the segment the clip
  // begins inside, or the one immediately preceding if it begins in a gap).
  let startIdx: number | null = null;
  for (const seg of sorted) {
    const segStart = seg.startMs / 1000;
    const segEnd = seg.endMs / 1000;
    if (segStart <= clip.start && segEnd >= clip.start) {
      startIdx = seg.idx;
      break;
    }
    if (segStart <= clip.start) startIdx = seg.idx; // keep advancing until we pass
  }

  // endIdx: first segment whose span contains clip.end.
  let endIdx: number | null = null;
  for (const seg of sorted) {
    const segEnd = seg.endMs / 1000;
    if (segEnd >= clip.end) {
      endIdx = seg.idx;
      break;
    }
  }
  if (endIdx === null) endIdx = sorted[sorted.length - 1].idx;
  if (startIdx === null) startIdx = sorted[0].idx;
  return { startIdx, endIdx };
}

/**
 * Full post-process then persist: clear existing clips for the project, insert
 * the kept clips in score order (idx reflects final ranking). Returns the
 * persisted count.
 */
export function persistClips(
  raw: unknown,
  segments: TranscriptSegment[],
  opts: ClipPersistOpts,
): { count: number; rawCandidates: number; deduped: number } {
  const parsed = parseClipsResponse(raw);
  const deduped = dedupClips(parsed);
  const max = resolveMaxClips(opts.durationSec, opts.maxClipsOverride);
  const finalClips = capClips(deduped, max);

  // Clear existing (retry replaces).
  db.delete(clipsTable).where(eq(clipsTable.projectId, opts.projectId)).run();

  finalClips.forEach((c, i) => {
    const { startIdx, endIdx } = resolveSegmentIndices(c, segments);
    db.insert(clipsTable)
      .values({
        id: randomUUID(),
        projectId: opts.projectId,
        idx: i,
        title: c.title,
        hook: c.hook ?? null,
        summary: c.summary ?? null,
        emotion: c.emotion ?? null,
        category: c.category ?? null,
        startMs: Math.round(c.start * 1000),
        endMs: Math.round(c.end * 1000),
        scoresJson: JSON.stringify(
          c.scores ?? {
            hook: 0,
            emotion: 0,
            curiosity: 0,
            shareability: 0,
            retention: 0,
            educational: 0,
            overall: c.overallScore,
          },
        ),
        viralityScore: c.viralityScore ?? null,
        retentionScore: c.retentionScore ?? null,
        engagementScore: c.engagementScore ?? null,
        overallScore: c.overallScore,
        hashtagsJson: JSON.stringify(c.hashtags ?? []),
        keywordsJson: JSON.stringify(c.keywords ?? []),
        startWordIdx: startIdx,
        endWordIdx: endIdx,
        status: "pending",
        favorite: false,
      })
      .run();
  });

  return {
    count: finalClips.length,
    rawCandidates: parsed.length,
    deduped: deduped.length,
  };
}

/** Convenience: load transcript segments for a project, ordered. */
export function loadTranscriptSegments(projectId: string): TranscriptSegment[] {
  return db
    .select({
      idx: transcript.idx,
      startMs: transcript.startMs,
      endMs: transcript.endMs,
      text: transcript.text,
    })
    .from(transcript)
    .where(eq(transcript.projectId, projectId))
    .all();
}
