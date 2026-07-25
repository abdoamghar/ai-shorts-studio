"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  SparklesIcon,
  PencilIcon,
  PlusIcon,
  Loader2Icon,
  BookMarkedIcon,
  TagIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
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

/** Matches the `prompt_templates` row shape from the API. */
type Template = {
  id: string;
  key: string;
  name: string;
  category: string;
  promptText: string;
  isBuiltin: boolean;
  updatedAt: string | null;
};

type EditorState = {
  open: boolean;
  mode: "create" | "edit";
  template: Template | null;
  key: string;
  name: string;
  category: string;
  promptText: string;
  saving: boolean;
};

const EMPTY_EDITOR: EditorState = {
  open: false,
  mode: "edit",
  template: null,
  key: "",
  name: "",
  category: "",
  promptText: "",
  saving: false,
};

export function PromptTemplatesManager() {
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editor, setEditor] = React.useState<EditorState>(EMPTY_EDITOR);
  const router = useRouter();

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/prompt-templates", { cache: "no-store" });
      const data = (await res.json()) as { templates?: Template[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Load failed (${res.status})`);
      setTemplates(data.templates ?? []);
    } catch (err) {
      toast.error("Failed to load templates", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  // Load on mount. load() toggles the loading flag synchronously then fetches
  // async; the subsequent setStates run after `await`, not during the effect.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  function openEdit(t: Template) {
    setEditor({
      open: true,
      mode: "edit",
      template: t,
      key: t.key,
      name: t.name,
      category: t.category,
      promptText: t.promptText,
      saving: false,
    });
  }

  function openCreate() {
    setEditor({
      open: true,
      mode: "create",
      template: null,
      key: "",
      name: "",
      category: "general",
      promptText: "",
      saving: false,
    });
  }

  function closeEditor() {
    setEditor((e) => ({ ...e, open: false }));
  }

  async function save() {
    if (editor.mode === "edit" && !editor.template) return;
    const isCreate = editor.mode === "create";
    const key = editor.key.trim();
    const name = editor.name.trim();
    const category = editor.category.trim();
    const promptText = editor.promptText.trim();
    if (!name || !category || !promptText) {
      toast.error("Missing fields", { description: "Name, category, and prompt text are required." });
      return;
    }
    if (isCreate && !/^[a-z0-9-]+$/.test(key)) {
      toast.error("Invalid key", { description: "Use lowercase letters, numbers, or dashes." });
      return;
    }

    setEditor((e) => ({ ...e, saving: true }));
    try {
      const url = isCreate
        ? "/api/prompt-templates"
        : `/api/prompt-templates/${encodeURIComponent(editor.template!.key)}`;
      const body = isCreate
        ? { key, name, category, promptText }
        : { name, category, promptText };
      const res = await fetch(url, {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { template?: Template; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Save failed (${res.status})`);
      toast.success(isCreate ? "Template created" : "Template updated", {
        description: data.template?.name,
      });
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
            Prompt Templates
          </h1>
          <p className="text-sm text-muted-foreground">
            Edit the editorial guidance the LLM uses to find clips. The shape of the JSON output and
            the scoring rubric are appended automatically — keep these templates focused on content
            taste. Seven builtins ship by default.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="size-4" />
          New template
        </Button>
      </div>

      {loading && templates.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No templates yet. Builtins are seeded on server start — restart the dev server or create
            one with “New template”.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 font-heading text-base">
                    <BookMarkedIcon className="size-4 text-muted-foreground" />
                    <span className="truncate">{t.name}</span>
                  </CardTitle>
                  {t.isBuiltin ? (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <TagIcon className="size-3" />
                      builtin
                    </Badge>
                  ) : null}
                </div>
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">key: </dt>
                    <dd className="inline font-mono text-foreground">{t.key}</dd>
                  </div>
                  <div>
                    <dt className="inline">category: </dt>
                    <dd className="inline font-mono text-foreground">{t.category}</dd>
                  </div>
                </dl>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className={cn("line-clamp-4 text-sm text-muted-foreground whitespace-pre-wrap")}>
                  {t.promptText}
                </p>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                    <PencilIcon className="size-3.5" />
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditorDialog
        state={editor}
        setKey={(v) => setEditor((e) => ({ ...e, key: v }))}
        setName={(v) => setEditor((e) => ({ ...e, name: v }))}
        setCategory={(v) => setEditor((e) => ({ ...e, category: v }))}
        setPromptText={(v) => setEditor((e) => ({ ...e, promptText: v }))}
        onClose={closeEditor}
        onSave={save}
      />
    </div>
  );
}

function EditorDialog(props: {
  state: EditorState;
  setKey: (v: string) => void;
  setName: (v: string) => void;
  setCategory: (v: string) => void;
  setPromptText: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { state, setKey, setName, setCategory, setPromptText, onClose, onSave } = props;
  const isCreate = state.mode === "create";
  return (
    <Dialog open={state.open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isCreate ? "New prompt template" : `Edit “${state.template?.name ?? ""}”`}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Define category-specific guidance. The JSON output shape and scoring rubric are added automatically."
              : "Editing this template changes how future clips are selected. Runs already in progress use the template text at their start time."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {isCreate ? (
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-key">Key</Label>
              <Input
                id="tpl-key"
                value={state.key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="my-template"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, dashes. Must be unique.</p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={state.name} onChange={(e) => setName(e.target.value)} placeholder="General Viral" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-category">Category</Label>
              <Input id="tpl-category" value={state.category} onChange={(e) => setCategory(e.target.value)} placeholder="general" />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tpl-prompt">Prompt text</Label>
            <textarea
              id="tpl-prompt"
              value={state.promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={12}
              spellCheck={false}
              className="block w-full rounded-lg border border-input bg-input/30 px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="You are a viral short-form video editor…"
            />
            <p className="text-xs text-muted-foreground">
              The JSON contract and scoring rubric are appended at runtime, so keep this focused on
              editorial taste.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={state.saving}>
            {state.saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {isCreate ? "Create" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
