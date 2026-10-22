CREATE TABLE `ai_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`question` text NOT NULL,
	`model` text NOT NULL,
	`system` text NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`messages` text NOT NULL,
	`answer` text,
	`usage` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_log_created` ON `ai_log` (`created_at`);