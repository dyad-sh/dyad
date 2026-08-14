CREATE TABLE `coolify_app_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`server_uuid` text NOT NULL,
	`project_uuid` text NOT NULL,
	`environment_name` text DEFAULT 'production' NOT NULL,
	`application_uuid` text,
	`domain` text,
	`app_url` text,
	`last_deployed_at` integer,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coolify_app_connections_target_unique` ON `coolify_app_connections` (`app_id`,`server_uuid`,`project_uuid`,`environment_name`);