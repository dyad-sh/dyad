ALTER TABLE `messages` ADD `user_input_request_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_chat_user_input_request_unique` ON `messages` (`chat_id`,`user_input_request_id`);