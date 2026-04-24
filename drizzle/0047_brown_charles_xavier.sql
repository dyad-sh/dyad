CREATE TABLE `os_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`title` text NOT NULL,
	`subtitle` text,
	`status` text DEFAULT 'running' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`metadata_json` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_os_activity_status` ON `os_activities` (`status`);--> statement-breakpoint
CREATE INDEX `idx_os_activity_source` ON `os_activities` (`source`);--> statement-breakpoint
CREATE INDEX `idx_os_activity_started` ON `os_activities` (`started_at`);--> statement-breakpoint
CREATE TABLE `os_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`scope` text DEFAULT 'system' NOT NULL,
	`capability` text,
	`keywords` text,
	`ipc_channel` text,
	`handler_key` text,
	`requires_input` integer DEFAULT false NOT NULL,
	`input_schema_json` text,
	`enabled` integer DEFAULT true NOT NULL,
	`icon` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_os_command_scope` ON `os_commands` (`scope`);--> statement-breakpoint
CREATE INDEX `idx_os_command_enabled` ON `os_commands` (`enabled`);--> statement-breakpoint
CREATE TABLE `os_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`scope` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`matched_command_id` text,
	`dispatched_target` text,
	`input_json` text,
	`result_json` text,
	`error_message` text,
	`activity_id` text,
	`requested_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`dispatched_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_os_intent_status` ON `os_intents` (`status`);--> statement-breakpoint
CREATE INDEX `idx_os_intent_created` ON `os_intents` (`created_at`);--> statement-breakpoint
CREATE TABLE `agent_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`capability` text NOT NULL,
	`scope` text,
	`conditions_json` text,
	`issued_by` text,
	`issued_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`revoked_at` integer,
	`revocation_reason` text,
	FOREIGN KEY (`principal_id`) REFERENCES `agent_principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cap_principal` ON `agent_capabilities` (`principal_id`);--> statement-breakpoint
CREATE INDEX `idx_cap_capability` ON `agent_capabilities` (`capability`);--> statement-breakpoint
CREATE INDEX `idx_cap_status` ON `agent_capabilities` (`status`);--> statement-breakpoint
CREATE TABLE `agent_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`name` text NOT NULL,
	`rule_type` text NOT NULL,
	`pattern` text,
	`max_amount` text,
	`currency` text,
	`window_seconds` integer,
	`time_window_start` integer,
	`time_window_end` integer,
	`priority` integer DEFAULT 100 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `agent_principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_policy_principal` ON `agent_policies` (`principal_id`);--> statement-breakpoint
CREATE INDEX `idx_policy_status` ON `agent_policies` (`status`);--> statement-breakpoint
CREATE INDEX `idx_policy_priority` ON `agent_policies` (`priority`);--> statement-breakpoint
CREATE TABLE `signed_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	`principal_did` text NOT NULL,
	`payload_hash` text NOT NULL,
	`signature_hex` text NOT NULL,
	`algorithm` text DEFAULT 'ed25519' NOT NULL,
	`signed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`verified_at` integer,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`verification_error` text,
	FOREIGN KEY (`intent_id`) REFERENCES `os_intents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_signed_intent_intent` ON `signed_intents` (`intent_id`);--> statement-breakpoint
CREATE INDEX `idx_signed_intent_did` ON `signed_intents` (`principal_did`);--> statement-breakpoint
CREATE INDEX `idx_signed_intent_status` ON `signed_intents` (`verification_status`);--> statement-breakpoint
CREATE TABLE `provenance_events` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_did` text NOT NULL,
	`kind` text NOT NULL,
	`subject_ref` text,
	`payload_json` text,
	`payload_hash` text NOT NULL,
	`issuer_did` text,
	`signature_hex` text,
	`algorithm` text,
	`ipld_cid` text,
	`height` integer,
	`sealed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prov_did` ON `provenance_events` (`principal_did`);--> statement-breakpoint
CREATE INDEX `idx_prov_kind` ON `provenance_events` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_prov_created` ON `provenance_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_prov_subject` ON `provenance_events` (`subject_ref`);--> statement-breakpoint
CREATE TABLE `slash_records` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_did` text NOT NULL,
	`reason` text NOT NULL,
	`amount` text DEFAULT '0' NOT NULL,
	`currency` text,
	`contract_id` text,
	`evidence_json` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`activated_at` integer,
	`reversed_at` integer,
	`reversal_reason` text
);
--> statement-breakpoint
CREATE INDEX `idx_slash_did` ON `slash_records` (`principal_did`);--> statement-breakpoint
CREATE INDEX `idx_slash_status` ON `slash_records` (`status`);