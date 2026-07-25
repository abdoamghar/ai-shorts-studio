"use client";

import * as React from "react";
import {
  Loader2Icon,
  StarIcon,
  ClockIcon,
  ClapperboardIcon,
  PlayCircleIcon,
  RefreshCwIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { DownloadButtons, BulkZipButton } from "@/components/exports-view";

type RenderItem = {
  id: string;
  clipId: string;
  idx: number;
  title: string;
  startMs: number;
  endMs: number;
  overallScore: number | null;
  status: string;
  format: string;
  resolution: string;
  sizeBytes: number | null;
  durationMs: number | null;
  exists: boolean;
  createdAt: string | null;
};

function fmtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "pending", variant: "outline" },
  queued: { label: "queued", variant: "outline" },
  rendering: { label: "rendering", variant: "secondary" },
  rendered: { label: "rendered", variant: "default" },
  failed: { label: "failed", variant: "destructive" },
};

export function ProjectExportsPanel(props: {
  projectId: string;
  onSeek: (ms: number) => void;
  /** Re-render when the job finishes so freshly-rendered clips appear. */
  jobStatus?: string;
}) {
  const { projectId, onSeek, jobStatus } = props;
  const [items, setItems] = React.useState<RenderItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/renders`, { cache: "no-store" });
      const data = (await res.json()) as { renders?: RenderItem[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Load failed (${res.status})`);
      setItems(data.renders ?? []);
    } catch (err) {
      toast.error("Failed to load renders", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  // Load when the panel mounts and again when a job reaches a terminal state.
  React.useEffect(() => {
    if (jobStatus === "queued" || jobStatus === "running") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/projects/${projectId}/renders`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((body: { renders?: RenderItem[] }) => {
        if (!cancelled) setItems(body.renders ?? []);
      })
      .catch(() => {
        /* keep empty */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, jobStatus]);

  const renderedCount = items.filter((i) => i.exists).length;
  const totalCount = items.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {renderedCount} of {totalCount} rendered
          </p>
          <p className="text-xs text-muted-foreground">
            9:16 burned-subtitle clips. Download individually or grab the whole batch as a zip.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
          {totalCount > 0 ? <BulkZipButton projectId={projectId} /> : null}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Loading renders…
        </div>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <ClapperboardIcon className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No clips to render</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Renders appear here once the analyze step produces clip candidates and the render step
              finishes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const badge = STATUS_BADGE[r.status] ?? { label: r.status, variant: "outline" as const };
            return (
              <Card key={r.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSeek(r.startMs)}
                        className="inline-flex shrink-0 items-center text-muted-foreground hover:text-foreground"
                        title="Seek video to clip start"
                      >
                        <PlayCircleIcon className="size-4" />
                      </button>
                      <span className="truncate font-medium text-foreground">
                        {r.title || `Clip ${r.idx + 1}`}
                      </span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon className="size-3" />
                        {fmtTime(r.startMs)}–{fmtTime(r.endMs)}
                      </span>
                      {r.overallScore != null ? (
                        <span className="inline-flex items-center gap-1">
                          <StarIcon className="size-3" />
                          {r.overallScore.toFixed(1)}
                        </span>
                      ) : null}
                      {r.resolution ? <span>{r.resolution}</span> : null}
                      <span>{fmtSize(r.sizeBytes)}</span>
                    </div>
                  </div>
                  <DownloadButtons
                    projectId={projectId}
                    clipId={r.clipId}
                    disabled={!r.exists}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
