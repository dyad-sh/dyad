CREATE TABLE `library_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`storage_path` text NOT NULL,
	`storage_tier` text DEFAULT 'local' NOT NULL,
	`cid` text,
	`arweave_id` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]',
	`category` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
