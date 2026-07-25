import { PromptTemplatesManager } from "@/components/prompt-templates-manager";

export const dynamic = "force-dynamic";

export default function PromptTemplatesPage() {
  return (
    <div className="space-y-4">
      <PromptTemplatesManager />
    </div>
  );
}
