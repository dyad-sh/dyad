CREATE TABLE `workflow_listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workflow_id` text NOT NULL,
	`name` text NOT NULL,
	`marketplace_id` text,
	`publish_status` text DEFAULT 'local',
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_listings_workflow_id_unique` ON `workflow_listings` (`workflow_id`);--> statement-breakpoint
ALTER TABLE `agents` ADD `publish_status` text DEFAULT 'local';--> statement-breakpoint
ALTER TABLE `agents` ADD `marketplace_id` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `agents` ADD `publish_price` integer;--> statement-breakpoint
ALTER TABLE `agents` ADD `publish_currency` text DEFAULT 'USD';