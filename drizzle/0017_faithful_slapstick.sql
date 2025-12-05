ALTER TABLE `messages` ADD `parent_message_id` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `version_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `branch_id` text;