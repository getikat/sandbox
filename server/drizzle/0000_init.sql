CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`official_name` text,
	`nickname` text,
	`mask` text,
	`type` text NOT NULL,
	`subtype` text,
	`group_override` text,
	`owner` text DEFAULT 'me' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`current_cents` integer,
	`available_cents` integer,
	`limit_cents` integer,
	`balance_as_of` text,
	`include_in_net_worth` integer DEFAULT true NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_conn_ext` ON `accounts` (`connection_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`current_cents` integer,
	`available_cents` integer,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_date` ON `balance_snapshots` (`date`);--> statement-breakpoint
CREATE TABLE `category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_key` text,
	`description_contains` text,
	`account_id` text,
	`min_cents` integer,
	`max_cents` integer,
	`category_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text,
	`institution_id` text,
	`institution_name` text NOT NULL,
	`institution_logo` text,
	`institution_color` text,
	`access_token_enc` text,
	`cursor` text,
	`products` text DEFAULT '[]' NOT NULL,
	`missing_consent` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`status_detail` text,
	`last_synced_at` text,
	`last_attempt_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holding_snapshots` (
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`quantity` real NOT NULL,
	`value_cents` integer NOT NULL,
	`cost_basis_cents` integer,
	PRIMARY KEY(`account_id`, `security_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`quantity` real NOT NULL,
	`price_cents` real,
	`value_cents` integer NOT NULL,
	`cost_basis_cents` integer,
	`as_of` text NOT NULL,
	PRIMARY KEY(`account_id`, `security_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `investment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`external_id` text NOT NULL,
	`security_id` text,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`quantity` real DEFAULT 0 NOT NULL,
	`price_cents` real,
	`amount_cents` integer NOT NULL,
	`fees_cents` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `itx_account_ext` ON `investment_transactions` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `itx_date` ON `investment_transactions` (`date`);--> statement-breakpoint
CREATE INDEX `itx_security` ON `investment_transactions` (`security_id`);--> statement-breakpoint
CREATE TABLE `liabilities` (
	`account_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`apr_percent` real,
	`aprs` text,
	`last_statement_balance_cents` integer,
	`last_statement_date` text,
	`minimum_payment_cents` integer,
	`next_payment_due_date` text,
	`last_payment_cents` integer,
	`last_payment_date` text,
	`is_overdue` integer,
	`origination_date` text,
	`origination_principal_cents` integer,
	`term_months` integer,
	`maturity_date` text,
	`payment_cents` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `prices` (
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`close_cents` real NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`security_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text,
	`ticker` text,
	`name` text NOT NULL,
	`type` text,
	`cusip` text,
	`isin` text,
	`is_cash_equivalent` integer DEFAULT false NOT NULL,
	`close_price` real,
	`close_price_as_of` text,
	`sector` text,
	`industry` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_ext` ON `securities` (`external_id`);--> statement-breakpoint
CREATE INDEX `securities_ticker` ON `securities` (`ticker`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`modified` integer DEFAULT 0 NOT NULL,
	`removed` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`external_id` text NOT NULL,
	`pending_external_id` text,
	`date` text NOT NULL,
	`authorized_date` text,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`description` text NOT NULL,
	`merchant_name` text,
	`merchant_key` text NOT NULL,
	`logo_url` text,
	`website` text,
	`mcc` text,
	`provider_category` text,
	`provider_category_detailed` text,
	`payment_channel` text,
	`category_id` text NOT NULL,
	`category_source` text DEFAULT 'provider' NOT NULL,
	`pending` integer DEFAULT false NOT NULL,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`transfer_pair_id` text,
	`excluded` integer DEFAULT false NOT NULL,
	`running_balance_cents` integer,
	`location` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tx_account_ext` ON `transactions` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `tx_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `tx_account_date` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `tx_merchant` ON `transactions` (`merchant_key`);--> statement-breakpoint
CREATE INDEX `tx_category` ON `transactions` (`category_id`);