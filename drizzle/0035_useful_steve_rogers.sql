CREATE TABLE `ssi_anchor_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`did` text NOT NULL,
	`data_hash` text NOT NULL,
	`celestia_height` integer,
	`celestia_tx_hash` text,
	`celestia_namespace` text,
	`celestia_commitment` text,
	`anchored_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ssi_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`issuer_did` text NOT NULL,
	`subject_did` text NOT NULL,
	`credential_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`issued_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ssi_identities` (
	`did` text PRIMARY KEY NOT NULL,
	`identity_type` text NOT NULL,
	`display_name` text,
	`bio` text,
	`avatar` text,
	`did_document_json` text NOT NULL,
	`public_key` text,
	`algorithm` text NOT NULL,
	`linked_to_did` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ssi_presentations` (
	`id` text PRIMARY KEY NOT NULL,
	`holder_did` text NOT NULL,
	`verifier_did` text,
	`presentation_json` text NOT NULL,
	`credential_ids` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`config` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sync_cursor` text,
	`last_sync_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_agent_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`action_type` text NOT NULL,
	`target_message_id` integer,
	`payload` text NOT NULL,
	`trust_level` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`executed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_id` text,
	`storage_path` text,
	FOREIGN KEY (`message_id`) REFERENCES `email_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`to_addr` text DEFAULT '[]' NOT NULL,
	`cc_addr` text DEFAULT '[]' NOT NULL,
	`bcc_addr` text DEFAULT '[]' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`body_html` text,
	`in_reply_to` text,
	`parent_message_id` integer,
	`ai_generated` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`delimiter` text DEFAULT '/' NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`last_sync_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`remote_id` text NOT NULL,
	`thread_id` text,
	`folder` text NOT NULL,
	`from_addr` text NOT NULL,
	`to_addr` text NOT NULL,
	`cc_addr` text DEFAULT '[]' NOT NULL,
	`bcc_addr` text DEFAULT '[]' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body_plain` text,
	`body_html` text,
	`snippet` text DEFAULT '' NOT NULL,
	`date` integer NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`raw_headers` text,
	`size` integer,
	`priority` text,
	`ai_category` text,
	`ai_summary` text,
	`ai_follow_up_date` integer,
	`calendar_event_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`sync_type` text NOT NULL,
	`status` text NOT NULL,
	`messages_added` integer DEFAULT 0 NOT NULL,
	`messages_deleted` integer DEFAULT 0 NOT NULL,
	`messages_updated` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
