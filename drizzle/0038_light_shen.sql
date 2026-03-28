CREATE TABLE `autonomous_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` integer,
	`agent_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`phases` text,
	`current_phase_index` integer,
	`log` text DEFAULT '',
	`verify_attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`target_app_path` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_missions_status` ON `autonomous_missions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_missions_app` ON `autonomous_missions` (`app_id`);