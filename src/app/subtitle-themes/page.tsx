import { SubtitleThemesManager } from "@/components/subtitle-themes-manager";

export const dynamic = "force-dynamic";

export default function SubtitleThemesPage() {
  return (
    <div className="space-y-4">
      <SubtitleThemesManager />
    </div>
  );
}
