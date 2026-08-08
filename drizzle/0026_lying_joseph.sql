ALTER TABLE `prompts` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `prompts_slug_unique` ON `prompts` (`slug`);