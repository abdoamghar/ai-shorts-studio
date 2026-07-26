"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PlayCircleIcon,
  SparklesIcon,
  ArrowRightIcon,
  StarIcon,
  FilmIcon,
  ScissorsIcon,
  Loader2Icon,
  ClapperboardIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Stats = {
  projects: number;
  clips: number;
  renders: number;
  avgOverallScore: number | null;
};
type RecentProject = {
  id: string;
  title: string | null;
  channel: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  status: string;
  clipCount: number;
  createdAt: string | null;
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

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [framingStyle, setFramingStyle] = React.useState("blur");
  const [submitting, setSubmitting] = React.useState(false);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [recent, setRecent] = React.useState<RecentProject[]>([]);

  async function onAnalyze(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("Paste a YouTube URL first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, framingStyle }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not start analysis.");
      }
      toast.success("Analysis started.");
      router.push("/queue");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start analysis.");
      setSubmitting(false);
    }
  }

  // Load stats + recent projects on mount. Both fetches are async; the
  // setStates only run after `await Promise.all`, so the rule never fires
  // in the effect body and no disable directive is needed here.
  React.useEffect(() => {
    let cancelled = false;
    void loadDashboard();
    async function loadDashboard() {
      try {
        const [sr, pr, gs] = await Promise.all([
          fetch("/api/stats", { cache: "no-store" }).then((r) => r.json() as Promise<{ stats: Stats }>),
          fetch("/api/projects", { cache: "no-store" }).then((r) => r.json() as Promise<{ projects: RecentProject[] }>),
          fetch("/api/settings/general", { cache: "no-store" }).then((r) => r.json() as Promise<{ defaultFramingStyle?: string }>).catch(() => ({})),
        ]);
        if (!cancelled) {
          setStats(sr.stats);
          setRecent((pr.projects ?? []).slice(0, 6));
          if ((gs as { defaultFramingStyle?: string }).defaultFramingStyle) {
            setFramingStyle((gs as { defaultFramingStyle?: string }).defaultFramingStyle!);
          }
        }
      } catch {
        /* keep empties; tiles/cards fall back to dashes */
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/10 p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative max-w-2xl space-y-4">
          <Badge variant="secondary" className="gap-1">
            <SparklesIcon className="size-3.5" />
            AI-powered clip discovery
          </Badge>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            Turn long videos into short-form gold
          </h1>
          <p className="text-base text-muted-foreground">
            Paste a YouTube URL. We&rsquo;ll transcribe it, find the best moments, burn in subtitles, and render vertical clips ready for TikTok, Shorts, and Reels.
          </p>
          <form className="flex gap-2" onSubmit={onAnalyze}>
            <div className="flex flex-col gap-3">
              <div className="relative flex-1">
                <PlayCircleIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  type="url"
                  inputMode="url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="h-11 pl-10"
                  aria-label="YouTube video URL"
                  disabled={submitting}
                />
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={framingStyle}
                  onChange={(e) => setFramingStyle(e.target.value)}
                  className="h-11 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={submitting}
                >
                  <option value="blur">Blur Background (Gaming/Action)</option>
                  <option value="crop">Full-Screen Crop (Podcast/Debates)</option>
                  <option value="auto-crop">Auto-Crop (Face Tracking)</option>
                </select>
              </div>
            </div>
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
              Analyze Video
            </Button>
          </form>
        </div>
      </section>

      {/* Statistics */}
      <section>
        <h2 className="mb-3 font-heading text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Statistics
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={FilmIcon} label="Total projects" value={stats?.projects ?? "—"} />
          <StatTile icon={ScissorsIcon} label="Clips generated" value={stats?.clips ?? "—"} />
          <StatTile icon={ClapperboardIcon} label="Renders" value={stats?.renders ?? "—"} />
          <StatTile
            icon={StarIcon}
            label="Avg. clip score"
            value={stats?.avgOverallScore != null ? stats.avgOverallScore.toFixed(1) : "—"}
          />
        </div>
      </section>

      {/* Recent projects */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Recent projects
          </h2>
          <Link
            href="/projects"
            className="text-xs text-muted-foreground hover:underline"
          >
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-muted">
                <FilmIcon className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">No projects yet</p>
              <p className="text-xs text-muted-foreground">
                Analyze your first video to see it appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="group">
                <Card className="h-full overflow-hidden p-0 transition-colors group-hover:border-primary/50">
                  <div className="relative aspect-video w-full bg-muted">
                    {p.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <FilmIcon className="size-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <CardContent className="space-y-1 p-3">
                    <p className="truncate text-sm font-medium text-foreground">
                      {p.title ?? "Untitled video"}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{STATUS_LABEL[p.status] ?? p.status}</Badge>
                      {p.durationSec ? <span>{fmtDuration(p.durationSec)}</span> : null}
                      {p.clipCount > 0 ? <span>· {p.clipCount} clips</span> : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="space-y-0.5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="font-heading text-2xl font-semibold text-foreground">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
