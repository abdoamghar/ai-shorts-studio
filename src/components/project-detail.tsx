"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  CaptionsIcon,
  CircleCheckIcon,
  ClapperboardIcon,
  ConstructionIcon,
  FileTextIcon,
  ListChecksIcon,
  Loader2Icon,
  ScissorsIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipCard, type ClipCardData } from "@/components/clip-card";
import { ProjectExportsPanel } from "@/components/project-exports-panel";
import { TimelineView } from "@/components/timeline-view";

export type ProjectDetail = {
  id: string;
  url: string;
  videoId: string | null;
  title: string | null;
  channel: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  status: string;
  createdAt: string | null;
};

export type LatestJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  step: string | null;
  message: string | null;
  error: string | null;
} | null;

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

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type SseEvent =
  | {
      type: "snapshot";
      snapshot: {
        status: JobStatus;
        progress: number;
        step: string | null;
        message: string | null;
      };
    }
  | {
      type: "progress" | "step" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
      jobId: string;
      ts: number;
      progress?: number;
      step?: string;
      message?: string;
    };

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  downloading: "Downloading",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  rendering: "Rendering",
  done: "Done",
  error: "Error",
};

function fmtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function ProjectDetail({
  project,
  latestJob,
}: {
  project: ProjectDetail;
  latestJob: LatestJob;
}) {
  const router = useRouter();
  const [job, setJob] = React.useState<LatestJob>(latestJob);
  const [activeTab, setActiveTab] = React.useState("transcript");
  const [segments, setSegments] = React.useState<Segment[]>([]);
  const [loadingTranscript, setLoadingTranscript] = React.useState(false);
  const [clips, setClips] = React.useState<ClipCardData[]>([]);
  const [loadingClips, setLoadingClips] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  async function onDelete() {
    if (
      !confirm(
        `Delete project "${project.title ?? "Untitled video"}"? This removes all clips, renders, and stored files permanently.`,
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Delete failed.");
      }
      toast.success("Project deleted.");
      router.push("/projects");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
      setDeleting(false);
    }
  }

  const applyJobEvent = React.useCallback((evt: SseEvent) => {
    setJob((prev) => {
      if (!prev) return prev;
      if (evt.type === "snapshot") {
        return {
          ...prev,
          status: evt.snapshot.status,
          progress: evt.snapshot.progress,
          step: evt.snapshot.step,
          message: evt.snapshot.message,
        };
      }
      const next = { ...prev };
      if (evt.type === "progress" && typeof evt.progress === "number") {
        next.progress = evt.progress;
        if (evt.message !== undefined) next.message = evt.message;
      } else if (evt.type === "step") {
        if (evt.step) next.step = evt.step;
        if (evt.message !== undefined) next.message = evt.message;
      } else if (evt.type === "succeeded") {
        next.status = "succeeded";
        next.progress = 100;
        if (evt.message !== undefined) next.message = evt.message;
      } else if (
        evt.type === "failed" ||
        evt.type === "cancelled" ||
        evt.type === "running" ||
        evt.type === "queued"
      ) {
        next.status = evt.type;
        if (evt.message !== undefined) next.message = evt.message;
      }
      return next;
    });
  }, []);

  // Live job status via SSE when the job isn't terminal.
  React.useEffect(() => {
    if (!job) return;
    const terminal =
      job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
    if (terminal) return;
    const es = new EventSource(`/api/jobs/${job.id}/events`);
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as SseEvent;
        applyJobEvent(evt);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
    // Bind the stream to the job identity only — reopening on every progress
    // tick (job.status changes) would churn EventSource and replay snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, applyJobEvent]);

  // Load transcript when the Transcript tab opens or when the job reaches done.
  React.useEffect(() => {
    if (activeTab !== "transcript") return;
    const jobDone = job?.status === "succeeded" || job?.status === "failed";
    // Fetch once the project has progressed past transcription (status reflects
    // later phases) OR the job succeeded. Avoid spamming before transcript rows
    // exist.
    const eligible =
      jobDone ||
      project.status === "analyzing" ||
      project.status === "rendering" ||
      project.status === "done";
    if (!eligible) return;
    let cancelled = false;
    // Synchronous loading-flag set is the standard fetch-effect pattern; the
    // subsequent setStates happen after `await`, not during the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingTranscript(true);
    fetch(`/api/projects/${project.id}/transcript`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((body: { segments: Segment[] }) => {
        if (!cancelled) setSegments(body.segments ?? []);
      })
      .catch(() => {
        /* keep empty; user can retry */
      })
      .finally(() => {
        if (!cancelled) setLoadingTranscript(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, project.id, project.status, job?.status]);

  // Load clips once the analyze step has produced rows: job succeeded, or the
  // project has moved past analyzing (rendering/done). Re-runs lift the
  // latestJob.status back to succeeded so this refetches after a retry.
  React.useEffect(() => {
    if (activeTab !== "clips") return;
    const eligible =
      job?.status === "succeeded" ||
      project.status === "rendering" ||
      project.status === "done";
    if (!eligible) return;
    let cancelled = false;
    // Load is fired after eligibility (async fetch); the synchronous setLoading
    // here is the standard flag-toggle at effect entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingClips(true);
    fetch(`/api/projects/${project.id}/clips`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((body: { clips: ClipCardData[] }) => {
        if (!cancelled) setClips(body.clips ?? []);
      })
      .catch(() => {
        /* keep empty */
      })
      .finally(() => {
        if (!cancelled) setLoadingClips(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, project.id, project.status, job?.status]);

  function seekTo(ms: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    v.play().catch(() => {});
  }

  const jobRunning = job && job.status !== "succeeded" && job.status !== "failed" && job.status !== "cancelled";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link href="/projects" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
            <ArrowLeftIcon className="size-3" />
            Projects
          </Link>
          <h1 className="truncate font-heading text-2xl font-semibold tracking-tight text-foreground">
            {project.title ?? "Untitled video"}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {project.channel ?? "Unknown channel"}
            {project.durationSec ? ` · ${fmtTime(project.durationSec * 1000)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{STATUS_LABEL[project.status] ?? project.status}</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={deleting}
            aria-label="Delete project"
            className="text-muted-foreground hover:text-destructive"
          >
            {deleting ? <Loader2Icon className="size-4 animate-spin" /> : <Trash2Icon className="size-4" />}
          </Button>
        </div>
      </header>

      {/* Job status line */}
      {job ? (
        <Card>
          <div className="flex flex-wrap items-center gap-3 p-3">
            {job.status === "succeeded" ? (
              <CircleCheckIcon className="size-4 text-emerald-500" />
            ) : job.status === "failed" ? (
              <TriangleAlertIcon className="size-4 text-destructive" />
            ) : jobRunning ? (
              <Loader2Icon className="size-4 animate-spin text-primary" />
            ) : (
              <ConstructionIcon className="size-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">{job.status}</span>
            {job.step ? <span className="text-xs text-muted-foreground">{job.step}</span> : null}
            <Progress value={job.progress} className="h-1.5 flex-1" />
            <span className="w-10 shrink-0 text-right tabular-nums text-xs text-muted-foreground">
              {job.progress}%
            </span>
          </div>
          {job.status === "failed" && job.error ? (
            <div className="border-t px-3 py-2 text-xs text-destructive">{job.error}</div>
          ) : null}
        </Card>
      ) : null}

      {/* Video preview + transcript tabs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card className="overflow-hidden p-0">
            <div className="aspect-video w-full bg-black">
              {project.status === "downloading" || !project.durationSec ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                  Video will appear once download finishes…
                </div>
              ) : (
                <VideoPlayer
                  videoRef={videoRef}
                  src={`/api/projects/${project.id}/video`}
                  poster={project.thumbnailUrl ?? undefined}
                />
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="transcript"><FileTextIcon className="size-3.5" /></TabsTrigger>
              <TabsTrigger value="clips"><ScissorsIcon className="size-3.5" /></TabsTrigger>
              <TabsTrigger value="timeline"><ListChecksIcon className="size-3.5" /></TabsTrigger>
              <TabsTrigger value="renders"><ClapperboardIcon className="size-3.5" /></TabsTrigger>
            </TabsList>

            <TabsContent value="transcript" className="mt-3">
              <TranscriptView
                segments={segments}
                loading={loadingTranscript}
                eligible={
                  project.status === "analyzing" ||
                  project.status === "rendering" ||
                  project.status === "done"
                }
                jobFailed={job?.status === "failed"}
                onSeek={seekTo}
              />
            </TabsContent>

            <TabsContent value="clips" className="mt-3">
              <ClipsView
                clips={clips}
                loading={loadingClips}
                eligible={
                  job?.status === "succeeded" ||
                  project.status === "rendering" ||
                  project.status === "done"
                }
                thumbnailUrl={project.thumbnailUrl}
                onSeek={(ms) => seekTo(ms)}
              />
            </TabsContent>

            <TabsContent value="timeline" className="mt-3">
              <TimelineView
                projectId={project.id}
                durationSec={project.durationSec}
                eligible={
                  job?.status === "succeeded" ||
                  project.status === "rendering" ||
                  project.status === "done"
                }
                onSeek={seekTo}
              />
            </TabsContent>

            <TabsContent value="renders" className="mt-3">
              <ProjectExportsPanel
                projectId={project.id}
                onSeek={seekTo}
                jobStatus={job?.status}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function VideoPlayer({
  videoRef,
  src,
  poster,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  src: string;
  poster?: string;
}) {
  return (
    <video
      ref={videoRef}
      src={src}
      controls
      className="h-full w-full"
      poster={poster}
    />
  );
}

function TranscriptView({
  segments,
  loading,
  eligible,
  jobFailed,
  onSeek,
}: {
  segments: Segment[];
  loading: boolean;
  eligible: boolean;
  jobFailed: boolean | undefined;
  onSeek: (ms: number) => void;
}) {
  if (!eligible) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <CaptionsIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Waiting for transcription</p>
          <p className="text-xs text-muted-foreground">
            The transcript appears here once the audio has been transcribed.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (loading && segments.length === 0) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1 rounded-md border p-2">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }
  if (segments.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <CaptionsIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {jobFailed ? "Transcription failed" : "No transcript yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {jobFailed
              ? "The transcription job didn’t complete. Retry from the Processing Queue."
              : "Transcription produced no segments."}
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <ScrollArea className="h-[28rem]">
        <div className="divide-y">
          {segments.map((s) => (
            <button
              key={s.idx}
              onClick={() => onSeek(s.startMs)}
              className="flex w-full items-start gap-3 p-2 text-left hover:bg-muted/50"
            >
              <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground">
                {fmtTime(s.startMs)}
              </span>
              <span className="text-sm leading-relaxed text-foreground">{s.text}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}

function ClipsView({
  clips,
  loading,
  eligible,
  thumbnailUrl,
  onSeek,
}: {
  clips: ClipCardData[];
  loading: boolean;
  eligible: boolean;
  thumbnailUrl: string | null;
  onSeek: (ms: number) => void;
}) {
  if (!eligible) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <ScissorsIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Waiting for analysis</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            The LLM surfaces clip candidates here once the analyze step finishes.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (loading && clips.length === 0) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }
  if (clips.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <ScissorsIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No clips yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Analysis produced no clips. Check the job log or try a different prompt template.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {clips.map((c, i) => (
        <ClipCard
          key={c.id}
          clip={c}
          rank={i}
          thumbnailUrl={thumbnailUrl}
          onSeek={(ms) => onSeek(ms)}
        />
      ))}
    </div>
  );
}

