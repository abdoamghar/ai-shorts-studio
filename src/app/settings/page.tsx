import { db } from "@/lib/db/client";
import { subtitleThemes } from "@/lib/db/schema";
import { readGeneralSettings } from "@/lib/settings/store";
import { GeneralSettingsForm } from "@/components/general-settings-form";

export default function SettingsPage() {
  const generalSettings = readGeneralSettings();
  const themes = db.select().from(subtitleThemes).all();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your app-wide preferences.
        </p>
      </div>

      <GeneralSettingsForm initial={generalSettings} themes={themes} />
    </div>
  );
}
