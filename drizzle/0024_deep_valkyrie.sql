CREATE TABLE `content_blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`storage_path` text NOT NULL,
	`is_chunked` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer,
	`chunk_hashes` text,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`is_pinned` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dataset_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`job_type` text NOT NULL,
	`config_json` text,
	`provider_type` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`total_items` integer DEFAULT 0 NOT NULL,
	`completed_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`checkpoint_json` text,
	`estimated_cost` text,
	`actual_cost` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `dataset_items` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`modality` text NOT NULL,
	`content_hash` text NOT NULL,
	`byte_size` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_path` text,
	`generator` text,
	`lineage_json` text,
	`content_uri` text NOT NULL,
	`local_path` text,
	`thumbnail_path` text,
	`labels_json` text,
	`annotations_json` text,
	`quality_signals_json` text,
	`license` text DEFAULT 'unknown' NOT NULL,
	`consent_flags` text,
	`restrictions` text,
	`creator_signature` text,
	`signed_at` integer,
	`split` text DEFAULT 'unassigned' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dataset_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`version` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`merkle_root` text,
	`schema_json` text,
	`stats_json` text,
	`total_items` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`splits_json` text,
	`license` text NOT NULL,
	`license_url` text,
	`publish_status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`marketplace_id` text,
	`creator_signature` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dataset_version_unique` ON `dataset_manifests` (`dataset_id`,`version`);--> statement-breakpoint
CREATE TABLE `dataset_p2p_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`peer_id` text NOT NULL,
	`peer_name` text,
	`sync_direction` text NOT NULL,
	`last_synced_version` text,
	`last_synced_at` integer,
	`conflict_state` text DEFAULT 'none' NOT NULL,
	`conflict_details_json` text,
	`sync_status` text DEFAULT 'idle' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dataset_peer_unique` ON `dataset_p2p_sync` (`dataset_id`,`peer_id`);--> statement-breakpoint
CREATE TABLE `provenance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`input_hashes_json` text,
	`output_hash` text NOT NULL,
	`parameters_json` text,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `dataset_items`(`id`) ON UPDATE no action ON DELETE cascade
);
