CREATE TABLE `custom_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`github_url` text NOT NULL,
	`image_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `compacted_at` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `compaction_backup_path` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `pending_compaction` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_compaction_summary` integer;