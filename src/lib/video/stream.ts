import "server-only";
import { createReadStream, existsSync, statSync } from "node:fs";

/**
 * Build a web Response that streams a file from disk, optionally as a download
 * (attachment) with a sanitized filename. Supports HTTP Range so a <video>
 * element can seek MP4s. Used by the per-clip export (mp4/srt/ass/json) routes
 * and the renders route.
 */
export function fileResponse(
  filePath: string,
  opts: {
    contentType: string;
    /** Suggested download filename; when set, sends Content-Disposition: attachment. */
    downloadName?: string;
    request?: Request;
  },
): Response {
  if (!existsSync(filePath)) {
    return Response.json({ error: "File not available." }, { status: 404 });
  }

  const stat = statSync(filePath);
  const total = stat.size;
  const rangeHeader = opts.request?.headers.get("range");

  const headers: Record<string, string> = {
    "Content-Type": opts.contentType,
    "Content-Length": String(total),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (opts.downloadName) {
    headers["Content-Disposition"] = `attachment; filename="${opts.downloadName.replace(/"/g, "_")}"`;
  }

  if (!rangeHeader) {
    const readable = streamToReadable(createReadStream(filePath));
    return new Response(readable, { headers });
  }

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
  return new Response(streamToReadable(createReadStream(filePath, { start, end })), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${total}`,
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
