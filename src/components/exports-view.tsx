"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArchiveIcon,
  DownloadIcon,
  ClapperboardIcon,
  Loader2Icon,
  StarIcon,
  ClockIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type GlobalRender = {
  id: string;
  clipId: string;
  projectId: string;
  projectTitle: string | null;
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

export function ExportsView() {
  const [renders, setRenders] = React.useState<GlobalRender[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/renders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((body: { renders?: GlobalRender[] }) => {
        if (!cancelled) setRenders(body.renders ?? []);
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
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
          <ClapperboardIcon className="size-6 text-primary" />
          Exports
        </h1>
        <p className="text-sm text-muted-foreground">
          All rendered vertical clips across projects. Download MP4, SRT/ASS subtitles, or clip
          metadata JSON individually.
        </p>
      </div>

      {loading && renders.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Loading renders…
        </div>
      ) : renders.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No renders yet. Once a project finishes the render step, its 9:16 clips show up here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {renders.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                      {r.title || `Clip ${r.idx + 1}`}
                    </span>
                    {r.projectId ? (
                      <Link
                        href={`/projects/${r.projectId}`}
                        className="shrink-0 text-xs text-muted-foreground hover:underline"
                      >
                        {r.projectTitle ?? "project"}
                      </Link>
                    ) : null}
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
                    <span>{r.resolution || "—"}</span>
                    <span>{fmtSize(r.sizeBytes)}</span>
                    <Badge variant={r.exists ? "default" : "secondary"}>
                      {r.exists ? "ready" : "missing"}
                    </Badge>
                  </div>
                </div>
                <DownloadButtons
                  projectId={r.projectId}
                  clipId={r.clipId}
                  disabled={!r.exists}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-clip download buttons: mp4, srt, ass, json. */
export function DownloadButtons(props: {
  projectId: string;
  clipId: string;
  disabled?: boolean;
}) {
  const { projectId, clipId, disabled } = props;
  const formats: { fmt: "mp4" | "srt" | "ass" | "json"; label: string }[] = [
    { fmt: "mp4", label: "MP4" },
    { fmt: "srt", label: "SRT" },
    { fmt: "ass", label: "ASS" },
    { fmt: "json", label: "JSON" },
  ];
  const base = `/api/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}/export`;
  return (
    <div className="flex flex-wrap gap-2">
      {formats.map(({ fmt, label }) => (
        <Button
          key={fmt}
          asChild
          variant="outline"
          size="sm"
          disabled={disabled && fmt === "mp4"}
        >
          <a href={`${base}?fmt=${fmt}`} download>
            <DownloadIcon className="size-3.5" />
            {label}
          </a>
        </Button>
      ))}
    </div>
  );
}

/** Bulk zip download button for a whole project. */
export function BulkZipButton(props: { projectId: string }) {
  const { projectId } = props;
  return (
    <Button asChild variant="outline" size="sm">
      <a href={`/api/projects/${encodeURIComponent(projectId)}/export-zip`} download>
        <ArchiveIcon className="size-3.5" />
        Export all (zip)
      </a>
    </Button>
  );
}
