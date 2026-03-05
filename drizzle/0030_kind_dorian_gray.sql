CREATE TABLE `agent_long_term_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`category` text NOT NULL,
	`content` text NOT NULL,
	`key` text,
	`importance` real DEFAULT 0.5 NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ltm_agent` ON `agent_long_term_memory` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_ltm_agent_category` ON `agent_long_term_memory` (`agent_id`,`category`);--> statement-breakpoint
CREATE INDEX `idx_ltm_agent_key` ON `agent_long_term_memory` (`agent_id`,`key`);--> statement-breakpoint
CREATE INDEX `idx_ltm_importance` ON `agent_long_term_memory` (`agent_id`,`importance`);--> statement-breakpoint
CREATE TABLE `agent_memory_config` (
	`agent_id` integer PRIMARY KEY NOT NULL,
	`long_term_enabled` integer DEFAULT false NOT NULL,
	`long_term_max_context` integer DEFAULT 10 NOT NULL,
	`short_term_enabled` integer DEFAULT false NOT NULL,
	`short_term_max_entries` integer DEFAULT 50 NOT NULL,
	`auto_extract` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_short_term_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`chat_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stm_agent_chat` ON `agent_short_term_memory` (`agent_id`,`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_stm_agent_chat_key` ON `agent_short_term_memory` (`agent_id`,`chat_id`,`key`);