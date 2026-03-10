CREATE TABLE `openclaw_kanban_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`action` text NOT NULL,
	`from_value` text,
	`to_value` text,
	`note` text,
	`actor` text DEFAULT 'openclaw',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `openclaw_kanban_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`task_type` text DEFAULT 'custom' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`provider` text,
	`model` text,
	`agent_id` text,
	`workflow_id` text,
	`parent_task_id` text,
	`tokens_used` integer DEFAULT 0,
	`iterations_run` integer DEFAULT 0,
	`cost_estimate` text,
	`duration_ms` integer,
	`local_processed` integer DEFAULT 0,
	`result_json` text,
	`error_message` text,
	`artifacts_json` text,
	`labels` text,
	`assignee` text,
	`sort_order` integer DEFAULT 0,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
