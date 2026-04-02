CREATE TABLE `image_studio_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prompt` text NOT NULL,
	`negative_prompt` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`width` integer DEFAULT 1024 NOT NULL,
	`height` integer DEFAULT 1024 NOT NULL,
	`file_path` text NOT NULL,
	`seed` text,
	`style` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
