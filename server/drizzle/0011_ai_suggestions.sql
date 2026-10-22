CREATE TABLE `ai_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`label` text NOT NULL,
	`suggestion` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_suggestions_subject` ON `ai_suggestions` (`kind`,`subject`);--> statement-breakpoint
CREATE TABLE `security_classes` (
	`security_id` text PRIMARY KEY NOT NULL,
	`mix` text NOT NULL,
	`expense_ratio` real,
	`source` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
