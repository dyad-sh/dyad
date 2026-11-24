CREATE TABLE `supabase_self_hosted_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`studio_url` text,
	`anon_key_encrypted` text NOT NULL,
	`service_key_encrypted` text NOT NULL,
	`ssh_host` text,
	`ssh_port` integer,
	`ssh_username` text,
	`ssh_private_key_encrypted` text,
	`ssh_host_key_fingerprint` text,
	`functions_container` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
