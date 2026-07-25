"use client";

import {
  PlayIcon,
  ClockIcon,
  StarIcon,
  HashIcon,
  SparklesIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type ClipCardData = {
  id: string;
  idx: number;
  title: string;
  hook: string | null;
  summary: string | null;
  emotion: string | null;
  category: string | null;
  startMs: number;
  endMs: number;
  overallScore: number | null;
  viralityScore: number | null;
  retentionScore: number | null;
  engagementScore: number | null;
  scores: {
    hook?: number;
    emotion?: number;
    curiosity?: number;
    shareability?: number;
    retention?: number;
    educational?: number;
    overall?: number;
  };
  hashtags: string[];
  keywords: string[];
  status: string;
  favorite: boolean;
};

function fmtLen(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 8) return "text-emerald-500";
  if (score >= 6) return "text-primary";
  if (score >= 4) return "text-amber-500";
  return "text-muted-foreground";
}

export function ClipCard({
  clip,
  rank,
  thumbnailUrl,
  onSeek,
}: {
  clip: ClipCardData;
  rank: number;
  thumbnailUrl?: string | null;
  onSeek: (startMs: number, endMs: number) => void;
}) {
  const lenMs = Math.max(0, clip.endMs - clip.startMs);
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start gap-3">
          {/* Rank + thumbnail */}
          <button
            type="button"
            onClick={() => onSeek(clip.startMs, clip.endMs)}
            className="group relative block size-16 shrink-0 overflow-hidden rounded-md bg-muted"
            aria-label={`Preview clip ${rank + 1}: ${clip.title}`}
          >
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt=""
                className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <SparklesIcon className="size-5 text-muted-foreground" />
              </div>
            )}
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">
              #{rank + 1}
            </span>
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
              <PlayIcon className="size-6 text-white drop-shadow" />
            </span>
          </button>

          {/* Title + length */}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-medium text-foreground">{clip.title}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="size-3" />
                {fmtLen(lenMs)}
              </span>
              {clip.category ? (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {clip.category}
                </Badge>
              ) : null}
              {clip.emotion ? (
                <span className="italic">{clip.emotion}</span>
              ) : null}
            </div>
          </div>

          {/* Overall score */}
          <div className="flex shrink-0 flex-col items-center">
            <StarIcon
              className={cn("size-4", scoreTone(clip.overallScore ?? clip.scores.overall))}
            />
            <span className={cn("text-base font-semibold tabular-nums", scoreTone(clip.overallScore ?? clip.scores.overall))}>
              {(clip.overallScore ?? clip.scores.overall ?? 0).toFixed(1)}
            </span>
          </div>
        </div>

        {/* Hook / summary excerpt */}
        {clip.hook ? (
          <p className="line-clamp-2 text-xs italic text-foreground/90">“{clip.hook}”</p>
        ) : null}
        {clip.summary ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{clip.summary}</p>
        ) : null}

        {/* Score badges */}
        <div className="flex flex-wrap gap-1.5">
          {typeof clip.viralityScore === "number" ? (
            <ScorePill label="viral" value={clip.viralityScore} />
          ) : null}
          {typeof clip.retentionScore === "number" ? (
            <ScorePill label="retain" value={clip.retentionScore} />
          ) : null}
          {typeof clip.engagementScore === "number" ? (
            <ScorePill label="engage" value={clip.engagementScore} />
          ) : null}
          {typeof clip.scores.hook === "number" ? (
            <ScorePill label="hook" value={clip.scores.hook} />
          ) : null}
          {typeof clip.scores.curiosity === "number" ? (
            <ScorePill label="curiosity" value={clip.scores.curiosity} />
          ) : null}
        </div>

        {/* Hashtags */}
        {clip.hashtags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <HashIcon className="size-3 text-muted-foreground" />
            {clip.hashtags.slice(0, 6).map((h, i) => (
              <span key={`${h}-${i}`} className="text-[11px] text-muted-foreground">
                #{h}
              </span>
            ))}
            {clip.hashtags.length > 6 ? (
              <span className="text-[11px] text-muted-foreground">+{clip.hashtags.length - 6}</span>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end pt-1">
          <Button size="sm" variant="outline" onClick={() => onSeek(clip.startMs, clip.endMs)}>
            <PlayIcon className="size-3.5" />
            Preview clip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", scoreTone(value))}>
        {value.toFixed(1)}
      </span>
    </Badge>
  );
}
