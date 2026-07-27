CREATE TABLE `chat_queue_entries` (
	`item_id` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	`chat_id` integer NOT NULL,
	`position` integer NOT NULL,
	`payload_json` text NOT NULL,
	`persistence` text DEFAULT 'durable' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `chat_turn_intents`(`intent_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_queue_entries_intent_id_unique` ON `chat_queue_entries` (`intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_queue_entries_chat_position_unique` ON `chat_queue_entries` (`chat_id`,`position`);--> statement-breakpoint
CREATE INDEX `chat_queue_entries_chat_id_idx` ON `chat_queue_entries` (`chat_id`);--> statement-breakpoint
CREATE TABLE `chat_queue_state` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_turn_intents` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`envelope_json` text NOT NULL,
	`acceptance` text NOT NULL,
	`recovery` text DEFAULT 'not-started' NOT NULL,
	`accepted_message_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_turn_intents_chat_id_idx` ON `chat_turn_intents` (`chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turn_intents_chat_payload_unique` ON `chat_turn_intents` (`chat_id`,`intent_id`,`payload_hash`);--> statement-breakpoint
CREATE TABLE `plan_handoffs` (
	`handoff_id` text PRIMARY KEY NOT NULL,
	`source_chat_id` integer NOT NULL,
	`target_chat_id` integer,
	`app_id` integer NOT NULL,
	`plan_id` text NOT NULL,
	`plan_version` text NOT NULL,
	`plan_json` text NOT NULL,
	`accept_in_new_chat` integer NOT NULL,
	`phase` text NOT NULL,
	`failure` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_handoffs_source_chat_idx` ON `plan_handoffs` (`source_chat_id`);--> statement-breakpoint
CREATE INDEX `plan_handoffs_target_chat_idx` ON `plan_handoffs` (`target_chat_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `chat_turn_intent_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_chat_turn_intent_unique` ON `messages` (`chat_id`,`chat_turn_intent_id`);