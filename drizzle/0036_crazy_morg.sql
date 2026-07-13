CREATE TABLE `security_fix_chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` integer NOT NULL,
	`review_chat_id` integer NOT NULL,
	`finding_key` text NOT NULL,
	`fix_chat_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fix_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `security_fix_chats_review_chat_id_idx` ON `security_fix_chats` (`review_chat_id`);--> statement-breakpoint
CREATE INDEX `security_fix_chats_fix_chat_id_idx` ON `security_fix_chats` (`fix_chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `security_fix_chats_unique` ON `security_fix_chats` (`app_id`,`review_chat_id`,`finding_key`);