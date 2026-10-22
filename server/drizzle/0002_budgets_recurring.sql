CREATE TABLE `budgets` (
	`category_id` text PRIMARY KEY NOT NULL,
	`amount_cents` integer NOT NULL,
	`rollover` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_overrides` (
	`merchant_key` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
