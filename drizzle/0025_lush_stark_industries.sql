ALTER TABLE `chats` ADD `compacted_at` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `compaction_backup_path` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `pending_compaction` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_compaction_summary` integer;