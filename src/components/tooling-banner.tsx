"use client";

import * as React from "react";
import { TriangleAlertIcon, XIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

type Tools = {
  ytDlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  python: boolean;
  fasterWhisper: boolean;
};

const LABELS: { key: keyof Tools; label: string }[] = [
  { key: "ytDlp", label: "yt-dlp" },
  { key: "ffmpeg", label: "ffmpeg" },
  { key: "ffprobe", label: "ffprobe" },
  { key: "python", label: "python" },
  { key: "fasterWhisper", label: "faster-whisper" },
];

export function ToolingBanner() {
  const [tools, setTools] = React.useState<Tools | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/system/tools", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((body: { tools: Tools }) => {
        if (!cancelled) setTools(body.tools);
      })
      .catch(() => {
        /* silent: don't banner on a transient fetch error */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const missing =
    tools == null ? [] : LABELS.filter((l) => !tools[l.key]).map((l) => l.label);

  if (tools == null || missing.length === 0 || dismissed) return null;

  return (
    <Card className="mb-0 flex items-center gap-3 border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
      <TriangleAlertIcon className="size-4 shrink-0 text-amber-500" />
      <p className="flex-1 text-sm text-amber-200">
        Missing tooling: <span className="font-medium text-amber-100">{missing.join(", ")}</span>.
        Run <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono text-xs">npm run setup</code>{" "}
        to install, or set their env paths (e.g. <code className="font-mono text-xs">YT_DLP_PATH</code>). The
        pipeline can&rsquo;t run without these.
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-amber-200/70 hover:bg-amber-500/15 hover:text-amber-100"
        aria-label="Dismiss"
      >
        <XIcon className="size-4" />
      </button>
    </Card>
  );
}
