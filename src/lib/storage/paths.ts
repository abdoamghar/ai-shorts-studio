import "server-only";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";

/** Absolute project root (the shorts-app directory). */
export const PROJECT_ROOT =
  process.env.PROJECT_ROOT ?? process.cwd();

/** Base storage dir (resolved once). projectDir reuses this to avoid
 *  recreating the root on every call. */
function storageBase(): string {
  const base = process.env.STORAGE_DIR ?? path.join(PROJECT_ROOT, "storage");
  return path.isAbsolute(base) ? base : path.resolve(PROJECT_ROOT, base);
}

/** Per-project storage dir, e.g. <root>/storage/<projectId>. Created if missing. */
export function projectDir(projectId: string): string {
  const p = path.join(storageBase(), projectId);
  mkdirSync(p, { recursive: true });
  return p;
}

/** Recursively delete a project's storage folder (video, audio, subs, renders).
 *  No-op if the folder is absent. Refuses to delete the storage root itself or
 *  any path that escapes it (guards against a malformed/empty projectId). */
export function removeProjectDir(projectId: string): void {
  if (!projectId) return;
  const base = storageBase();
  const target = path.join(base, projectId);
  const rel = path.relative(base, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
  rmSync(target, { recursive: true, force: true });
}

export function rendersDir(projectId: string): string {
  const p = path.join(projectDir(projectId), "renders");
  mkdirSync(p, { recursive: true });
  return p;
}

export function subtitlesDir(projectId: string): string {
  const p = path.join(projectDir(projectId), "subs");
  mkdirSync(p, { recursive: true });
  return p;
}

export function assetPath(projectId: string, file: string): string {
  return path.join(projectDir(projectId), file);
}
