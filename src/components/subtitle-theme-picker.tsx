"use client";

import * as React from "react";
import { toast } from "sonner";
import { CaptionsIcon, Loader2Icon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { StyleJson } from "@/lib/subtitles/themes";

/**
 * Per-project subtitle theme picker. Mounts inside the project detail page
 * and shows ONE <select> filtered to the themes that match the project's
 * subtitle language. Listens to a persisted theme id (settingsJson) and
 * PATCHes the project on change.
 *
 * The picker uses two distinct settingsJson fields on the backend:
 *   - EN project -> `subtitleThemeId`
 *   - AR project -> `subtitleThemeIdAr`
 * Both are independent, so a user can later flip the project's language and
 * the AR/EN choice they made before will still be there.
 */

type ThemeRow = {
  id: string;
  name: string;
  presetKey: string | null;
  styleJson: StyleJson;
  isBuiltin: boolean;
};

type Props = {
  projectId: string;
  language: "en" | "ar";
  /** Currently-selected theme id (the value persisted server-side). */
  selectedThemeId: string | null;
};

/** Live mini-PNG preview via the existing preview route. Re-renders on a
 *  debounced timer when the style changes. Renders nothing if `styleJson`
 *  is missing (e.g. a corrupt theme row). */
function MiniPreview({
  styleJson,
  sample,
  language,
}: {
  styleJson: StyleJson;
  sample: string;
  language: "en" | "ar";
}) {
  const [src, setSrc] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  // Pick a tasteful default sample when the user hasn't set one. Keeps the
  // preview frame legible across the two language tracks.
  const effectiveSample = sample ||
    (language === "ar"
      ? "هذا ما يبدو عليه النص العربي في الفيديو القصير"
      : "THIS IS WHAT YOUR SUBTITLE LOOKS LIKE");

  React.useEffect(() => {
    const mySeq = ++seq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/subtitle-themes/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleJson, sample: effectiveSample }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? `Preview failed (${res.status})`);
        }
        const blob = await res.blob();
        if (mySeq !== seq.current) return;
        setSrc((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      } catch (err) {
        if (mySeq !== seq.current) return;
        setError(err instanceof Error ? err.message : "Preview failed");
        setSrc((old) => {
          if (old) URL.revokeObjectURL(old);
          return null;
        });
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [styleJson, effectiveSample]);

  React.useEffect(() => {
    return () => {
      setSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    };
  }, []);

  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[120px] overflow-hidden rounded-md border border-border bg-black">
      {loading ? (
        <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
          <Loader2Icon className="mr-1 size-3 animate-spin" />
          rendering…
        </div>
      ) : error ? (
        <div className="flex h-full items-center justify-center p-1 text-center text-[10px] text-destructive">
          {error}
        </div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Subtitle preview" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
          preview unavailable
        </div>
      )}
    </div>
  );
}

export function SubtitleThemePicker({ projectId, language, selectedThemeId }: Props) {
  const [themes, setThemes] = React.useState<ThemeRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string>(selectedThemeId ?? "");
  const [saving, setSaving] = React.useState(false);
  const [errored, setErrored] = React.useState<string | null>(null);

  // Load the full theme list once, then filter client-side by script tag. We
  // filter here rather than on the server so the language toggle in the UI
  // (if introduced later) doesn't trigger a re-fetch round-trip.
  React.useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/subtitle-themes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((body: { themes?: ThemeRow[] }) => {
        if (cancelled) return;
        setThemes(body.themes ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrored(err instanceof Error ? err.message : "Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter themes to those matching the project's language. Back-compat: any
  // theme that doesn't carry a `language` tag (user-created themes that
  // predate the field, or any legacy DB row) defaults to English.
  const filtered = React.useMemo(() => {
    const lang = language;
    return themes.filter((t) => {
      const tag = t.styleJson.language ?? "en";
      return tag === lang;
    });
  }, [themes, language]);

  const current = React.useMemo(
    () => filtered.find((t) => t.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  async function persist(nextId: string) {
    setSaving(true);
    try {
      const body =
        language === "ar" ? { subtitleThemeIdAr: nextId } : { subtitleThemeId: nextId };
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || data?.error) {
        throw new Error(data?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Subtitle theme updated", {
        description:
          "New renders will use it. Existing renders keep the burned-in subtitles — re-render the clips to switch.",
      });
    } catch (err) {
      toast.error("Could not change theme", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setSelectedId(next);
    void persist(next);
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <CaptionsIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Subtitle theme</h3>
          <BadgeLang language={language} />
          {saving ? <Loader2Icon className="ml-auto size-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {language === "ar"
            ? "Arabic themes render with RTL Noto Sans Arabic — burned-in pill + highlight, no case mapping."
            : "English themes render with Latin fonts — karaoke highlight snaps to the spoken word."}
          {" "}
          Re-render the clips to switch existing renders to a new theme.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            Loading themes…
          </div>
        ) : errored ? (
          <div className="text-xs text-destructive">{errored}</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No {language === "ar" ? "Arabic" : "English"} themes available. Restart the dev server to seed the
            builtins, or create a custom one on the Subtitle Themes page.
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex-1 space-y-2">
              <select
                value={current?.id ?? ""}
                onChange={onChange}
                disabled={saving}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Subtitle theme"
              >
                {filtered.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isBuiltin ? " (builtin)" : ""}
                  </option>
                ))}
              </select>
              {current ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <div>
                    <dt className="inline">font: </dt>
                    <dd className="inline font-mono text-foreground">{current.styleJson.font}</dd>
                  </div>
                  <div>
                    <dt className="inline">size: </dt>
                    <dd className="inline font-mono text-foreground">{current.styleJson.fontSize}</dd>
                  </div>
                  <div>
                    <dt className="inline">pills: </dt>
                    <dd className="inline font-mono text-foreground">
                      {current.styleJson.wordPillMode ?? "none"}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">anim: </dt>
                    <dd className="inline font-mono text-foreground">
                      {current.styleJson.animationStyle ?? "none"}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
            {current ? (
              <MiniPreview
                styleJson={current.styleJson}
                sample=""
                language={language}
              />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BadgeLang({ language }: { language: "en" | "ar" }) {
  return (
    <span
      className={
        "ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide " +
        (language === "ar"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-sky-500/15 text-sky-600 dark:text-sky-400")
      }
    >
      {language.toUpperCase()}
    </span>
  );
}
