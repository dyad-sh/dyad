CREATE TABLE `cloudflare_app_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`root_directory` text NOT NULL,
	`account_id` text NOT NULL,
	`worker_name` text NOT NULL,
	`worker_tag` text NOT NULL,
	`trigger_uuid` text NOT NULL,
	`worker_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cloudflare_app_connections_target_unique` ON `cloudflare_app_connections` (`app_id`,`root_directory`);--> statement-breakpoint
CREATE UNIQUE INDEX `cloudflare_app_connections_worker_unique` ON `cloudflare_app_connections` (`account_id`,`worker_tag`);