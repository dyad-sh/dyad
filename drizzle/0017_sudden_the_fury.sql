ALTER TABLE `messages` ADD `parent_message_id` integer REFERENCES messages(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `messages` ADD `conversation_step` integer;
