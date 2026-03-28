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
