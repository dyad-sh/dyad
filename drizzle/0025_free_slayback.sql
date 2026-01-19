CREATE TABLE `studio_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`dataset_type` text DEFAULT 'custom' NOT NULL,
	`supported_modalities` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`license` text DEFAULT 'cc-by-4.0' NOT NULL,
	`license_url` text,
	`creator_name` text,
	`creator_id` text,
	`publish_status` text DEFAULT 'draft' NOT NULL,
	`tags` text,
	`schema_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
