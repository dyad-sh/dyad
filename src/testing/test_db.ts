import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import * as schema from "@/db/schema";

export type TestDb = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/**
 * Creates a real SQLite database in memory with all drizzle migrations
 * applied. Unit tests can run handlers against this instead of hand-mocking
 * drizzle query-builder chains.
 *
 * Close it via `db.$client.close()` (done automatically by
 * `setupHandlerTestHarness().dispose()`).
 */
export function createInMemoryTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const testDb = drizzle(sqlite, { schema }) as TestDb;
  // Vitest runs with the repo root as cwd, where the migrations live.
  migrate(testDb, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return testDb;
}
