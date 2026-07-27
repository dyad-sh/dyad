ALTER TABLE `chats` ADD `plan_handoff_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `chats_plan_handoff_id_unique` ON `chats` (`plan_handoff_id`);