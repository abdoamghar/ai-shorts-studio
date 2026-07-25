"use client";

import * as React from "react";
import { ListChecksIcon, Loader2Icon, ScissorsIcon, StarIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TimelineClip = {
  id: string;
  idx: number;
  title: string;
  startMs: number;
  endMs: number;
  overallScore: number | null;
};

function fmtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Score 0-100 → coral (low) → amber (mid) → violet (high). Returns an HSL color. */
function scoreColor(score: number | null): string {
  const s = Math.max(0, Math.min(100, score ?? 50));
  // 10deg (coral) at the low end up to 262deg (primary violet) for the best.
  const hue = Math.round(10 + (s / 100) * 252);
  return `hsl(${hue} 85% 58%)`;
}

export function TimelineView(props: {
  projectId: string;
  durationSec: number | null;
  eligible: boolean;
  onSeek: (ms: number) => void;
}) {
  const { projectId, durationSec, eligible, onSeek } = props;
  const [clips, setClips] = React.useState<TimelineClip[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/projects/${projectId}/clips`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((body: { clips?: TimelineClip[] }) => {
        if (!cancelled) {
          setClips(
            (body.clips ?? []).map((c) => ({
              id: c.id,
              idx: c.idx,
              title: c.title,
              startMs: c.startMs,
              endMs: c.endMs,
              overallScore: c.overallScore,
            })),
          );
        }
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
  }, [projectId, eligible]);

  if (!eligible) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <ListChecksIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Waiting for analysis</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            The timeline fills in once the LLM surfaces clip candidates.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading && clips.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Loading timeline…
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
            Analysis produced no clips. Try a different prompt template.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalMs = durationSec ? durationSec * 1000 : Math.max(...clips.map((c) => c.endMs), 1);
  const max = Math.max(totalMs, ...clips.map((c) => c.endMs));

  return (
    <div className="space-y-3">
      <Card className="p-0">
        <div className="p-3 pb-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Clip overlay
          </p>
          <p className="text-xs text-muted-foreground">
            Each bar is a discovered clip positioned by its source timecode; color reflects overall
            score. Click to seek the player there.
          </p>
        </div>
        <div className="px-3 pb-3 pt-2">
          {/* Ruler */}
          <div className="relative h-8 select-none">
            <div className="absolute inset-x-0 top-3 h-1 rounded bg-muted" />
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <div
                key={f}
                className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${f * 100}%` }}
              >
                <div className="h-3 w-px bg-border" />
                <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {fmtTime(max * f)}
                </span>
              </div>
            ))}
          </div>
          {/* Track */}
          <div className="relative mt-1 h-12 rounded-md border border-border bg-muted/40">
            {clips.map((c) => {
              const left = (c.startMs / max) * 100;
              const width = Math.max(((c.endMs - c.startMs) / max) * 100, 1.2);
              return (
                <button
                  key={c.id}
                  onClick={() => onSeek(c.startMs)}
                  title={`${c.title} · ${fmtTime(c.startMs)}–${fmtTime(c.endMs)}${
                    c.overallScore != null ? ` · score ${c.overallScore.toFixed(1)}` : ""
                  }`}
                  className="absolute top-1 flex h-9 items-center overflow-hidden rounded px-1.5 text-left text-[10px] font-medium text-background transition-transform hover:z-10 hover:scale-y-110"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: scoreColor(c.overallScore),
                  }}
                >
                  <span className="truncate">{c.idx + 1}. {c.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {clips
          .slice()
          .sort((a, b) => a.startMs - b.startMs)
          .map((c) => (
            <button
              key={c.id}
              onClick={() => onSeek(c.startMs)}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-2 text-left transition-colors hover:border-primary/50"
            >
              <span
                className="size-8 shrink-0 rounded-md"
                style={{ backgroundColor: scoreColor(c.overallScore) }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {c.idx + 1}. {c.title}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {fmtTime(c.startMs)}–{fmtTime(c.endMs)}
                </p>
              </div>
              {c.overallScore != null ? (
                <Badge variant="outline" className="shrink-0 gap-1">
                  <StarIcon className="size-3" />
                  {c.overallScore.toFixed(1)}
                </Badge>
              ) : null}
            </button>
          ))}
      </div>
    </div>
  );
}
