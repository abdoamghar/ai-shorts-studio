import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jobRunner, type JobContext } from "@/lib/jobs/runner";
import { MissingToolError } from "@/lib/binaries";
import { runDownload } from "@/lib/pipeline/download";
import { runAudio } from "@/lib/pipeline/audio";
import { runTranscribe } from "@/lib/pipeline/transcribe";
import { runAnalyze } from "@/lib/pipeline/analyze-clips";
import { runSubtitles } from "@/lib/pipeline/subtitles";
import { runRender } from "@/lib/pipeline/render";

/**
 * The `analyze` job = the whole pipeline for one project:
 * download → audio → transcribe → analyze → subtitles → render.
 *
 * This orchestrator owns the global 0-100 progress bar. Each step module
 * reports its own local 0-100 progress (download %, audio %, segment ratio);
 * we map that onto the step's window so the overall bar moves correctly:
 *
 *     global = start + (local/100) * (end - start)
 *
 * Implemented steps (phase 5/6/7): download, audio, transcribe, analyze (LLM
 * clips), subtitles (SRT+ASS), render (9:16 burn-in). All six steps now run
 * end-to-end; the project's `status` reflects how far it got.
 */

type StepDef = {
  key: string;
  label: string;
  /** Global progress when this step starts. */
  start: number;
  /** Global progress when this step completes. */
  end: number;
  /** Real work; receives a context whose setProgress is local-0-100-mapped. */
  run?: (ctx: JobContext) => Promise<void>;
  /** Project status to set when this step begins, if any. */
  projectStatus?: string;
};

const STEPS: StepDef[] = [
  {
    key: "download",
    label: "Downloading video",
    start: 0,
    end: 18,
    projectStatus: "downloading",
    run: (ctx) => {
      // project row carries the URL; re-read so a retry picks up current value.
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, ctx.projectId))
        .get();
      if (!project?.url) {
        return Promise.reject(new Error(`Project ${ctx.projectId} has no URL to download.`));
      }
      return runDownload(ctx, project.url);
    },
  },
  {
    key: "audio",
    label: "Extracting audio",
    start: 18,
    end: 24,
    projectStatus: "transcribing",
    run: runAudio,
  },
  { key: "transcribe", label: "Transcribing", start: 24, end: 55, run: runTranscribe },
  {
    key: "analyze",
    label: "Analyzing clips",
    start: 55,
    end: 72,
    projectStatus: "analyzing",
    run: runAnalyze,
  },
  { key: "subtitles", label: "Generating subtitles", start: 72, end: 80, run: runSubtitles },
  {
    key: "render",
    label: "Rendering clips",
    start: 80,
    end: 100,
    projectStatus: "rendering",
    run: runRender,
  },
];

/** Wrap a JobContext so its setProgress maps local 0-100 onto the step window. */
function withMappedProgress(ctx: JobContext, start: number, end: number): JobContext {
  const map = (local: number) => {
    const clamped = Math.max(0, Math.min(100, local));
    return Math.round(start + (clamped / 100) * (end - start));
  };
  return {
    ...ctx,
    setProgress: (progress, message) => ctx.setProgress(map(progress), message),
  };
}

function setProjectStatus(projectId: string, status: string): void {
  db.update(projects)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, projectId))
    .run();
}

async function analyzeHandler(ctx: JobContext): Promise<void> {
  ctx.log(`Starting analyze pipeline for project ${ctx.projectId}`);

  const project = db.select().from(projects).where(eq(projects.id, ctx.projectId)).get();
  if (!project) {
    throw new Error(`Project ${ctx.projectId} not found.`);
  }

  for (const step of STEPS) {
    ctx.setStep(step.key, step.label);
    ctx.setProgress(step.start, step.label);
    ctx.log(`Step: ${step.label}`);

    if (step.projectStatus) setProjectStatus(ctx.projectId, step.projectStatus);

    if (step.run) {
      const stepCtx = withMappedProgress(ctx, step.start, step.end);
      try {
        await step.run(stepCtx);
      } catch (err) {
        // A missing external tool is an actionable, recoverable failure —
        // surface it verbatim so the log tells the user how to fix it.
        if (err instanceof MissingToolError) ctx.log((err as Error).message, "error");
        throw err;
      }
    } else {
      ctx.log(`"${step.key}" step not implemented yet (phase-7 stub).`, "warn");
    }

    ctx.setProgress(step.end, `${step.label} complete`);
  }

  // All implemented steps + stubs completed.
  setProjectStatus(ctx.projectId, "done");
  ctx.log("Pipeline complete.");
}

// Register once on module load. The runner overwrites the handler each import,
// which is fine (module is cached per process).
jobRunner.registerJobHandler("analyze", analyzeHandler);

/** Tiny helper for future steps to mint stable child ids. */
export function childId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
