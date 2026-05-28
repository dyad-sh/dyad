ALTER TABLE `mcp_servers` ADD `oauth_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `oauth_state` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `oauth_client_id` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `oauth_client_secret` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `oauth_scope` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `oauth_callback_port` integer;