CREATE TABLE `chat_data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`data_source_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_data_sources_unique` ON `chat_data_sources` (`chat_id`,`data_source_id`);--> statement-breakpoint
CREATE TABLE `data_source_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`column_name` text NOT NULL,
	`data_type` text NOT NULL,
	`nullable` integer DEFAULT true NOT NULL,
	`default_value` text,
	`primary_key` integer DEFAULT false NOT NULL,
	`is_unique` integer DEFAULT false NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`semantic_description` text DEFAULT '' NOT NULL,
	`json_keys` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `data_source_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_source_columns_unique` ON `data_source_columns` (`table_id`,`column_name`);--> statement-breakpoint
CREATE TABLE `data_source_query_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`data_source_id` text NOT NULL,
	`chat_id` integer,
	`tables_accessed` text DEFAULT '[]' NOT NULL,
	`query_type` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`execution_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_source_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`data_source_id` text NOT NULL,
	`source_schema` text NOT NULL,
	`source_table` text NOT NULL,
	`source_column` text NOT NULL,
	`target_schema` text NOT NULL,
	`target_table` text NOT NULL,
	`target_column` text NOT NULL,
	`relationship_type` text DEFAULT 'foreign_key' NOT NULL,
	`constraint_name` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `data_source_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`data_source_id` text NOT NULL,
	`schema_name` text NOT NULL,
	`table_name` text NOT NULL,
	`table_type` text DEFAULT 'table' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`semantic_description` text DEFAULT '' NOT NULL,
	`estimated_rows` integer,
	`synced_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_source_tables_unique` ON `data_source_tables` (`data_source_id`,`schema_name`,`table_name`);--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'supabase' NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_url` text NOT NULL,
	`encrypted_credential` text,
	`credential_type` text DEFAULT 'secret' NOT NULL,
	`environment` text DEFAULT 'development' NOT NULL,
	`access_mode` text DEFAULT 'read_only' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`status_message` text DEFAULT '' NOT NULL,
	`last_connected_at` integer,
	`last_schema_sync_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
