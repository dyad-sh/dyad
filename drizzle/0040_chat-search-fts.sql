-- Custom SQL migration file, put your code below! --

-- Chat-search FTS5 index + sync triggers.
-- Drizzle cannot model FTS5 virtual tables or triggers, so this SQL is
-- hand-written inside a drizzle-generated custom migration scaffold.
--
-- chat_search_fts stores a cleaned, TypeScript-built projection of each chat
-- message (see chat_search_text.ts), never raw message content. The FTS rowid
-- IS the source message id, so each message has at most one indexed document.
-- Triggers only enqueue work into the dirty tables (created in 0039);
-- ChatSearchIndexer drains them and writes the FTS rows.
CREATE VIRTUAL TABLE `chat_search_fts` USING fts5(
	`title`,
	`body`,
	`app_id` UNINDEXED,
	`chat_id` UNINDEXED,
	`role` UNINDEXED,
	`message_created_at` UNINDEXED,
	`is_compaction_summary` UNINDEXED,
	`projection_truncated` UNINDEXED,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `chat_search_messages_after_insert` AFTER INSERT ON `messages` BEGIN
	INSERT OR REPLACE INTO `chat_search_dirty_messages` (`message_id`) VALUES (new.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `chat_search_messages_after_update` AFTER UPDATE OF `content`, `role`, `is_compaction_summary`, `chat_id` ON `messages` BEGIN
	INSERT OR REPLACE INTO `chat_search_dirty_messages` (`message_id`) VALUES (new.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `chat_search_messages_after_delete` AFTER DELETE ON `messages` BEGIN
	DELETE FROM `chat_search_fts` WHERE rowid = old.`id`;
	DELETE FROM `chat_search_dirty_messages` WHERE `message_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `chat_search_chats_after_title_update` AFTER UPDATE OF `title` ON `chats` BEGIN
	INSERT OR REPLACE INTO `chat_search_dirty_chats` (`chat_id`) VALUES (new.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `chat_search_chats_after_delete` AFTER DELETE ON `chats` BEGIN
	DELETE FROM `chat_search_fts` WHERE `chat_id` = old.`id`;
	DELETE FROM `chat_search_dirty_chats` WHERE `chat_id` = old.`id`;
END;
--> statement-breakpoint
INSERT OR REPLACE INTO `chat_search_dirty_messages` (`message_id`) SELECT `id` FROM `messages`;
