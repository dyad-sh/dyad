CREATE TABLE `mcp_app_config_apps` (
	`app_config_id` integer NOT NULL,
	`server_id` integer NOT NULL,
	`app_id` integer NOT NULL,
	FOREIGN KEY (`app_config_id`) REFERENCES `mcp_app_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_mcp_app_config_plugin_app` ON `mcp_app_config_apps` (`server_id`,`app_id`);--> statement-breakpoint
CREATE INDEX `mcp_app_config_apps_config_idx` ON `mcp_app_config_apps` (`app_config_id`);--> statement-breakpoint
CREATE INDEX `mcp_app_config_apps_app_idx` ON `mcp_app_config_apps` (`app_id`);--> statement-breakpoint
CREATE TABLE `mcp_app_config_tool_consents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_config_id` integer NOT NULL,
	`tool_name` text NOT NULL,
	`consent` text DEFAULT 'ask' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_config_id`) REFERENCES `mcp_app_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_mcp_app_config_consent` ON `mcp_app_config_tool_consents` (`app_config_id`,`tool_name`);--> statement-breakpoint
CREATE TABLE `mcp_app_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_id` integer NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`command` text,
	`args` text,
	`env_encrypted` text,
	`headers_encrypted` text,
	`url` text,
	`oauth_enabled` integer DEFAULT 0 NOT NULL,
	`oauth_state` text,
	`oauth_client_id` text,
	`oauth_client_secret` text,
	`oauth_scope` text,
	`oauth_callback_port` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_app_configs_server_idx` ON `mcp_app_configs` (`server_id`);--> statement-breakpoint
CREATE TABLE `mcp_server_default_apps` (
	`server_id` integer NOT NULL,
	`app_id` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_mcp_server_default_app` ON `mcp_server_default_apps` (`server_id`,`app_id`);--> statement-breakpoint
CREATE INDEX `mcp_server_default_apps_app_idx` ON `mcp_server_default_apps` (`app_id`);--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `default_scope` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `scoped_enabled` integer DEFAULT 0 NOT NULL;