import "server-only";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "@/lib/db/client";
import {
  jobs as jobsTable,
  jobLogs as jobLogsTable,
  type Job,
} from "@/lib/db/schema";
import { jobEvents, type JobSnapshot } from "./sse";

/**
 * In-process job runner (singleton per server instance).
 *
 * Design:
 *  - Durable: every job has a row in `jobs`; `job_logs` keeps per-step lines.
 *    A server restart can't know what was mid-flight, so boot recovery marks
 *    any `running` / `queued` rows as `failed` so the user can retry.
 *  - Bounded concurrency (1): a single worker drains a FIFO queue. Local heavy
 *    jobs (whisper, ffmpeg, LLM) on a laptop would trample each other.
 *  - Streaming: progress is written to SQLite AND published on the SSE bus so
 *    the Processing Queue UI updates live.
 *  - Extensible: pipeline steps register handlers via `registerJobHandler`.
 *    Phase 4 ships an `analyze` handler shell; phases 5-7 register the real
 *    step handlers without touching this file.
 */

export type JobType = "analyze";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobProcessor = (ctx: JobContext) => Promise<void>;

export type JobContext = {
  jobId: string;
  projectId: string;
  /** Optional pipeline step to resume from (set by retry); handlers skip any
   * step whose key comes strictly before this one. Undefined = full run. */
  restartFromStep?: string;
  log: (message: string, level?: "info" | "warn" | "error") => void;
  setStep: (step: string, message?: string) => void;
  setProgress: (progress: number, message?: string) => void;
};

/** Public input to enqueue a job. */
export type EnqueueInput = {
  projectId: string;
  type: JobType;
  /** Optional pipeline step to resume from (used by retry). */
  restartFromStep?: string;
};

const CONCURRENCY = 1;

class JobRunner {
  private active = new Map<string, Job>(); // jobId -> running job record
  private queue: string[] = []; // jobIds waiting
  private processing = false;
  private handlers = new Map<JobType, JobProcessor>();
  private booted = false;

  /** Register a handler for a job type. Called once at module load by steps. */
  registerJobHandler(type: JobType, processor: JobProcessor): void {
    this.handlers.set(type, processor);
  }

  /** Mark interrupted jobs failed so the UI can offer retry. Call at boot. */
  recover(): void {
    if (this.booted) return;
    this.booted = true;
    const stuck = db
      .select()
      .from(jobsTable)
      .where(
        // drizzle has no OR helper import here; select in two shots.
        eq(jobsTable.status, "running"),
      )
      .all();
    const queued = db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.status, "queued"))
      .all();
    const interrupted = [...stuck, ...queued];
    if (interrupted.length === 0) return;
    const now = new Date().toISOString();
    for (const j of interrupted) {
      db.update(jobsTable)
        .set({
          status: "failed",
          error: "Interrupted by server restart.",
          finishedAt: now,
        })
        .where(eq(jobsTable.id, j.id))
        .run();
    }
    console.log(`[shorts] recovered ${interrupted.length} interrupted job(s).`);
  }

  /** Enqueue a job. Persists a `queued` row, snapshots to the bus, and kicks the worker. */
  enqueue(input: EnqueueInput): Job {
    const id = randomUUID();
    db.insert(jobsTable)
      .values({
        id,
        projectId: input.projectId,
        type: input.type,
        status: "queued",
        progress: 0,
        restartFromStep: input.restartFromStep ?? null,
      })
      .run();
    const job = db.select().from(jobsTable).where(eq(jobsTable.id, id)).get()!;
    this.snapshot(job);
    jobEvents.publish({ type: "queued", jobId: id, ts: Date.now() });
    this.queue.push(id);
    void this.drain();
    return job;
  }

  /** Current job record from SQLite (single source of truth for status). */
  get(jobId: string): Job | undefined {
    return db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).get();
  }

  /** Cancel a queued/running job. Running jobs are signalled via the active map. */
  cancel(jobId: string): void {
    const job = this.get(jobId);
    if (!job) return;
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")
      return;
    // Remove from queue if still waiting.
    this.queue = this.queue.filter((id) => id !== jobId);
    const now = new Date().toISOString();
    db.update(jobsTable)
      .set({ status: "cancelled", finishedAt: now })
      .where(eq(jobsTable.id, jobId))
      .run();
    const updated = this.get(jobId)!;
    this.snapshot(updated);
    jobEvents.publish({ type: "cancelled", jobId, ts: Date.now(), message: "Cancelled by user." });
    // Note: an in-flight processor can't be hard-killed from here; it will
    // finish its current step then observe the row's cancelled status via the
    // context's isCancelled() (wired in phase 5). For v1 we accept that.
  }

  /** Retry a failed/cancelled job by creating a fresh job row for the same
   * project+type, seeded with the failed job's last `step` as the resume point
   * so the pipeline doesn't redo completed steps (download/audio/transcribe).
   */
  retry(jobId: string): Job {
    const job = this.get(jobId);
    if (!job) throw new Error("Job not found.");
    return this.enqueue({
      projectId: job.projectId!,
      type: job.type as JobType,
      restartFromStep: job.step ?? undefined,
    });
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.active.size < CONCURRENCY && this.queue.length > 0) {
        const id = this.queue.shift()!;
        void this.run(id);
      }
    } finally {
      this.processing = false;
    }
    // If more queued while we were processing, loop again.
    if (this.queue.length > 0 && this.active.size < CONCURRENCY) void this.drain();
  }

  private async run(jobId: string): Promise<void> {
    const job = this.get(jobId);
    if (!job || job.status !== "queued") return;
    const now = new Date().toISOString();
    db.update(jobsTable)
      .set({ status: "running", startedAt: now })
      .where(eq(jobsTable.id, jobId))
      .run();
    const running = this.get(jobId)!;
    this.active.set(jobId, running);
    this.snapshot(running);
    jobEvents.publish({ type: "running", jobId, ts: Date.now() });

    const ctx: JobContext = {
      jobId,
      projectId: job.projectId!,
      restartFromStep: job.restartFromStep ?? undefined,
      log: (message, level = "info") => this.log(jobId, undefined, message, level),
      setStep: (step, message) => this.updateStep(jobId, step, message),
      setProgress: (progress, message) => this.updateProgress(jobId, progress, message),
    };

    try {
      const handler = this.handlers.get(job.type as JobType);
      if (!handler) {
        throw new Error(`No handler registered for job type "${job.type}".`);
      }
      await handler(ctx);
      const done = new Date().toISOString();
      db.update(jobsTable)
        .set({ status: "succeeded", progress: 100, finishedAt: done })
        .where(eq(jobsTable.id, jobId))
        .run();
      const finished = this.get(jobId)!;
      this.snapshot(finished);
      jobEvents.publish({ type: "succeeded", jobId, ts: Date.now(), progress: 100 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      const done = new Date().toISOString();
      db.update(jobsTable)
        .set({ status: "failed", error: message, finishedAt: done })
        .where(eq(jobsTable.id, jobId))
        .run();
      this.log(jobId, undefined, message, "error");
      const finished = this.get(jobId)!;
      this.snapshot(finished);
      jobEvents.publish({ type: "failed", jobId, ts: Date.now(), message });
    } finally {
      this.active.delete(jobId);
      void this.drain();
    }
  }

  private updateStep(jobId: string, step: string, message?: string): void {
    db.update(jobsTable)
      .set({ step, ...(message !== undefined ? { message } : {}) })
      .where(eq(jobsTable.id, jobId))
      .run();
    const job = this.get(jobId)!;
    this.snapshot(job);
    jobEvents.publish({ type: "step", jobId, ts: Date.now(), step, message });
  }

  private updateProgress(jobId: string, progress: number, message?: string): void {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    db.update(jobsTable)
      .set({ progress: clamped, ...(message !== undefined ? { message } : {}) })
      .where(eq(jobsTable.id, jobId))
      .run();
    const job = this.get(jobId)!;
    this.snapshot(job);
    jobEvents.publish({ type: "progress", jobId, ts: Date.now(), progress: clamped, message });
  }

  private log(
    jobId: string,
    step: string | undefined,
    message: string,
    level: "info" | "warn" | "error" = "info",
  ): void {
    db.insert(jobLogsTable)
      .values({ jobId, step, message, level })
      .run();
    jobEvents.publish({ type: "log", jobId, ts: Date.now(), step, message, level });
  }

  private snapshot(job: Job): void {
    const snap: JobSnapshot = {
      jobId: job.id,
      status: job.status as JobSnapshot["status"],
      progress: job.progress,
      step: job.step,
      message: job.message,
    };
    jobEvents.setSnapshot(snap);
  }
}

// Single shared instance per process.
export const jobRunner = new JobRunner();
