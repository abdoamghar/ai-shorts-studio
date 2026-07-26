"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, CheckIcon, SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GeneralSettings } from "@/lib/settings/store";
import type { SubtitleTheme } from "@/lib/db/schema";

export function GeneralSettingsForm({
  initial,
  themes,
}: {
  initial: GeneralSettings;
  themes: SubtitleTheme[];
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  const [whisperModel, setWhisperModel] = React.useState(initial.whisperModel);
  const [maxClips, setMaxClips] = React.useState(initial.maxClips.toString());
  const [defaultSubtitleThemeId, setDefaultSubtitleThemeId] = React.useState(initial.defaultSubtitleThemeId);
  const [defaultFramingStyle, setDefaultFramingStyle] = React.useState(initial.defaultFramingStyle);

  async function onSave() {
    const clipsNum = parseInt(maxClips, 10);
    if (isNaN(clipsNum) || clipsNum < 1 || clipsNum > 20) {
      toast.error("Max Clips must be a number between 1 and 20.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          whisperModel,
          maxClips: clipsNum,
          defaultSubtitleThemeId,
          defaultFramingStyle,
        }),
      });
      const data = (await res.json()) as GeneralSettings & { error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Save failed (${res.status})`);
      }
      setWhisperModel(data.whisperModel);
      setMaxClips(data.maxClips.toString());
      setDefaultSubtitleThemeId(data.defaultSubtitleThemeId);
      setDefaultFramingStyle(data.defaultFramingStyle);
      toast.success("General settings saved successfully.");
      router.refresh();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-2xl border-border/50 bg-card/40 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="size-5 text-primary" />
          General Preferences
        </CardTitle>
        <CardDescription>
          Configure the default behavior for new projects.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Faster-Whisper Model</Label>
            <Select value={whisperModel} onValueChange={(v: string) => setWhisperModel(v as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tiny">tiny (Fastest, least accurate)</SelectItem>
                <SelectItem value="base">base (Fast, good accuracy)</SelectItem>
                <SelectItem value="small">small (Slower, great accuracy)</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="large">large</SelectItem>
                <SelectItem value="large-v3">large-v3</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Controls the AI transcription size used by default. "base" is recommended.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Max Clips (Per Video)</Label>
            <Input
              type="number"
              min="1"
              max="20"
              value={maxClips}
              onChange={(e) => setMaxClips(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              How many viral shorts the LLM should generate per input video.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Default Subtitle Theme</Label>
            <Select value={defaultSubtitleThemeId} onValueChange={(v: string) => setDefaultSubtitleThemeId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a theme" />
              </SelectTrigger>
              <SelectContent>
                {themes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Default Framing Style</Label>
            <Select value={defaultFramingStyle} onValueChange={(v: string) => setDefaultFramingStyle(v as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Select framing style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blur">Blur Background (Gaming/Action)</SelectItem>
                <SelectItem value="crop">Full-Screen Crop (Podcast/Debates)</SelectItem>
                <SelectItem value="auto-crop">Auto-Crop (Face Tracking)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={onSave} disabled={saving}>
            {saving ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <CheckIcon className="mr-2 size-4" />
            )}
            Save Preferences
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
