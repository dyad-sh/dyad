CREATE TABLE `app_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_collections_name_unique` ON `app_collections` (`name`);--> statement-breakpoint
ALTER TABLE `apps` ADD `collection_id` integer REFERENCES app_collections(id);