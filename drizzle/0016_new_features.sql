CREATE TABLE `deployment_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`provider` text NOT NULL,
	`project_id` text,
	`project_name` text,
	`access_token` text,
	`region` text,
	`deployment_url` text,
	`config` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`config_id` integer NOT NULL,
	`provider` text NOT NULL,
	`deployment_id` text,
	`url` text,
	`status` text NOT NULL,
	`commit_hash` text,
	`logs` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`config_id`) REFERENCES `deployment_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `component_libraries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`library` text NOT NULL,
	`installed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `installed_components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`component_name` text NOT NULL,
	`installed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `component_libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
