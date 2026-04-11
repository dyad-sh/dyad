CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`external_id` text,
	`title` text NOT NULL,
	`description` text,
	`start_at` integer NOT NULL,
	`end_at` integer,
	`is_all_day` integer DEFAULT 0 NOT NULL,
	`location` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`type` text DEFAULT 'meeting' NOT NULL,
	`recurrence_rule` text,
	`attendees_json` text,
	`agent_id` text,
	`agent_name` text,
	`metadata_json` text,
	`ics_data` text,
	`is_read_only` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `calendar_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `calendar_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`color` text DEFAULT '#3b82f6' NOT NULL,
	`auth_json` text,
	`config_json` text DEFAULT '{}',
	`last_sync_at` integer,
	`sync_interval_minutes` integer DEFAULT 15 NOT NULL,
	`sync_status` text DEFAULT 'idle' NOT NULL,
	`sync_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
