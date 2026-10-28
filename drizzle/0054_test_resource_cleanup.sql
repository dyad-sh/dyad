CREATE TABLE `test_branch_cleanup` (
	`branch_id` text PRIMARY KEY NOT NULL,
	`app_id` integer NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_branch_cleanup_owner_id_unique` ON `test_branch_cleanup` (`owner_id`);--> statement-breakpoint
CREATE TABLE `test_user_cleanup` (
	`user_id` text PRIMARY KEY NOT NULL,
	`app_id` integer NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`organization_slug` text NOT NULL
);
