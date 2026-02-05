CREATE TABLE `creator_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`asset_type` text NOT NULL,
	`feedback_type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`data_json` text,
	`resolved_at` integer,
	`resolution_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`asset_type` text NOT NULL,
	`stage` text NOT NULL,
	`previous_stage` text,
	`actor_id` text NOT NULL,
	`related_event_id` text,
	`related_event_type` text,
	`receipt_cid` text,
	`celestia_blob_hash` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reputation_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`overall_score` integer DEFAULT 0 NOT NULL,
	`creation_score` integer DEFAULT 0 NOT NULL,
	`verification_score` integer DEFAULT 0 NOT NULL,
	`usage_score` integer DEFAULT 0 NOT NULL,
	`reward_score` integer DEFAULT 0 NOT NULL,
	`consistency_score` integer DEFAULT 0 NOT NULL,
	`tier` text DEFAULT 'newcomer' NOT NULL,
	`total_assets_created` integer DEFAULT 0 NOT NULL,
	`total_verifications_passed` integer DEFAULT 0 NOT NULL,
	`total_verifications_failed` integer DEFAULT 0 NOT NULL,
	`total_usage_events` integer DEFAULT 0 NOT NULL,
	`total_rewards_earned` text DEFAULT '0' NOT NULL,
	`total_receipts_generated` integer DEFAULT 0 NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`last_active_at` integer,
	`average_quality_score` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rewards_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`recipient_type` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_event_id` text,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`tx_hash` text,
	`network` text,
	`asset_id` text,
	`asset_type` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`paid_out_at` integer
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`asset_type` text NOT NULL,
	`event_type` text NOT NULL,
	`consumer_id` text,
	`consumer_type` text,
	`units` integer DEFAULT 1 NOT NULL,
	`compute_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`data_bytes_processed` integer,
	`session_id` text,
	`request_id` text,
	`model_id` text,
	`receipt_id` text,
	`receipt_cid` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification_records` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`asset_type` text NOT NULL,
	`verifier_id` text NOT NULL,
	`verifier_type` text NOT NULL,
	`verification_type` text NOT NULL,
	`passed` integer NOT NULL,
	`score` integer,
	`details` text,
	`error_message` text,
	`evidence_json` text,
	`evidence_cid` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
