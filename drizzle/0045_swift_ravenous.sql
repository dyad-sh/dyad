CREATE TABLE `agent_skill_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`skill_id` integer NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`installed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_skill_links_agent_id_skill_id_unique` ON `agent_skill_links` (`agent_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`implementation_type` text DEFAULT 'prompt' NOT NULL,
	`implementation_code` text,
	`trigger_patterns` text DEFAULT '[]',
	`input_schema` text,
	`output_schema` text,
	`examples` text DEFAULT '[]',
	`tags` text DEFAULT '[]',
	`version` text DEFAULT '1.0.0' NOT NULL,
	`author_id` text,
	`publish_status` text DEFAULT 'local',
	`marketplace_id` text,
	`price` integer DEFAULT 0,
	`currency` text DEFAULT 'USD',
	`downloads` integer DEFAULT 0,
	`rating` real DEFAULT 0,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
