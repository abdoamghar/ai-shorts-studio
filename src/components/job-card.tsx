"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BanIcon,
  CircleCheckIcon,
  FilmIcon,
  Loader2Icon,
  RotateCcwIcon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

export type JobListEntry = {
  id: string;
  projectId: string | null;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  step: string | null;
  message: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  projectUrl: string | null;
  projectTitle: string | null;
  projectVideoId: string | null;
  projectThumbnailUrl: string | null;
};

type StreamEvent =
  | {
      type: "snapshot";
      snapshot: {
        status: JobListEntry["status"];
        progress: number;
        step: string | null;
        message: string | null;
      };
    }
  | {
      type: "queued" | "running" | "succeeded" | "failed" | "cancelled";
      jobId: string;
      ts: number;
      progress?: number;
      step?: string;
      message?: string;
      level?: string;
    }
  | {
      type: "progress" | "step" | "log";
      jobId: string;
      ts: number;
      progress?: number;
      step?: string;
      message?: string;
      level?: string;
    };

type LogLine = { ts: number; level: string; message: string; step?: string };

const STATUS_META: Record<
  JobListEntry["status"],
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: React.ReactNode;
  }
> = {
  queued: { label: "Queued", variant: "secondary", icon: <FilmIcon className="size-3.5" /> },
  running: {
    label: "Running",
    variant: "default",
    icon: <Loader2Icon className="size-3.5 animate-spin" />,
  },
  succeeded: {
    label: "Succeeded",
    variant: "outline",
    icon: <CircleCheckIcon className="size-3.5" />,
  },
  failed: {
    label: "Failed",
    variant: "destructive",
    icon: <XCircleIcon className="size-3.5" />,
  },
  cancelled: { label: "Cancelled", variant: "secondary", icon: <BanIcon className="size-3.5" /> },
};

export function JobCard({ job }: { job: JobListEntry }) {
  const [status, setStatus] = React.useState<JobListEntry["status"]>(job.status);
  const [progress, setProgress] = React.useState<number>(job.progress);
  const [step, setStep] = React.useState<string | null>(job.step);
  const [message, setMessage] = React.useState<string | null>(job.message);
  const [logs, setLogs] = React.useState<LogLine[]>([]);
  const [retrying, setRetrying] = React.useState(false);
  const logEndRef = React.useRef<HTMLDivElement | null>(null);

  const applyEvent = React.useCallback((evt: StreamEvent) => {
    if (evt.type === "snapshot") {
      setStatus(evt.snapshot.status);
      setProgress(evt.snapshot.progress);
      setStep(evt.snapshot.step);
      setMessage(evt.snapshot.message);
      return;
    }
    if (evt.type === "log") {
      setLogs((prev) => [
        ...prev.slice(-200),
        { ts: evt.ts, level: evt.level ?? "info", message: evt.message ?? "", step: evt.step },
      ]);
      return;
    }
    if (evt.type === "progress") {
      if (typeof evt.progress === "number") setProgress(evt.progress);
      if (evt.message !== undefined) setMessage(evt.message);
      return;
    }
    if (evt.type === "step") {
      if (evt.step) setStep(evt.step);
      if (evt.message !== undefined) setMessage(evt.message);
      return;
    }
    // terminal-ish events (queued/running/succeeded/failed/cancelled)
    if (evt.type === "succeeded") setProgress(100);
    if (evt.message !== undefined) setMessage(evt.message);
    setStatus(evt.type as JobListEntry["status"]);
  }, []);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs.length]);

  React.useEffect(() => {
    // Terminal jobs are seeded once; no SSE stream needed.
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return;
    }
    const es = new EventSource(`/api/jobs/${job.id}/events`);
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as StreamEvent;
        applyEvent(evt);
      } catch {
        /* ignore malformed frames */
      }
    };
    // EventSource auto-reconnects on transient errors; nothing to do in onerror.
    return () => es.close();
    // Open the stream once per job id (not on every status change — that would
    // reopen EventSource and replay snapshots repeatedly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, applyEvent]);

  async function onRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Retry failed.");
      }
      toast.success("Re-queued job for analysis.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  const meta = STATUS_META[status];
  const terminal =
    status === "succeeded" || status === "failed" || status === "cancelled";
  const projectHref = job.projectId ? `/projects/${job.projectId}` : null;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start gap-4 p-4">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
          {job.projectThumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.projectThumbnailUrl} alt="" className="size-full object-cover" />
          ) : (
            <FilmIcon className="size-5 text-muted-foreground" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={meta.variant} className="gap-1">
              {meta.icon}
              {meta.label}
            </Badge>
            <span className="truncate text-sm font-medium">
              {job.projectTitle ?? job.projectUrl ?? "Unknown video"}
            </span>
            {projectHref && (
              <Link
                href={projectHref}
                className="text-xs text-muted-foreground hover:underline"
              >
                open project
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Progress value={progress} className="h-1.5" />
            <span className="w-10 shrink-0 text-right tabular-nums text-xs text-muted-foreground">
              {progress}%
            </span>
          </div>

          <div className="min-h-4 text-xs text-muted-foreground">
            {terminal && status === "failed" && job.error ? (
              <span className="text-destructive">{job.error}</span>
            ) : step ? (
              <span>
                <span className="font-medium text-foreground">{step}</span>
                {message ? ` — ${message}` : ""}
              </span>
            ) : (
              <span>{message ?? (status === "queued" ? "Waiting in queue…" : "Working…")}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {(status === "failed" || status === "cancelled") && (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
              <RotateCcwIcon className="size-3.5" />
              Retry
            </Button>
          )}
        </div>
      </div>

      {logs.length > 0 ? (
        <div className="border-t bg-muted/30">
          <ScrollArea className="h-32 px-3 py-2">
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.level === "error"
                      ? "text-destructive"
                      : l.level === "warn"
                        ? "text-amber-500"
                        : ""
                  }
                >
                  {l.step ? `[${l.step}] ` : ""}
                  {l.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </pre>
          </ScrollArea>
        </div>
      ) : null}
    </Card>
  );
}
