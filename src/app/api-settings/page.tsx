import { readLlmSettingsForDisplay, EMPTY_LLM_DISPLAY } from "@/lib/settings/store";
import { ApiSettingsForm } from "@/components/api-settings-form";

export const dynamic = "force-dynamic";

export default function ApiSettingsPage() {
  const initial = readLlmSettingsForDisplay() ?? EMPTY_LLM_DISPLAY;
  return <ApiSettingsForm initial={initial} />;
}
