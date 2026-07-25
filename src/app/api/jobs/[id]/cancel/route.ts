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
    const before = jobRunner.get(id);
    if (!before) {
      return Response.json({ error: "Job not found." }, { status: 404 });
    }
    if (
      before.status === "succeeded" ||
      before.status === "failed" ||
      before.status === "cancelled"
    ) {
      return Response.json(
        { error: "Job already finished and can't be cancelled." },
        { status: 409 },
      );
    }
    jobRunner.cancel(id);
    return Response.json({ ok: true }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
