CREATE TABLE `agent_os_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'Custom' NOT NULL,
	`endpoint` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`api_key` text,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`icon` text DEFAULT '🤖' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`task_count` integer DEFAULT 0 NOT NULL,
	`last_activity_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
