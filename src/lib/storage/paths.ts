import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";

/** Absolute project root (the shorts-app directory). */
export const PROJECT_ROOT =
  process.env.PROJECT_ROOT ?? process.cwd();

/** Per-project storage dir, e.g. <root>/storage/<projectId>. Created if missing. */
export function projectDir(projectId: string): string {
  const base = process.env.STORAGE_DIR ?? path.join(PROJECT_ROOT, "storage");
  const dir = path.isAbsolute(base) ? base : path.resolve(PROJECT_ROOT, base);
  const p = path.join(dir, projectId);
  mkdirSync(p, { recursive: true });
  return p;
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
