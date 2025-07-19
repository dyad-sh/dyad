CREATE INDEX `favorites_app_id_idx` ON `favorites` (`app_id`);--> statement-breakpoint
CREATE INDEX `favorites_commit_hash_idx` ON `favorites` (`commit_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `favorites_app_commit_unique` ON `favorites` (`app_id`,`commit_hash`);--> statement-breakpoint
CREATE INDEX `snapshots_app_id_idx` ON `snapshots` (`app_id`);--> statement-breakpoint
CREATE INDEX `snapshots_commit_hash_idx` ON `snapshots` (`commit_hash`);--> statement-breakpoint
CREATE INDEX `snapshots_created_at_idx` ON `snapshots` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_app_commit_lsn_unique` ON `snapshots` (`app_id`,`commit_hash`,`db_lsn`);