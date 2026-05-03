CREATE TABLE `onchain_publish_bundles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`content_cid` text,
	`metadata_cid` text,
	`metadata_uri` text,
	`token_id` text,
	`listing_id` text,
	`mint_tx_hash` text,
	`list_tx_hash` text,
	`status` text DEFAULT 'started' NOT NULL,
	`blocked_at` text,
	`error_log` text,
	`goldsky_indexed` integer DEFAULT false,
	`dry_run` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
-- NOTE: drizzle-kit also wants to DROP TABLE `publish_bundles` (legacy table from
-- migration 0028, never modeled in the current schema). We intentionally keep that
-- table in place to avoid data loss — nothing in the runtime touches it anymore,
-- and a future migration can clean it up explicitly if/when desired.
--> statement-breakpoint
ALTER TABLE `agents` ADD `dry_run_at` integer;