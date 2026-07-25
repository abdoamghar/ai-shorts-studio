import "server-only";

import { jobRunner } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing job id." }, { status: 400 });
  }

  try {
    const job = jobRunner.retry(id);
    return Response.json({ jobId: job.id }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
