CREATE TABLE `card_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`catalog_id` text,
	`point_value_cents` real,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
