CREATE TABLE `agent_collab_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`topic` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_by_agent_id` integer,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_collab_channels_name_unique` ON `agent_collab_channels` (`name`);--> statement-breakpoint
CREATE TABLE `agent_collab_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer,
	`from_agent_id` integer,
	`to_agent_id` integer,
	`kind` text DEFAULT 'chat' NOT NULL,
	`content` text NOT NULL,
	`metadata_json` text,
	`reply_to_id` integer,
	`task_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `agent_collab_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `agent_collab_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	`muted` integer DEFAULT 0 NOT NULL,
	`joined_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `agent_collab_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_collab_subscriptions_agent_id_channel_id_unique` ON `agent_collab_subscriptions` (`agent_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `agent_collab_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_agent_id` integer NOT NULL,
	`to_agent_id` integer NOT NULL,
	`channel_id` integer,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`input_json` text,
	`output_json` text,
	`due_at` integer,
	`accepted_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`from_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `agent_collab_channels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `playground_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'New Conversation' NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`system_prompt` text,
	`record_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playground_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`record_id` text,
	`cid` text,
	`marketplace_asset_id` text,
	`price_wei` text,
	`monetize_title` text,
	`monetize_description` text,
	`monetized_at` integer,
	`ordinal` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `playground_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
