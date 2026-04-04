// db.ts
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import { getJoyAppPath, getUserDataPath } from "../paths/paths";
import log from "electron-log";

const logger = log.scope("db");

// Database connection factory
let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Get the database path based on the current environment
 */
export function getDatabasePath(): string {
  return path.join(getUserDataPath(), "sqlite.db");
}

/**
 * Initialize the database connection
 */
export function initializeDatabase(): BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
} {
  if (_db) return _db as any;

  const dbPath = getDatabasePath();
  logger.log("Initializing database at:", dbPath);

  // Check if the database file exists and remove it if it has issues
  try {
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      if (stats.size < 100) {
        logger.log("Database file exists but may be corrupted. Removing it...");
        fs.unlinkSync(dbPath);
      }
    }
  } catch (error) {
    logger.error("Error checking database file:", error);
  }

  fs.mkdirSync(getUserDataPath(), { recursive: true });
  fs.mkdirSync(getJoyAppPath("."), { recursive: true });

  const sqlite = new Database(dbPath, { timeout: 10000 });
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });

  try {
    const migrationsFolder = path.join(__dirname, "..", "..", "drizzle");
    if (!fs.existsSync(migrationsFolder)) {
      logger.error("Migrations folder not found:", migrationsFolder);
    } else {
      logger.log("Running migrations from:", migrationsFolder);
      migrate(_db, { migrationsFolder });
    }
  } catch (error) {
    logger.error("Migration error:", error);
  }

  // Self-healing: ensure autonomous_missions table exists even if migration failed
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`autonomous_missions\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`app_id\` integer,
        \`agent_id\` text,
        \`title\` text NOT NULL,
        \`description\` text,
        \`status\` text DEFAULT 'pending' NOT NULL,
        \`phases\` text,
        \`current_phase_index\` integer,
        \`log\` text DEFAULT '',
        \`verify_attempts\` integer DEFAULT 0 NOT NULL,
        \`last_error\` text,
        \`target_app_path\` text,
        \`created_at\` integer DEFAULT (unixepoch()) NOT NULL,
        \`updated_at\` integer DEFAULT (unixepoch()) NOT NULL,
        \`completed_at\` integer,
        FOREIGN KEY (\`app_id\`) REFERENCES \`apps\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS \`idx_missions_status\` ON \`autonomous_missions\` (\`status\`)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS \`idx_missions_app\` ON \`autonomous_missions\` (\`app_id\`)`);
  } catch (fallbackError) {
    logger.error("Failed to ensure autonomous_missions table:", fallbackError);
  }

  // Self-healing: ensure email agent tables exist
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`email_accounts\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`provider\` text NOT NULL,
        \`display_name\` text NOT NULL,
        \`email\` text NOT NULL,
        \`config\` text NOT NULL,
        \`is_default\` integer DEFAULT false NOT NULL,
        \`sync_cursor\` text,
        \`last_sync_at\` integer,
        \`created_at\` integer DEFAULT (unixepoch()) NOT NULL
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`email_messages\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT,
        \`account_id\` text NOT NULL,
        \`remote_id\` text NOT NULL,
        \`thread_id\` text,
        \`folder\` text NOT NULL,
        \`from_addr\` text NOT NULL,
        \`to_addr\` text NOT NULL,
        \`cc_addr\` text DEFAULT '[]' NOT NULL,
        \`bcc_addr\` text DEFAULT '[]' NOT NULL,
        \`subject\` text DEFAULT '' NOT NULL,
        \`body_plain\` text,
        \`body_html\` text,
        \`snippet\` text DEFAULT '' NOT NULL,
        \`date\` integer NOT NULL,
        \`is_read\` integer DEFAULT false NOT NULL,
        \`is_starred\` integer DEFAULT false NOT NULL,
        \`has_attachments\` integer DEFAULT false NOT NULL,
        \`raw_headers\` text,
        \`size\` integer,
        \`priority\` text,
        \`ai_category\` text,
        \`ai_summary\` text,
        \`ai_follow_up_date\` integer,
        \`calendar_event_json\` text,
        \`created_at\` integer DEFAULT (unixepoch()) NOT NULL,
        FOREIGN KEY (\`account_id\`) REFERENCES \`email_accounts\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`email_drafts\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT,
        \`account_id\` text NOT NULL,
        \`to_addr\` text DEFAULT '[]' NOT NULL,
        \`cc_addr\` text DEFAULT '[]' NOT NULL,
        \`bcc_addr\` text DEFAULT '[]' NOT NULL,
        \`subject\` text DEFAULT '' NOT NULL,
        \`body\` text DEFAULT '' NOT NULL,
        \`body_html\` text,
        \`in_reply_to\` text,
        \`parent_message_id\` integer,
        \`ai_generated\` integer DEFAULT false NOT NULL,
        \`created_at\` integer DEFAULT (unixepoch()) NOT NULL,
        \`updated_at\` integer DEFAULT (unixepoch()) NOT NULL,
        FOREIGN KEY (\`account_id\`) REFERENCES \`email_accounts\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`email_folders\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT,
        \`account_id\` text NOT NULL,
        \`name\` text NOT NULL,
        \`path\` text NOT NULL,
        \`type\` text DEFAULT 'custom' NOT NULL,
        \`delimiter\` text DEFAULT '/' NOT NULL,
        \`unread_count\` integer DEFAULT 0 NOT NULL,
        \`total_count\` integer DEFAULT 0 NOT NULL,
        \`last_sync_at\` integer,
        FOREIGN KEY (\`account_id\`) REFERENCES \`email_accounts\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`email_attachments\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT,
        \`message_id\` integer NOT NULL,
        \`filename\` text NOT NULL,
        \`mime_type\` text NOT NULL,
        \`size\` integer DEFAULT 0 NOT NULL,
        \`content_id\` text,
        \`storage_path\` text,
        FOREIGN KEY (\`message_id\`) REFERENCES \`email_messages\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`email_agent_actions\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT,
        \`account_id\` text NOT NULL,
        \`action_type\` text NOT NULL,
        \`target_message_id\` integer,
        \`payload\` text NOT NULL,
        \`trust_level\` text NOT NULL,
        \`status\` text DEFAULT 'pending' NOT NULL,
        \`result\` text,
        \`executed_at\` integer,
        \`created_at\` integer DEFAULT (unixepoch()) NOT NULL,
        FOREIGN KEY (\`account_id\`) REFERENCES \`email_accounts\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`email_sync_log\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT,
        \`account_id\` text NOT NULL,
        \`sync_type\` text NOT NULL,
        \`status\` text NOT NULL,
        \`messages_added\` integer DEFAULT 0 NOT NULL,
        \`messages_deleted\` integer DEFAULT 0 NOT NULL,
        \`messages_updated\` integer DEFAULT 0 NOT NULL,
        \`error\` text,
        \`started_at\` integer DEFAULT (unixepoch()) NOT NULL,
        \`completed_at\` integer,
        FOREIGN KEY (\`account_id\`) REFERENCES \`email_accounts\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `);
  } catch (fallbackError) {
    logger.error("Failed to ensure email tables:", fallbackError);
  }

  // Self-healing: ensure scraping tables exist
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`scraping_jobs\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`name\` text NOT NULL,
        \`status\` text DEFAULT 'queued' NOT NULL,
        \`config\` text NOT NULL,
        \`engine\` text DEFAULT 'auto' NOT NULL,
        \`pages_total\` integer DEFAULT 0 NOT NULL,
        \`pages_done\` integer DEFAULT 0 NOT NULL,
        \`records_extracted\` integer DEFAULT 0 NOT NULL,
        \`error_count\` integer DEFAULT 0 NOT NULL,
        \`last_error\` text,
        \`resume_token\` text,
        \`dataset_id\` text,
        \`template_id\` text,
        \`schedule_id\` text,
        \`n8n_workflow_id\` text,
        \`created_at\` integer DEFAULT (unixepoch()) NOT NULL,
        \`started_at\` integer,
        \`completed_at\` integer,
        FOREIGN KEY (\`dataset_id\`) REFERENCES \`studio_datasets\`(\`id\`) ON UPDATE no action ON DELETE set null
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`scraping_results\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`job_id\` text NOT NULL,
        \`url\` text NOT NULL,
        \`status_code\` integer,
        \`data\` text NOT NULL,
        \`raw_html_stored\` integer DEFAULT 0 NOT NULL,
        \`raw_html_path\` text,
        \`screenshot_path\` text,
        \`extraction_engine\` text,
        \`confidence\` real,
        \`scraped_at\` integer DEFAULT (unixepoch()) NOT NULL,
        FOREIGN KEY (\`job_id\`) REFERENCES \`scraping_jobs\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`scraping_schedules\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`name\` text NOT NULL,
        \`job_config\` text NOT NULL,
        \`cron_expression\` text NOT NULL,
        \`enabled\` integer DEFAULT 1 NOT NULL,
        \`last_run_at\` integer,
        \`next_run_at\` integer,
        \`n8n_workflow_id\` text,
        \`notify_on_complete\` integer DEFAULT 0 NOT NULL,
        \`created_at\` integer DEFAULT (unixepoch()) NOT NULL
      )
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`scraping_templates\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`name\` text NOT NULL,
        \`description\` text,
        \`category\` text,
        \`config\` text NOT NULL,
        \`is_public\` integer DEFAULT 0 NOT NULL,
        \`marketplace_id\` text,
        \`usage_count\` integer DEFAULT 0 NOT NULL,
        \`created_at\` integer DEFAULT (unixepoch()) NOT NULL
      )
    `);
  } catch (fallbackError) {
    logger.error("Failed to ensure scraping tables:", fallbackError);
  }

  return _db as any;
}

/**
 * Get the database instance (throws if not initialized)
 */
export function getDb(): BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
} {
  if (!_db) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return _db as any;
}

export const db = new Proxy({} as any, {
  get(target, prop) {
    const database = getDb();
    return database[prop as keyof typeof database];
  },
}) as BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};
