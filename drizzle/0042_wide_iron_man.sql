CREATE TABLE `user_input_follow_up_handoffs` (
	`request_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`owner_session_id` text NOT NULL,
	`chat_id` integer NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_input_follow_up_owner_status_idx` ON `user_input_follow_up_handoffs` (`owner_session_id`,`status`);--> statement-breakpoint
CREATE INDEX `user_input_follow_up_settled_at_idx` ON `user_input_follow_up_handoffs` (`settled_at`);