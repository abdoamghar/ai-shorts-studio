"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  KeyRoundIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
  Loader2Icon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  PROVIDER_PRESETS,
  type ProviderId,
  type ProviderPreset,
} from "@/lib/llm/providers";
import type { LlmSettingsDisplay } from "@/lib/settings/store";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; modelCount?: number; modelAvailable?: boolean; modelChecked?: string | null }
  | { status: "error"; message: string };

export function ApiSettingsForm({
  initial,
}: {
  initial: LlmSettingsDisplay;
}) {
  const router = useRouter();
  const [providerId, setProviderId] = React.useState<ProviderId>(initial.providerId);
  const [baseUrl, setBaseUrl] = React.useState(initial.baseUrl);
  const [model, setModel] = React.useState(initial.model);
  const [apiKey, setApiKey] = React.useState("");
  const [apiKeySet, setApiKeySet] = React.useState(initial.apiKeySet);
  const apiKeyMask = initial.apiKeyMask;
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [test, setTest] = React.useState<TestState>({ status: "idle" });

  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId)!;

  function selectProvider(id: ProviderId) {
    const p: ProviderPreset = PROVIDER_PRESETS.find((x) => x.id === id)!;
    setProviderId(id);
    // Apply the preset's baseUrl/model only when the current fields are empty
    // or still equal to the previous preset — don't clobber user edits.
    setBaseUrl((cur) =>
      cur === "" || cur === preset.baseUrl ? p.baseUrl : cur,
    );
    setModel((cur) =>
      cur === "" || cur === preset.defaultModel ? p.defaultModel : cur,
    );
    setTest({ status: "idle" });
  }

  async function onSave() {
    setSaving(true);
    setTest({ status: "idle" });
    try {
      const res = await fetch("/api/settings/llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, baseUrl, model, apiKey }),
      });
      const data = (await res.json()) as LlmSettingsDisplay & { error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Save failed (${res.status})`);
      }
      setProviderId(data.providerId);
      setBaseUrl(data.baseUrl);
      setModel(data.model);
      setApiKey("");
      setApiKeySet(data.apiKeySet);
      toast.success("Settings saved", { description: "Your provider config is encrypted at rest." });
      router.refresh();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, baseUrl, model, apiKey }),
      });
      const data = await res.json();
      if (data.ok) {
        setTest({
          status: "ok",
          modelCount: data.modelCount,
          modelAvailable: data.modelAvailable,
          modelChecked: data.modelChecked,
        });
      } else {
        setTest({ status: "error", message: data.error ?? "Unknown error" });
      }
    } catch (err) {
      setTest({
        status: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5 text-primary" />
            LLM Provider
          </CardTitle>
          <CardDescription>
            AI Shorts Studio uses a single OpenAI-compatible client. Configure
            your provider once and it&rsquo;s used for transcript analysis and
            clip scoring. Keys are encrypted (AES-256-GCM) and never shown in
            plaintext after save.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Provider */}
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <select
              id="provider"
              value={providerId}
              onChange={(e) => selectProvider(e.target.value as ProviderId)}
              className="h-8 w-full rounded-lg border border-input bg-input/30 px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{preset.hint}</p>
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              inputMode="url"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              The OpenAI-compatible base URL. <code className="text-foreground">/chat/completions</code> and{" "}
              <code className="text-foreground">/models</code> are appended automatically.
            </p>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={preset.defaultModel || "model-id"}
              autoComplete="off"
            />
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <div className="relative">
              <Input
                id="apiKey"
                // type is toggled; when no new key typed, show the mask as a placeholder.
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={apiKeySet ? apiKeyMask : "sk-… (stored encrypted)"}
                autoComplete="off"
                spellCheck={false}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide key" : "Show key"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              {apiKeySet ? (
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheckIcon className="size-3.5" />
                  Key stored · {apiKeyMask}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Leave blank to keep the stored key; enter a new key to replace it.
                </span>
              )}
              {preset.keyUrl && (
                <a
                  href={preset.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Get a key
                  <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Save settings
            </Button>
            <Button variant="outline" onClick={onTest} disabled={test.status === "testing"}>
              {test.status === "testing" ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : null}
              Test connection
            </Button>
            <TestBadge state={test} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TestBadge({ state }: { state: TestState }) {
  if (state.status === "idle") return null;
  if (state.status === "testing") {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2Icon className="size-3.5 animate-spin" />
        Testing…
      </Badge>
    );
  }
  if (state.status === "ok") {
    const modelNote =
      state.modelAvailable === false
        ? "The configured model wasn't listed by the provider."
        : "Model available.";
    return (
      <Badge
        variant="secondary"
        className={cn(
          "gap-1",
          state.modelAvailable === false && "bg-amber-500/15 text-amber-500",
        )}
        title={modelNote}
      >
        <CircleCheckIcon className="size-3.5" />
        Connected · {state.modelCount ?? 0} models
        {state.modelAvailable === false && ` · model mismatch`}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1 max-w-md" title={state.message}>
      <TriangleAlertIcon className="size-3.5 shrink-0" />
      <span className="truncate">{state.message}</span>
    </Badge>
  );
}
