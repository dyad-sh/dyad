ALTER TABLE `chats` ADD `execution_backend` text DEFAULT 'dyad' NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `claude_session_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `claude_session_state` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `execution_backend` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `execution_usage` text;