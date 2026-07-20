ALTER TABLE `mcp_servers` ADD `catalog_slug` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_mcp_catalog_slug` ON `mcp_servers` (`catalog_slug`);