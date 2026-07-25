"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ListChecksIcon, RefreshCwIcon, ConstructionIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JobCard, type JobListEntry } from "@/components/job-card";

type JobsResponse = { jobs: JobListEntry[] };

export default function QueuePage() {
  const router = useRouter();
  const [jobs, setJobs] = React.useState<JobListEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadJobs = React.useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load jobs.");
      const body = (await res.json()) as JobsResponse;
      setJobs(body.jobs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // Initial seed fetch + periodic refresh. loadJobs is async; setState calls
    // happen after `await`, not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadJobs();
    const interval = window.setInterval(loadJobs, 10000);
    return () => window.clearInterval(interval);
  }, [loadJobs]);

  React.useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") loadJobs();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [loadJobs]);

  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const done = jobs.filter((j) => j.status !== "queued" && j.status !== "running");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ListChecksIcon className="size-4 text-primary" />
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
              Processing Queue
            </h1>
            {active.length > 0 ? (
              <Badge variant="default" className="ml-1 gap-1">
                {active.length} active
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Live analysis jobs streamed over SSE. New projects are queued here automatically.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadJobs} disabled={loading}>
          <RefreshCwIcon className={loading ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </Button>
      </header>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {loading && jobs.length === 0 ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex animate-pulse items-center gap-4">
                <div className="size-12 rounded-md bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 rounded bg-muted" />
                  <div className="h-2 w-1/2 rounded bg-muted" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-muted">
              <ConstructionIcon className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No jobs yet</p>
            <p className="text-xs text-muted-foreground">
              Paste a YouTube URL on the dashboard to start a job.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => router.push("/")}
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {active.length > 0 ? (
            <section className="space-y-3">
              <h2 className="font-heading text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Active
              </h2>
              <div className="space-y-3">
                {active.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            </section>
          ) : null}

          {done.length > 0 ? (
            <section className="space-y-3">
              <h2 className="font-heading text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recently finished
              </h2>
              <div className="space-y-3">
                {done.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
