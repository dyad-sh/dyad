CREATE TABLE `a2a_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`caller_principal_id` text NOT NULL,
	`provider_principal_id` text NOT NULL,
	`state` text DEFAULT 'ACCEPTED' NOT NULL,
	`state_history_json` text DEFAULT '[]' NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`escrow_ledger_id` text,
	`failure_reason` text,
	`dispute_reason` text,
	`resolution_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`quote_id`) REFERENCES `a2a_quotes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`listing_id`) REFERENCES `agent_service_listings`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`caller_principal_id`) REFERENCES `agent_principals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_principal_id`) REFERENCES `agent_principals`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_contract_caller` ON `a2a_contracts` (`caller_principal_id`);--> statement-breakpoint
CREATE INDEX `idx_contract_provider` ON `a2a_contracts` (`provider_principal_id`);--> statement-breakpoint
CREATE INDEX `idx_contract_state` ON `a2a_contracts` (`state`);--> statement-breakpoint
CREATE TABLE `a2a_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input_json` text,
	`output_json` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`duration_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`provider` text,
	`model` text,
	`verified_at` integer,
	`verdict` text,
	`verdict_note` text,
	`evidence_json` text,
	`receipt_hash` text,
	`receipt_cid` text,
	`receipt_height` integer,
	`receipt_pinned_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `a2a_contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_invocation_contract` ON `a2a_invocations` (`contract_id`);--> statement-breakpoint
CREATE INDEX `idx_invocation_status` ON `a2a_invocations` (`status`);--> statement-breakpoint
CREATE TABLE `a2a_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`caller_principal_id` text NOT NULL,
	`input_summary` text,
	`input_json` text,
	`estimated_tokens` integer,
	`quoted_amount` text NOT NULL,
	`quoted_currency` text NOT NULL,
	`quoted_latency_ms` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `agent_service_listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`caller_principal_id`) REFERENCES `agent_principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_quote_listing` ON `a2a_quotes` (`listing_id`);--> statement-breakpoint
CREATE INDEX `idx_quote_caller` ON `a2a_quotes` (`caller_principal_id`);--> statement-breakpoint
CREATE INDEX `idx_quote_status` ON `a2a_quotes` (`status`);--> statement-breakpoint
CREATE TABLE `agent_principals` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` integer NOT NULL,
	`did` text NOT NULL,
	`payout_wallet` text,
	`public_key` text,
	`daily_cap` text DEFAULT '0' NOT NULL,
	`per_task_cap` text DEFAULT '0' NOT NULL,
	`currency` text DEFAULT 'USDC' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`spent_today_string` text DEFAULT '0' NOT NULL,
	`spent_today_reset_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_principals_did_unique` ON `agent_principals` (`did`);--> statement-breakpoint
CREATE INDEX `idx_agent_principal_status` ON `agent_principals` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_principal_agent` ON `agent_principals` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_service_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`capability` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`pricing_model` text DEFAULT 'fixed' NOT NULL,
	`price_amount` text DEFAULT '0' NOT NULL,
	`currency` text DEFAULT 'USDC' NOT NULL,
	`max_latency_ms` integer,
	`success_rate_promised` integer,
	`input_schema_json` text,
	`output_schema_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `agent_principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_listing_principal` ON `agent_service_listings` (`principal_id`);--> statement-breakpoint
CREATE INDEX `idx_listing_capability` ON `agent_service_listings` (`capability`);--> statement-breakpoint
CREATE INDEX `idx_listing_status` ON `agent_service_listings` (`status`);