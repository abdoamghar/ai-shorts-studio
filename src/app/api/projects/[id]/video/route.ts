import "server-only";
import { eq } from "drizzle-orm";
import { createReadStream, statSync, existsSync } from "node:fs";

import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { assetPath } from "@/lib/storage/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stream the downloaded source video for the project preview player, with
 * HTTP/1.1 Range support so the <video> element can seek. Local-only: this is
 * not a CDN — we just need seeking within the file.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return new Response("Missing project id.", { status: 400 });
  }

  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  const filePath = assetPath(id, "video.mp4");
  if (!existsSync(filePath)) {
    return new Response("Video not available yet (still downloading or failed).", {
      status: 404,
    });
  }

  const stat = statSync(filePath);
  const total = stat.size;
  const rangeHeader = request.headers.get("range");

  // Determine content type by extension (we always write video.mp4).
  const contentType = "video/mp4";

  if (!rangeHeader) {
    // Full file (no range requested).
    const stream = createReadStream(filePath);
    const readable = streamToReadable(stream);
    return new Response(readable, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-cache",
      },
    });
  }

  // Parse "bytes=start-end"
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  const startStr = m?.[1] ?? "";
  const endStr = m?.[2] ?? "";
  let start = startStr ? Number.parseInt(startStr, 10) : 0;
  let end = endStr ? Number.parseInt(endStr, 10) : total - 1;
  if (Number.isNaN(start) || start < 0) start = 0;
  if (Number.isNaN(end) || end >= total) end = total - 1;
  if (start > end) {
    return new Response("Invalid range.", { status: 416 });
  }

  const chunkSize = end - start + 1;
  const stream = createReadStream(filePath, { start, end });
  return new Response(streamToReadable(stream), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-cache",
    },
  });
}

/** Pipe a node ReadableStream into a web ReadableStream<Uint8Array>. */
function streamToReadable(stream: ReturnType<typeof createReadStream>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk) => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(bytes));
      });
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
}
