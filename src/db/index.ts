// db.ts
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq, isNull } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import { getDyadAppPath, getUserDataPath } from "../paths/paths";
import log from "electron-log";
import {
  generateAvatarSeed,
  generateAvatarConfig,
} from "../lib/avatarGenerator";

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

/**
 * Backfill icons for existing apps that don't have one.
 * Runs once after database initialization.
 * Processes apps in batches to avoid blocking the main thread.
 */
export async function backfillAppIcons(): Promise<void> {
  const database = getDb();
  const BATCH_SIZE = 10;

  try {
    // Find all apps without an icon
    const appsWithoutIcons = await database.query.apps.findMany({
      where: isNull(schema.apps.iconType),
    });

    if (appsWithoutIcons.length === 0) {
      logger.log("No apps need icon backfill");
      return;
    }

    logger.log(`Backfilling icons for ${appsWithoutIcons.length} apps...`);

    // Process in batches
    for (let i = 0; i < appsWithoutIcons.length; i += BATCH_SIZE) {
      const batch = appsWithoutIcons.slice(i, i + BATCH_SIZE);

      for (const app of batch) {
        const seed = generateAvatarSeed(app.id, app.name);
        const config = generateAvatarConfig(seed);

        await database
          .update(schema.apps)
          .set({
            iconType: "generated",
            iconData: JSON.stringify(config),
          })
          .where(eq(schema.apps.id, app.id));
      }

      // Yield to the main thread between batches
      if (i + BATCH_SIZE < appsWithoutIcons.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    logger.log(
      `Successfully backfilled icons for ${appsWithoutIcons.length} apps`,
    );
  } catch (error) {
    logger.error("Error backfilling app icons:", error);
  }
}
