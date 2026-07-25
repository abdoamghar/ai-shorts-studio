import { PagePlaceholder } from "@/components/page-placeholder";

export default function NewProjectPage() {
  return (
    <div className="space-y-4">
      <PagePlaceholder
        title="New Project"
        description="This page will accept a YouTube URL and create a project, then enqueue the analyze job via the job runner. Wired up in the project-creation API phase."
      />
    </div>
  );
}
