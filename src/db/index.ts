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
import { getDyadAppPath, getUserDataPath } from "../paths/paths";
import log from "electron-log";
import { app } from "electron";

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
  fs.mkdirSync(getDyadAppPath("."), { recursive: true });

  const sqlite = new Database(dbPath, { timeout: 10000 });
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });

  try {
    let migrationsFolder = path.join(__dirname, "..", "..", "drizzle");

    // Try resolved path using app.getAppPath() if generic relative path fails
    if (!fs.existsSync(migrationsFolder)) {
      try {
        const appPath = app.getAppPath();
        // In dev, appPath is the project root. In prod, it might be resources/app.asar
        migrationsFolder = path.join(appPath, "drizzle");

        // If that still doesn't exist, try un-asar-ed path for prod
        if (!fs.existsSync(migrationsFolder)) {
          migrationsFolder = path.join(process.resourcesPath, "drizzle");
        }
      } catch (e) {
        logger.error("Failed to resolve app path for migrations:", e);
      }
    }

    if (!fs.existsSync(migrationsFolder)) {
      logger.error("Migrations folder not found:", migrationsFolder);
    } else {
      logger.log("Running migrations from:", migrationsFolder);

      // Check if the themes table exists before running migrations
      const themeTableExists = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='themes'",
        )
        .get();

      if (!themeTableExists) {
        logger.log(
          "themes table does not exist, ensuring migrations run correctly...",
        );

        // Check if model column exists to fix migration 0020 issue
        const messageColumns = sqlite.pragma("table_info(messages)") as Array<{
          name: string;
        }>;
        const hasModelColumn = messageColumns.some(
          (col) => col.name === "model",
        );

        if (hasModelColumn) {
          logger.log(
            "model column already exists, migration 0020 will be skipped if it fails",
          );
        }
      }

      migrate(_db, { migrationsFolder });
    }
  } catch (error) {
    logger.error("Migration error:", error);
    logger.error("Attempting to manually create themes table if missing...");

    // Try to create themes table manually if migration failed
    try {
      const themeTableExists = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='themes'",
        )
        .get();

      if (!themeTableExists) {
        logger.log("Creating themes table manually...");
        sqlite.exec(`
          CREATE TABLE IF NOT EXISTS themes (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            prompt TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
            updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
          );
        `);
        logger.log("themes table created successfully");
      }
    } catch (manualError) {
      logger.error("Failed to manually create themes table:", manualError);
    }
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
