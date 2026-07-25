CREATE TABLE `clips` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`idx` integer NOT NULL,
	`title` text NOT NULL,
	`hook` text,
	`summary` text,
	`emotion` text,
	`category` text,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`scores_json` text DEFAULT '{}' NOT NULL,
	`virality_score` real,
	`retention_score` real,
	`engagement_score` real,
	`overall_score` real,
	`hashtags_json` text DEFAULT '[]' NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`start_word_idx` integer,
	`end_word_idx` integer,
	`thumbnail_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`ts` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`step` text,
	`message` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`step` text,
	`message` text,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`video_id` text,
	`title` text,
	`channel` text,
	`thumbnail_url` text,
	`views` integer,
	`published_at` text,
	`duration_sec` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`settings_json` text DEFAULT '{}',
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`prompt_text` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_templates_key_unique` ON `prompt_templates` (`key`);--> statement-breakpoint
CREATE TABLE `renders` (
	`id` text PRIMARY KEY NOT NULL,
	`clip_id` text NOT NULL,
	`format` text DEFAULT 'mp4' NOT NULL,
	`resolution` text DEFAULT '1080x1920' NOT NULL,
	`theme_id` text,
	`path` text NOT NULL,
	`size_bytes` integer,
	`duration_ms` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_enc` text NOT NULL,
	`iv` text NOT NULL,
	`tag` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitle_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`preset_key` text,
	`style_json` text DEFAULT '{}' NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcript` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`idx` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`text` text NOT NULL,
	`confidence` real,
	`words_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
