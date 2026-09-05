CREATE TABLE `claude_code_usage_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` integer,
	`message_id` integer,
	`app_id` integer,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` integer,
	`reported_at` integer,
	`charged_usd` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claude_code_usage_reports_status_idx` ON `claude_code_usage_reports` (`status`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `chats` ADD `execution_backend` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `claude_code_session_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `execution_backend` text;