CREATE TABLE `suppressed_transactions` (
	`account_id` text NOT NULL,
	`external_id` text NOT NULL,
	`twin_external_id` text NOT NULL,
	`row` text,
	`status` text DEFAULT 'hidden' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`account_id`, `external_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
