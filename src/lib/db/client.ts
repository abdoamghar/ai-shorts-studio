import "server-only";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import * as schema from "./schema";

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? "./storage/shorts.db";
  // Resolve relative to project root (the shorts-app dir), not process.cwd(),
  // which can shift under Next.js workers.
  const root = process.env.PROJECT_ROOT ?? process.cwd();
  const abs = path.isAbsolute(url) ? url : path.resolve(root, url);
  mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

// Next dev runs each route in fresh module instances; better-sqlite3 is
// synchronous so creating a single connection per process is fine, but we
// must avoid opening twice in the same process. Cache on globalThis.
const globalForDb = globalThis as typeof globalThis & {
  __shortsSqlite?: Database.Database;
  __shortsDrizzle?: BetterSQLite3Database<typeof schema>;
};

function getRaw(): Database.Database {
  if (globalForDb.__shortsSqlite) return globalForDb.__shortsSqlite;
  const dbPath = resolveDbPath();
  const raw = new Database(dbPath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  globalForDb.__shortsSqlite = raw;
  return raw;
}

export const rawDb = getRaw();
export const db: BetterSQLite3Database<typeof schema> =
  globalForDb.__shortsDrizzle ?? drizzle(rawDb, { schema });

if (!globalForDb.__shortsDrizzle) globalForDb.__shortsDrizzle = db;

/**
 * Apply the schema idempotently without a migration runner. Used in dev so a
 * fresh checkout just works; in production you'd run drizzle-kit migrate.
 *
 * `CREATE TABLE IF NOT EXISTS` does not add columns to an existing table, so
 * additive schema changes also run a guarded `ALTER TABLE` here for DBs that
 * were created before the column existed.
 */
export function applySchema(): void {
  rawDb.exec(SCHEMA_SQL);
  ensureColumn("jobs", "restart_from_step", "TEXT");
}

/**
 * Add a column to an existing table if absent. SQLite has no `ADD COLUMN IF
 * NOT EXISTS`, so we probe `PRAGMA table_info` and silence the "duplicate
 * column" error by never issuing the statement when the column already exists.
 */
function ensureColumn(table: string, column: string, typeDecl: string): void {
  const cols = rawDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  rawDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDecl};`);
}

// Raw DDL kept in sync with src/lib/db/schema.ts. Drizzle's own migrations are
// the source of truth for production; this is the dev fast-path.
const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  video_id TEXT,
  title TEXT,
  channel TEXT,
  thumbnail_url TEXT,
  views INTEGER,
  published_at TEXT,
  duration_sec REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  settings_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS transcript (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  confidence REAL,
  words_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_transcript_project ON transcript(project_id, idx);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  hook TEXT,
  summary TEXT,
  emotion TEXT,
  category TEXT,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  scores_json TEXT NOT NULL DEFAULT '{}',
  virality_score REAL,
  retention_score REAL,
  engagement_score REAL,
  overall_score REAL,
  hashtags_json TEXT NOT NULL DEFAULT '[]',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  start_word_idx INTEGER,
  end_word_idx INTEGER,
  thumbnail_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  favorite INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_clips_project ON clips(project_id, idx);
CREATE INDEX IF NOT EXISTS idx_clips_overall ON clips(project_id, overall_score DESC);

CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'mp4',
  resolution TEXT NOT NULL DEFAULT '1080x1920',
  theme_id TEXT,
  path TEXT NOT NULL,
  size_bytes INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  step TEXT,
  restart_from_step TEXT,
  message TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ts TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  level TEXT NOT NULL DEFAULT 'info',
  step TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_joblogs_job ON job_logs(job_id, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS subtitle_themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  preset_key TEXT,
  style_json TEXT NOT NULL DEFAULT '{}',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
`;
