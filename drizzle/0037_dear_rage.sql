CREATE TABLE `agent_share_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`share_token` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`title` text,
	`backend_config_json` text,
	`widget_config_json` text,
	`allowed_domains` text,
	`live_url` text,
	`source_app_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_share_configs_share_token_unique` ON `agent_share_configs` (`share_token`);