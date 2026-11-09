CREATE TABLE `chat_workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`path` text NOT NULL,
	`app_subpath` text DEFAULT '' NOT NULL,
	`branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`base_commit` text NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`integration_status` text DEFAULT 'idle' NOT NULL,
	`integration_detail` text,
	`integration_target_commit` text,
	`validation_json` text,
	`repair_attempts` integer DEFAULT 0 NOT NULL,
	`last_integrated_commit` text,
	`package_manager` text,
	`last_active_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_workspaces_chat_unique` ON `chat_workspaces` (`chat_id`);--> statement-breakpoint
CREATE INDEX `chat_workspaces_app_idx` ON `chat_workspaces` (`app_id`);