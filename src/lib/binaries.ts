import "server-only";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Resolve the path to an external binary, preferring an explicit env override,
 * then PATH. Throws a friendly error if missing (the setup script installs
 * these; a missing tool should fail the job with a message the user can act
 * on, not a cryptic ENOENT from spawn).
 */

const IS_WIN = process.platform === "win32";

function resolveFromEnvOrPath(envVar: string, name: string): string | null {
  const override = process.env[envVar];
  if (override && existsSync(override)) return override;

  // execFileSync with the bare name resolves via PATH on all platforms.
  try {
    const where = IS_WIN ? "where" : "which";
    const out = execFileSync(where, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

export class MissingToolError extends Error {
  constructor(tool: string, hint: string) {
    super(`${tool} was not found. ${hint}`);
    this.name = "MissingToolError";
  }
}

export function resolveYtDlp(): string {
  const p = resolveFromEnvOrPath("YT_DLP_PATH", "yt-dlp");
  if (!p) {
    throw new MissingToolError(
      "yt-dlp",
      "Run `npm run setup` (installs via winget) or set YT_DLP_PATH in .env.",
    );
  }
  return p;
}

export function resolveFfmpeg(): string {
  const p = resolveFromEnvOrPath("FFMPEG_PATH", "ffmpeg");
  if (!p) {
    throw new MissingToolError(
      "ffmpeg",
      "Run `npm run setup` (installs Gyan.FFmpeg via winget) or set FFMPEG_PATH in .env.",
    );
  }
  return p;
}

export function resolveFfprobe(): string {
  // ffprobe ships with the Gyan.FFmpeg package; live next to ffmpeg.
  const explicit = process.env.FFPROBE_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const ffmpeg = resolveFromEnvOrPath("FFMPEG_PATH", "ffmpeg");
  if (ffmpeg) {
    const cand = path.join(path.dirname(ffmpeg), IS_WIN ? "ffprobe.exe" : "ffprobe");
    if (existsSync(cand)) return cand;
  }
  try {
    const out = execFileSync(IS_WIN ? "where" : "which", ["ffprobe"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  } catch {
    /* fall through to error */
  }
  throw new MissingToolError(
    "ffprobe",
    "ffprobe is part of the ffmpeg package. Run `npm run setup` or set FFPROBE_PATH in .env.",
  );
}

/** Resolve the python executable used to run faster-whisper. */
export function resolvePython(): string {
  const explicit = process.env.PYTHON_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  for (const name of ["python", "python3"]) {
    try {
      const out = execFileSync(IS_WIN ? "where" : "which", [name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first && existsSync(first)) return first;
    } catch {
      /* try next */
    }
  }
  throw new MissingToolError(
    "python",
    "Install Python 3.10+ from https://www.python.org/ and ensure it's on PATH.",
  );
}

/** Quick non-fatal presence report for boot banner / UI. */
export function toolingStatus(): {
  ytDlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  python: boolean;
  fasterWhisper: boolean;
} {
  let ytDlp = false,
    ffmpeg = false,
    ffprobe = false,
    python = false,
    fasterWhisper = false;
  try {
    resolveYtDlp();
    ytDlp = true;
  } catch {
    /* ignore */
  }
  try {
    resolveFfmpeg();
    ffmpeg = true;
  } catch {
    /* ignore */
  }
  try {
    resolveFfprobe();
    ffprobe = true;
  } catch {
    /* ignore */
  }
  try {
    resolvePython();
    python = true;
    // probe faster-whisper import; import prints nothing on success.
    const py = resolvePython();
    try {
      execFileSync(py, ["-c", "import faster_whisper"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 8000,
      });
      fasterWhisper = true;
    } catch {
      fasterWhisper = false;
    }
  } catch {
    /* ignore */
  }
  return { ytDlp, ffmpeg, ffprobe, python, fasterWhisper };
}
