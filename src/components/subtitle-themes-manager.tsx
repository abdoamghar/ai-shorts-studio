"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  SparklesIcon,
  PencilIcon,
  PlusIcon,
  Loader2Icon,
  CopyIcon,
  EyeIcon,
  TypeIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StyleJson } from "@/lib/subtitles/themes";

type ThemeRow = {
  id: string;
  name: string;
  presetKey: string | null;
  styleJson: StyleJson;
  isBuiltin: boolean;
  createdAt: string;
};

type EditorState = {
  open: boolean;
  mode: "create" | "edit";
  theme: ThemeRow | null;
  name: string;
  styleJson: StyleJson;
  sample: string;
  saving: boolean;
};

const DEFAULT_STYLE: StyleJson = {
  font: "Inter",
  fontSize: 82,
  primaryHsl: [0, 0, 1],
  outlineHsl: [0, 0, 0],
  outline: 10,
  shadow: 0,
  bold: 1,
  alignment: 8,
  marginL: 80,
  marginV: 120,
  highlightHsl: [42, 1, 0.55],
  animationSpeed: 1,
  maxChars: 22,
  maxLines: 2,
};

const EMPTY_EDITOR: EditorState = {
  open: false,
  mode: "edit",
  theme: null,
  name: "",
  styleJson: DEFAULT_STYLE,
  sample: "This is what your subtitle looks like",
  saving: false,
};

function emptyEditor(): EditorState {
  return { ...EMPTY_EDITOR, styleJson: { ...DEFAULT_STYLE, primaryHsl: [...DEFAULT_STYLE.primaryHsl] as [number, number, number], outlineHsl: [...DEFAULT_STYLE.outlineHsl] as [number, number, number], highlightHsl: [...DEFAULT_STYLE.highlightHsl] as [number, number, number] } };
}

export function SubtitleThemesManager() {
  const [themes, setThemes] = React.useState<ThemeRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editor, setEditor] = React.useState<EditorState>(emptyEditor());
  const router = useRouter();

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/subtitle-themes", { cache: "no-store" });
      const data = (await res.json()) as { themes?: ThemeRow[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Load failed (${res.status})`);
      setThemes(data.themes ?? []);
    } catch (err) {
      toast.error("Failed to load themes", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/subtitle-themes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((body: { themes?: ThemeRow[] }) => {
        if (!cancelled) setThemes(body.themes ?? []);
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

  function openEdit(t: ThemeRow) {
    setEditor({
      open: true,
      mode: "edit",
      theme: t,
      name: t.name,
      styleJson: cloneStyle(t.styleJson),
      sample: "This is what your subtitle looks like",
      saving: false,
    });
  }

  function openClone(t: ThemeRow) {
    setEditor({
      open: true,
      mode: "create",
      theme: null,
      name: `${t.name} (copy)`,
      styleJson: cloneStyle(t.styleJson),
      sample: "This is what your subtitle looks like",
      saving: false,
    });
  }

  function openCreate() {
    setEditor(emptyEditor());
  }

  function closeEditor() {
    setEditor((e) => ({ ...e, open: false }));
  }

  async function save() {
    const isCreate = editor.mode === "create";
    const name = editor.name.trim();
    if (!name) {
      toast.error("Missing name", { description: "Theme name is required." });
      return;
    }
    setEditor((e) => ({ ...e, saving: true }));
    try {
      const url = isCreate ? "/api/subtitle-themes" : `/api/subtitle-themes/${encodeURIComponent(editor.theme!.id)}`;
      const body = isCreate ? { name, styleJson: editor.styleJson } : { name, styleJson: editor.styleJson };
      const res = await fetch(url, {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { theme?: ThemeRow; ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Save failed (${res.status})`);
      toast.success(isCreate ? "Theme created" : "Theme updated", { description: name });
      closeEditor();
      void load();
      router.refresh();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setEditor((e) => ({ ...e, saving: false }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
            <SparklesIcon className="size-6 text-primary" />
            Subtitle Themes
          </h1>
          <p className="text-sm text-muted-foreground">
            Tune and preview burned-in subtitle styles. Builtin themes are read-only — clone one to
            edit freely, or create a new custom theme. The preview renders a real sample frame via
            ffmpeg + libass, so what you see is what the clips get.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="size-4" />
          New theme
        </Button>
      </div>

      {loading && themes.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Loading themes…
        </div>
      ) : themes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No themes yet. Builtins are seeded on server start — restart the dev server or create one
            with “New theme”.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {themes.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 font-heading text-base">
                    <TypeIcon className="size-4 text-muted-foreground" />
                    <span className="truncate">{t.name}</span>
                  </CardTitle>
                  {t.isBuiltin ? (
                    <Badge variant="secondary" className="shrink-0">
                      builtin
                    </Badge>
                  ) : null}
                </div>
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">font: </dt>
                    <dd className="inline font-mono text-foreground">{t.styleJson.font}</dd>
                  </div>
                  <div>
                    <dt className="inline">size: </dt>
                    <dd className="inline font-mono text-foreground">{t.styleJson.fontSize}</dd>
                  </div>
                </dl>
              </CardHeader>
              <CardContent className="space-y-3">
                <ThemePreview styleJson={t.styleJson} disabled />
                <div className="flex justify-end gap-2">
                  {t.isBuiltin ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                        <EyeIcon className="size-3.5" />
                        Preview
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openClone(t)}>
                        <CopyIcon className="size-3.5" />
                        Clone
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                      <PencilIcon className="size-3.5" />
                      Edit
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditorDialog
        state={editor}
        setName={(v) => setEditor((e) => ({ ...e, name: v }))}
        setStyle={(patch) => setEditor((e) => ({ ...e, styleJson: { ...e.styleJson, ...patch } }))}
        setSample={(v) => setEditor((e) => ({ ...e, sample: v }))}
        onClose={closeEditor}
        onSave={save}
      />
    </div>
  );
}

function cloneStyle(s: StyleJson): StyleJson {
  return {
    ...s,
    primaryHsl: [...s.primaryHsl] as [number, number, number],
    outlineHsl: [...s.outlineHsl] as [number, number, number],
    highlightHsl: [...s.highlightHsl] as [number, number, number],
  };
}

/** Debounced PNG preview fetched from the preview route. Renders an <img>. */
function ThemePreview(props: { styleJson: StyleJson; sample?: string; disabled?: boolean }) {
  const { styleJson, sample = "This is what your subtitle looks like", disabled } = props;
  const [src, setSrc] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  React.useEffect(() => {
    if (disabled) return;
    const mySeq = ++seq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/subtitle-themes/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleJson, sample }),
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
    }, 400);
    return () => window.clearTimeout(handle);
  }, [styleJson, sample, disabled]);

  // Revoke object URL on unmount.
  React.useEffect(() => {
    return () => {
      setSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-black">
      <div className="aspect-[9/16] w-full">
        {disabled ? (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
            Click “Preview” to render
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Loader2Icon className="mr-2 size-4 animate-spin" />
            Rendering preview…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-destructive">
            {error}
          </div>
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Subtitle preview" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Preview unavailable
          </div>
        )}
      </div>
    </div>
  );
}

function EditorDialog(props: {
  state: EditorState;
  setName: (v: string) => void;
  setStyle: (patch: Partial<StyleJson>) => void;
  setSample: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { state, setName, setStyle, setSample, onClose, onSave } = props;
  const isCreate = state.mode === "create";
  const s = state.styleJson;
  return (
    <Dialog open={state.open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {isCreate ? "New subtitle theme" : `Edit “${state.theme?.name ?? ""}”`}
          </DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Create a custom theme. The preview renders a sample frame via ffmpeg + libass."
              : state.theme?.isBuiltin
                ? "This is a builtin theme — preview is read-only. Clone it to edit freely."
                : "Editing this theme updates future renders. Clips already rendered keep their burned-in subtitles."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="th-name">Name</Label>
              <Input id="th-name" value={state.name} onChange={(e) => setName(e.target.value)} placeholder="My theme" />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="th-sample">Preview text</Label>
              <Input id="th-sample" value={state.sample} onChange={(e) => setSample(e.target.value)} placeholder="Sample subtitle line" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="th-font">Font family</Label>
                <Input id="th-font" value={s.font} onChange={(e) => setStyle({ font: e.target.value })} placeholder="Inter" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="th-size">Font size</Label>
                <Input id="th-size" type="number" min={20} max={200} value={s.fontSize} onChange={(e) => setStyle({ fontSize: Number(e.target.value) })} />
              </div>
            </div>

            <HslField label="Primary color (HSL)" value={s.primaryHsl} onChange={(v) => setStyle({ primaryHsl: v })} />
            <HslField label="Outline color (HSL)" value={s.outlineHsl} onChange={(v) => setStyle({ outlineHsl: v })} />
            <HslField label="Highlight color (HSL)" value={s.highlightHsl} onChange={(v) => setStyle({ highlightHsl: v })} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="th-outline">Outline thickness</Label>
                <Input id="th-outline" type="number" min={0} max={40} value={s.outline} onChange={(e) => setStyle({ outline: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="th-shadow">Shadow depth</Label>
                <Input id="th-shadow" type="number" min={0} max={40} value={s.shadow} onChange={(e) => setStyle({ shadow: Number(e.target.value) })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="th-bold">Bold</Label>
                <Input id="th-bold" type="number" min={-1} max={1} value={s.bold} onChange={(e) => setStyle({ bold: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="th-align">Alignment (1-9)</Label>
                <Input id="th-align" type="number" min={1} max={9} value={s.alignment} onChange={(e) => setStyle({ alignment: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="th-speed">Animation speed</Label>
                <Input id="th-speed" type="number" min={0.1} max={4} step={0.1} value={s.animationSpeed} onChange={(e) => setStyle({ animationSpeed: Number(e.target.value) })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="th-ml">Margin L</Label>
                <Input id="th-ml" type="number" min={0} max={400} value={s.marginL} onChange={(e) => setStyle({ marginL: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="th-mv">Margin V</Label>
                <Input id="th-mv" type="number" min={0} max={960} value={s.marginV} onChange={(e) => setStyle({ marginV: Number(e.target.value) })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="th-mc">Max chars/line</Label>
                <Input id="th-mc" type="number" min={8} max={80} value={s.maxChars} onChange={(e) => setStyle({ maxChars: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="th-mn">Max lines</Label>
                <Input id="th-mn" type="number" min={1} max={5} value={s.maxLines} onChange={(e) => setStyle({ maxLines: Number(e.target.value) })} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Live preview</Label>
            <ThemePreview styleJson={s} sample={state.sample} />
            <p className="text-xs text-muted-foreground">
              Rendered at 1080×1920 with the sample line, karaoke highlight on the active word.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          {state.theme?.isBuiltin && !isCreate ? null : (
            <Button onClick={onSave} disabled={state.saving}>
              {state.saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              {isCreate ? "Create" : "Save changes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HslField(props: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
}) {
  const { label, value, onChange } = props;
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Hue</span>
          <Input
            type="number"
            min={0}
            max={360}
            value={value[0]}
            onChange={(e) => onChange([Number(e.target.value), value[1], value[2]])}
          />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Sat</span>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value[1]}
            onChange={(e) => onChange([value[0], Number(e.target.value), value[2]])}
          />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Light</span>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value[2]}
            onChange={(e) => onChange([value[0], value[1], Number(e.target.value)])}
          />
        </div>
      </div>
    </div>
  );
}
