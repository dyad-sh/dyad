CREATE TABLE `agent_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`message_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_messages_thread_sequence_unique` ON `agent_messages` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_messages_thread_message_unique` ON `agent_messages` (`thread_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `agent_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`persona` text NOT NULL,
	`task_name` text NOT NULL,
	`assignment` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text NOT NULL,
	`context_json` text,
	`result_json` text,
	`review_base_commit` text,
	`review_target_commit` text,
	`review_diff_hash` text,
	`invocation_source` text NOT NULL,
	`remediation_source` text,
	`auto_fix_at` integer,
	`error` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_threads_chat_id_idx` ON `agent_threads` (`chat_id`);