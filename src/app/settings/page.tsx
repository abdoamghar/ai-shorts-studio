import { PagePlaceholder } from "@/components/page-placeholder";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <PagePlaceholder
        title="Settings"
        description="App-wide preferences: Whisper model (tiny/base/small), clip caps, default subtitle theme, render resolution/quality, and storage paths. Wired up after the core pipeline is stable."
      />
    </div>
  );
}
