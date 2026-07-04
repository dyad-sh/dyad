ALTER TABLE `apps` ADD `supabase_test_user_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `neon_test_branch_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `testing_enabled` integer DEFAULT 0 NOT NULL;