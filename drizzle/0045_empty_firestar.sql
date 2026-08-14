CREATE TABLE `chat_queue_entries` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `chat_turn_intents`(`intent_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_queue_states` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_turn_intents` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`intent` text,
	`acceptance` text DEFAULT 'queued' NOT NULL,
	`recovery` text DEFAULT 'not-started' NOT NULL,
	`accepted_message_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_turn_intents_chat_idx` ON `chat_turn_intents` (`chat_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `chat_turn_intent_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_chat_turn_intent_unique` ON `messages` (`chat_id`,`chat_turn_intent_id`);