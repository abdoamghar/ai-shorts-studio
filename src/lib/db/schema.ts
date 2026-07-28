import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// All JSON columns are TEXT in SQLite; the app layer (de)serializes with zod.
// Timestamps use SQLite CURRENT_TIMESTAMP (TEXT, UTC). Durations are millis.

/** A single YouTube source video being processed. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  videoId: text("video_id"),
  title: text("title"),
  channel: text("channel"),
  thumbnailUrl: text("thumbnail_url"),
  views: integer("views"),
  publishedAt: text("published_at"),
  durationSec: real("duration_sec"),
  // pending | downloading | transcribing | analyzing | rendering | done | error
  status: text("status").notNull().default("pending"),
  // JSON: { whisperModel, language, targetClipSec, maxClips, promptTemplateKey, subtitleThemeId, transform }
  settingsJson: text("settings_json").default("{}"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

/** A transcript segment (sentence-level) with its word-level breakdown. */
export const transcript = sqliteTable("transcript", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  text: text("text").notNull(),
  confidence: real("confidence"),
  // JSON array of { text, startMs, endMs, probability }
  wordsJson: text("words_json").notNull().default("[]"),
});

/** A suggested clip the LLM surfaced. */
export const clips = sqliteTable("clips", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  title: text("title").notNull(),
  hook: text("hook"),
  summary: text("summary"),
  emotion: text("emotion"),
  category: text("category"),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  // JSON: { hook, emotion, curiosity, shareability, retention, educational, overall }
  scoresJson: text("scores_json").notNull().default("{}"),
  // Top-level mirror scores for preview cards (match spec naming)
  viralityScore: real("virality_score"),
  retentionScore: real("retention_score"),
  engagementScore: real("engagement_score"),
  overallScore: real("overall_score"),
  hashtagsJson: text("hashtags_json").notNull().default("[]"),
  keywordsJson: text("keywords_json").notNull().default("[]"),
  // Arabic localized fields (separate from English — never overwrite source)
  titleAr: text("title_ar"),
  hookAr: text("hook_ar"),
  summaryAr: text("summary_ar"),
  hashtagsArJson: text("hashtags_ar_json").notNull().default("[]"),
  startWordIdx: integer("start_word_idx"),
  endWordIdx: integer("end_word_idx"),
  thumbnailPath: text("thumbnail_path"),
  // pending | queued | rendering | rendered | failed
  status: text("status").notNull().default("pending"),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

/** A rendered vertical video produced from a clip. */
export const renders = sqliteTable("renders", {
  id: text("id").primaryKey(),
  clipId: text("clip_id")
    .notNull()
    .references(() => clips.id, { onDelete: "cascade" }),
  format: text("format").notNull().default("mp4"),
  resolution: text("resolution").notNull().default("1080x1920"),
  themeId: text("theme_id"),
  path: text("path").notNull(),
  sizeBytes: integer("size_bytes"),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

/** Durable job record so interrupted jobs survive server restart. */
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(),
  // queued | running | succeeded | failed | cancelled
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  step: text("step"),
  // Optional pipeline step to resume from on retry (set by retry() to the
  // failed job's last `step`). NULL = run the whole pipeline from the start.
  restartFromStep: text("restart_from_step"),
  message: text("message"),
  error: text("error"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

/** Per-step logs for a job (piped to UI logs panel). */
export const jobLogs = sqliteTable("job_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  ts: text("ts").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  level: text("level").notNull().default("info"),
  step: text("step"),
  message: text("message").notNull(),
});

/** Encrypted key/value settings store (API keys etc). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueEnc: text("value_enc").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

/** Subtitle theme presets + user clones. styleJson maps to ASS force_style. */
export const subtitleThemes = sqliteTable("subtitle_themes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  presetKey: text("preset_key"),
  // JSON: { font, fontSize, primaryHsl, outlineHsl, outline, shadow, bold,
  //         alignment, marginL, marginV, highlightHsl, animationSpeed,
  //         maxChars, maxLines }
  styleJson: text("style_json").notNull().default("{}"),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

/** LLM prompt templates per content category. */
export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  promptText: text("prompt_text").notNull(),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type TranscriptRow = typeof transcript.$inferSelect;
export type Clip = typeof clips.$inferSelect;
export type NewClip = typeof clips.$inferInsert;
export type RenderRow = typeof renders.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobLog = typeof jobLogs.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type SubtitleTheme = typeof subtitleThemes.$inferSelect;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
