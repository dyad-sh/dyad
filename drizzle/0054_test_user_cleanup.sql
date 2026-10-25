CREATE TABLE `test_user_cleanup` (
	`user_id` text PRIMARY KEY NOT NULL,
	`app_id` integer NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`organization_slug` text NOT NULL
);
