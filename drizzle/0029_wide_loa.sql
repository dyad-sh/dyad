CREATE TABLE `mab_arms` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`context_key` text NOT NULL,
	`alpha` real DEFAULT 1 NOT NULL,
	`beta_param` real DEFAULT 1 NOT NULL,
	`pulls` integer DEFAULT 0 NOT NULL,
	`total_reward` real DEFAULT 0 NOT NULL,
	`metadata_json` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_reward_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mab_arms_context_key_idx` ON `mab_arms` (`context_key`);--> statement-breakpoint
CREATE INDEX `mab_arms_domain_idx` ON `mab_arms` (`domain`);--> statement-breakpoint
CREATE INDEX `mab_arms_is_active_idx` ON `mab_arms` (`is_active`);--> statement-breakpoint
CREATE TABLE `mab_decay_config` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`half_life_days` integer DEFAULT 14 NOT NULL,
	`min_pulls` integer DEFAULT 5 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mab_decay_config_domain_unique` ON `mab_decay_config` (`domain`);--> statement-breakpoint
CREATE TABLE `mab_reward_events` (
	`id` text PRIMARY KEY NOT NULL,
	`arm_id` text NOT NULL,
	`reward` real NOT NULL,
	`context_json` text,
	`feedback` text,
	`source` text DEFAULT 'auto' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`arm_id`) REFERENCES `mab_arms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mab_reward_events_arm_id_idx` ON `mab_reward_events` (`arm_id`);--> statement-breakpoint
CREATE INDEX `mab_reward_events_created_at_idx` ON `mab_reward_events` (`created_at`);