CREATE TABLE `reviews` (
	`month` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`summary` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
