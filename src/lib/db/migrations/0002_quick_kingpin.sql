ALTER TABLE `clips` ADD `title_ar` text;--> statement-breakpoint
ALTER TABLE `clips` ADD `hook_ar` text;--> statement-breakpoint
ALTER TABLE `clips` ADD `summary_ar` text;--> statement-breakpoint
ALTER TABLE `clips` ADD `hashtags_ar_json` text DEFAULT '[]' NOT NULL;