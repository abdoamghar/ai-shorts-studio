import "server-only";

import { toolingStatus } from "@/lib/binaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ToolingStatus = {
  ytDlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  python: boolean;
  fasterWhisper: boolean;
};

export async function GET() {
  const s = toolingStatus();
  return Response.json({ tools: s });
}
