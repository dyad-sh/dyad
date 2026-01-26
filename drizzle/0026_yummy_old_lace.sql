CREATE TABLE `jcn_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_wallet` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`old_state_json` text,
	`new_state_json` text,
	`request_id` text,
	`trace_id` text,
	`ip_address` text,
	`user_agent` text,
	`metadata_json` text
);
--> statement-breakpoint
CREATE TABLE `jcn_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`bundle_cid` text NOT NULL,
	`manifest_cid` text,
	`manifest_hash` text NOT NULL,
	`merkle_root` text NOT NULL,
	`bundle_type` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text,
	`creator` text NOT NULL,
	`total_size` integer NOT NULL,
	`file_count` integer NOT NULL,
	`chunk_count` integer,
	`entry_point` text,
	`manifest_json` text,
	`verified` integer DEFAULT false NOT NULL,
	`verified_at` integer,
	`signature_valid` integer,
	`pin_status_json` text DEFAULT '[]',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jcn_bundles_bundle_cid_unique` ON `jcn_bundles` (`bundle_cid`);--> statement-breakpoint
CREATE TABLE `jcn_chain_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`tx_hash` text NOT NULL,
	`network` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`block_number` integer,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`required_confirmations` integer NOT NULL,
	`tx_type` text NOT NULL,
	`related_record_id` text,
	`related_record_type` text,
	`gas_used` text,
	`gas_price` text,
	`submitted_at` integer NOT NULL,
	`confirmed_at` integer,
	`last_checked_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jcn_chain_transactions_tx_hash_unique` ON `jcn_chain_transactions` (`tx_hash`);--> statement-breakpoint
CREATE TABLE `jcn_job_records` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`state` text DEFAULT 'PENDING' NOT NULL,
	`state_history_json` text DEFAULT '[]' NOT NULL,
	`ticket_json` text NOT NULL,
	`ticket_valid` integer,
	`license_valid` integer,
	`bundle_verified` integer,
	`container_id` text,
	`input_cid` text,
	`output_cid` text,
	`output_hash` text,
	`started_at` integer,
	`execution_duration_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`memory_peak_mb` integer,
	`receipt_json` text,
	`receipt_cid` text,
	`error_code` text,
	`error_message` text,
	`error_retryable` integer DEFAULT false,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jcn_job_records_request_id_unique` ON `jcn_job_records` (`request_id`);--> statement-breakpoint
CREATE TABLE `jcn_keys` (
	`key_id` text PRIMARY KEY NOT NULL,
	`key_type` text NOT NULL,
	`algorithm` text NOT NULL,
	`backend` text NOT NULL,
	`public_key` text,
	`wallet_address` text,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_rotated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jcn_licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`license_type` text NOT NULL,
	`asset_id` text NOT NULL,
	`licensee` text NOT NULL,
	`licensor` text NOT NULL,
	`scope` text NOT NULL,
	`limits_json` text,
	`inferences_used` integer DEFAULT 0 NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`verification_method` text NOT NULL,
	`contract_address` text,
	`token_id` text,
	`signature` text,
	`valid` integer NOT NULL,
	`validated_at` integer NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `license_asset_licensee` ON `jcn_licenses` (`asset_id`,`licensee`);--> statement-breakpoint
CREATE TABLE `jcn_publish_records` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`state` text DEFAULT 'INIT' NOT NULL,
	`state_history_json` text DEFAULT '[]' NOT NULL,
	`store_id` text NOT NULL,
	`publisher_wallet` text NOT NULL,
	`bundle_type` text NOT NULL,
	`source_path` text,
	`source_type` text DEFAULT 'local_path' NOT NULL,
	`bundle_cid` text,
	`manifest_cid` text,
	`manifest_hash` text,
	`merkle_root` text,
	`total_size` integer,
	`mint_tx_hash` text,
	`token_id` text,
	`collection_contract` text,
	`marketplace_asset_id` text,
	`metadata_json` text,
	`pricing_json` text,
	`error_code` text,
	`error_message` text,
	`error_retryable` integer DEFAULT false,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`last_retry_at` integer,
	`checkpoint_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jcn_publish_records_request_id_unique` ON `jcn_publish_records` (`request_id`);--> statement-breakpoint
CREATE TABLE `jcn_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`endpoint` text NOT NULL,
	`identifier` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL,
	`max_requests` integer NOT NULL,
	`window_sec` integer NOT NULL
);
