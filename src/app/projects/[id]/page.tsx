import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { db } from "@/lib/db/client";
import { jobs as jobsTable, projects as projectsTable } from "@/lib/db/schema";
import { readSubtitleLanguage } from "@/lib/subtitles/language";
import {
  ProjectDetail,
  LatestJob,
} from "@/components/project-detail";

export const dynamic = "force-dynamic";

/** Read a trimmed string field from the project settingsJson blob. */
function readStringSetting(settingsJson: string | null, key: string): string | null {
  try {
    const parsed = JSON.parse(settingsJson ?? "{}") as Record<string, unknown>;
    const v = parsed[key];
    return typeof v === "string" && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .get();
  return { title: project?.title ?? "Project" };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id) notFound();

  const project = db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .get();
  if (!project) notFound();

  const latestJobRow = db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.projectId, id))
    .orderBy(desc(jobsTable.createdAt))
    .limit(1)
    .get();

  const projectDetail: ProjectDetail = {
    id: project.id,
    url: project.url,
    videoId: project.videoId,
    title: project.title,
    channel: project.channel,
    thumbnailUrl: project.thumbnailUrl,
    durationSec: project.durationSec,
    status: project.status,
    createdAt: project.createdAt,
    subtitleLanguage: readSubtitleLanguage(project.settingsJson),
    // Surface the currently-selected EN and AR theme IDs so the picker can
    // show the active entry on load without mounting a second GET. Parsed out
    // of settingsJson once here (server component) and threaded into the
    // client component as plain strings.
    subtitleThemeId: readStringSetting(project.settingsJson, "subtitleThemeId"),
    subtitleThemeIdAr: readStringSetting(project.settingsJson, "subtitleThemeIdAr"),
  };

  const latestJob: LatestJob = latestJobRow
    ? {
        id: latestJobRow.id,
        status: latestJobRow.status as NonNullable<LatestJob>["status"],
        progress: latestJobRow.progress,
        step: latestJobRow.step,
        message: latestJobRow.message,
        error: latestJobRow.error,
      }
    : null;

  return <ProjectDetail project={projectDetail} latestJob={latestJob} />;
}
