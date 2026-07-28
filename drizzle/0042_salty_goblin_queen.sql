ALTER TABLE `apps` ADD `coolify_server_uuid` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_project_uuid` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_environment_name` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_ssh_host` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_ssh_user` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_ssh_port` integer;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_application_uuid` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_database_uuid` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_app_url` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `coolify_last_deployed_at` integer;--> statement-breakpoint
ALTER TABLE `apps` ADD `portable_codegen` integer DEFAULT 0 NOT NULL;