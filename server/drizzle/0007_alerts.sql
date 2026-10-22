CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`link` text,
	`date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_key` ON `alerts` (`key`);--> statement-breakpoint
CREATE INDEX `alerts_created` ON `alerts` (`created_at`);