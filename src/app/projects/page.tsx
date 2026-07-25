"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FolderIcon, Loader2Icon, RefreshCwIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

export default function ProjectsPage() {
  const [projects, setProjects] = React.useState<RecentProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function deleteProject(p: RecentProject) {
    if (
      !confirm(
        `Delete project "${p.title ?? "Untitled video"}"? This removes all clips, renders, and stored files permanently.`,
      )
    )
      return;
    setDeletingId(p.id);
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Delete failed.");
      }
      toast.success("Project deleted.");
      setProjects((prev) => prev.filter((x) => x.id !== p.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const data = (await res.json()) as { projects?: RecentProject[] };
      setProjects(data.projects ?? []);
    } catch {
      /* keep empty */
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((body: { projects?: RecentProject[] }) => {
        if (!cancelled) setProjects(body.projects ?? []);
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

  const filtered = query.trim()
    ? projects.filter(
        (p) =>
          (p.title ?? "").toLowerCase().includes(query.trim().toLowerCase()) ||
          (p.channel ?? "").toLowerCase().includes(query.trim().toLowerCase()),
      )
    : projects;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
            <FolderIcon className="size-6 text-primary" />
            Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            All analyzed videos. Each project holds its transcript, clips, renders, and exports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or channel…"
            className="h-9 w-56"
          />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        </div>
      </header>

      {loading && projects.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Loading projects…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-muted">
              <FolderIcon className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {projects.length === 0 ? "No projects yet" : "No matches"}
            </p>
            <p className="text-xs text-muted-foreground">
              {projects.length === 0
                ? "Paste a YouTube URL on the dashboard to analyze your first video."
                : "Try a different search."}
            </p>
            {projects.length === 0 ? (
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link href="/">Go to Dashboard</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="group relative">
              <Link href={`/projects/${p.id}`} className="block h-full">
                <Card className="h-full overflow-hidden p-0 transition-colors group-hover:border-primary/50">
                  <div className="relative aspect-video w-full bg-muted">
                    {p.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <FolderIcon className="size-6 text-muted-foreground" />
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
                    {p.channel ? (
                      <p className="truncate text-xs text-muted-foreground">{p.channel}</p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void deleteProject(p);
                }}
                disabled={deletingId === p.id}
                aria-label="Delete project"
                className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                title="Delete project"
              >
                {deletingId === p.id ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <Trash2Icon className="size-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
