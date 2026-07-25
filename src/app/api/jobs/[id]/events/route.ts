import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { jobs as jobsTable } from "@/lib/db/schema";
import {
  jobEvents,
  type JobEvent,
  type JobSnapshot,
} from "@/lib/jobs/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

function encodeSSE(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return new Response("Missing job id.", { status: 400 });
  }

  const existing = db.select().from(jobsTable).where(eq(jobsTable.id, id)).get();
  if (!existing) {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      // The bus replays the latest snapshot on subscribe (first event).
      const unsubscribe = jobEvents.subscribe(id, (evt) => {
        if (closed) return;
        safeEnqueue(encodeSSE(evt));

        // Snapshot may already be terminal (reconnecting after completion).
        if (
          evt.type === "snapshot" &&
          TERMINAL.has(evt.snapshot.status)
        ) {
          close();
          return;
        }
        if (evt.type !== "snapshot" && TERMINAL.has(evt.type)) {
          close();
        }
      });

      function close() {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      // If the job was already terminal in SQLite but the bus had no snapshot
      // (e.g. process restarted and someone reopens before any publish), emit a
      // final snapshot from the row then close.
      if (TERMINAL.has(existing.status)) {
        const snap: JobSnapshot = {
          jobId: id,
          status: existing.status as JobSnapshot["status"],
          progress: existing.progress,
          step: existing.step,
          message: existing.message,
        };
        safeEnqueue(encodeSSE({ type: "snapshot", snapshot: snap }));
        close();
      }
    },
    cancel() {
      // ReadableStream calls this when the client disconnects. Subscription is
      // cleaned up in close(); the store callback above also guards `closed`.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable Next's response buffering for streaming.
      "X-Accel-Buffering": "no",
    },
  });
}

// Keep the import types referenced for downstream bundler typing.
export type { JobEvent };
