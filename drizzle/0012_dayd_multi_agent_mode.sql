CREATE TABLE `agent_workflows` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `chat_id` integer NOT NULL,
  `status` text NOT NULL,
  `plan_version` integer NOT NULL DEFAULT 0,
  `current_todo_id` text,
  `auto_advance` integer NOT NULL DEFAULT 0,
  `analysis` text,
  `dyad_tag_context` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_workflows_chat_unique` ON `agent_workflows` (`chat_id`);
--> statement-breakpoint
CREATE TABLE `agent_todos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `workflow_id` integer NOT NULL,
  `todo_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `owner` text,
  `inputs` text,
  `outputs` text,
  `completion_criteria` text,
  `status` text NOT NULL,
  `dyad_tag_refs` text,
  `order_index` integer NOT NULL,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (`workflow_id`) REFERENCES `agent_workflows`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_todos_workflow_todo_unique` ON `agent_todos` (`workflow_id`, `todo_id`);
--> statement-breakpoint
CREATE TABLE `agent_execution_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `workflow_id` integer NOT NULL,
  `todo_id` integer,
  `todo_key` text,
  `log_type` text NOT NULL,
  `content` text NOT NULL,
  `dyad_tag_refs` text,
  `metadata` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (`workflow_id`) REFERENCES `agent_workflows`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (`todo_id`) REFERENCES `agent_todos`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `agent_execution_logs_workflow_idx` ON `agent_execution_logs` (`workflow_id`);
--> statement-breakpoint
CREATE INDEX `agent_execution_logs_todo_idx` ON `agent_execution_logs` (`todo_id`);
