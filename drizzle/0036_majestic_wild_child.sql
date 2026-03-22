CREATE TABLE `scraping_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`config` text NOT NULL,
	`engine` text DEFAULT 'auto' NOT NULL,
	`pages_total` integer DEFAULT 0 NOT NULL,
	`pages_done` integer DEFAULT 0 NOT NULL,
	`records_extracted` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`resume_token` text,
	`dataset_id` text,
	`template_id` text,
	`schedule_id` text,
	`n8n_workflow_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`dataset_id`) REFERENCES `studio_datasets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `scraping_results` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`url` text NOT NULL,
	`status_code` integer,
	`data` text NOT NULL,
	`raw_html_stored` integer DEFAULT 0 NOT NULL,
	`raw_html_path` text,
	`screenshot_path` text,
	`extraction_engine` text,
	`confidence` real,
	`scraped_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `scraping_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scraping_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`job_config` text NOT NULL,
	`cron_expression` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`n8n_workflow_id` text,
	`notify_on_complete` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scraping_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`config` text NOT NULL,
	`is_public` integer DEFAULT 0 NOT NULL,
	`marketplace_id` text,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
