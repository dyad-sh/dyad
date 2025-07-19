ALTER TABLE `chats` RENAME COLUMN "db_lsn" TO "db_timestamp";--> statement-breakpoint
ALTER TABLE `snapshots` RENAME COLUMN "db_lsn" TO "db_timestamp";--> statement-breakpoint
DROP INDEX `snapshots_app_commit_lsn_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_app_commit_timestamp_unique` ON `snapshots` (`app_id`,`commit_hash`,`db_timestamp`);--> statement-breakpoint
ALTER TABLE `messages` ADD `db_timestamp` text;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `db_lsn`;