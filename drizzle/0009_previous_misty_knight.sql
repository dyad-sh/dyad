CREATE TABLE `versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`commit_hash` text NOT NULL,
	`neon_db_timestamp` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_app_commit_unique` ON `versions` (`app_id`,`commit_hash`);--> statement-breakpoint
ALTER TABLE `apps` ADD `neon_project_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `neon_development_branch_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `neon_preview_branch_id` text;