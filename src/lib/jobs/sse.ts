import "server-only";

/**
 * In-process event bus for job progress.
 *
 * The runner publishes structured events here; the SSE route subscribes a
 * client's stream to a job's channel. On subscribe we immediately emit the
 * latest snapshot so a reconnecting client (or one that opens after the job
 * started) doesn't miss the current state.
 *
 * Events are JSON-serialisable. keept deliberately small to avoid holding
 * large transcripts in memory — log lines accumulate in SQLite (`job_logs`),
 * not here.
 */

export type JobEventType =
  | "queued"
  | "running"
  | "progress"
  | "step"
  | "log"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JobEvent = {
  type: JobEventType;
  jobId: string;
  ts: number; // epoch millis
  progress?: number; // 0-100
  step?: string;
  message?: string;
  level?: string; // for log events
};

export type JobSnapshot = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  step: string | null;
  message: string | null;
};

type Subscriber = (event: JobEvent | { type: "snapshot"; snapshot: JobSnapshot }) => void;

class JobEventBus {
  private subscribers = new Map<string, Set<Subscriber>>();
  private snapshots = new Map<string, JobSnapshot>();

  setSnapshot(s: JobSnapshot): void {
    this.snapshots.set(s.jobId, s);
  }
  getSnapshot(jobId: string): JobSnapshot | undefined {
    return this.snapshots.get(jobId);
  }

  subscribe(jobId: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(jobId);
    if (!set) {
      set = new Set();
      this.subscribers.set(jobId, set);
    }
    set.add(fn);
    // Replay current snapshot immediately so the client lands on the latest state.
    const snap = this.snapshots.get(jobId);
    if (snap) fn({ type: "snapshot", snapshot: snap });
    return () => {
      set?.delete(fn);
      if (set && set.size === 0) this.subscribers.delete(jobId);
    };
  }

  publish(event: JobEvent): void {
    const set = this.subscribers.get(event.jobId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(event);
      } catch {
        /* a bad subscriber shouldn't break others */
      }
    }
  }

  clear(jobId: string): void {
    this.subscribers.delete(jobId);
    this.snapshots.delete(jobId);
  }
}

// Singleton across the process (module cached per Next server instance).
export const jobEvents = new JobEventBus();
