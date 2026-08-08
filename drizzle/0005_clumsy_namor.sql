CREATE TABLE `language_model_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`api_base_url` text NOT NULL,
	`env_var_name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `language_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`api_name` text NOT NULL,
	`builtin_provider_id` text,
	`custom_provider_id` text,
	`description` text,
	`max_output_tokens` integer,
	`context_window` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`custom_provider_id`) REFERENCES `language_model_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
