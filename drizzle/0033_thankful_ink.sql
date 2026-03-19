CREATE TABLE `flywheel_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`training_samples_count` integer DEFAULT 0 NOT NULL,
	`dataset_id` text,
	`job_id` text,
	`error` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flywheel_training_pairs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer,
	`app_id` integer,
	`source_type` text NOT NULL,
	`user_input` text NOT NULL,
	`assistant_output` text NOT NULL,
	`rating` text,
	`corrected_output` text,
	`captured` integer DEFAULT false NOT NULL,
	`message_id` integer,
	`model` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `flywheel_tp_agent_idx` ON `flywheel_training_pairs` (`agent_id`);--> statement-breakpoint
CREATE INDEX `flywheel_tp_captured_idx` ON `flywheel_training_pairs` (`captured`);