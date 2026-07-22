CREATE TABLE `chat_search_dirty_chats` (
	`chat_id` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_search_dirty_messages` (
	`message_id` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_search_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
