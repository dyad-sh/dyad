// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { reconcileRenumberedMcpCleanupMigration } from "./migration_compat";

const migrationsFolder = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ tag: string; when: number }> };
const cleanupIndex = journal.entries.findIndex(
  (entry) => entry.tag === "0043_uneven_hardball",
);
const cleanupMigration = readMigrationFiles({ migrationsFolder })[cleanupIndex];
const cleanupTimestamp = journal.entries[cleanupIndex].when;

function createDatabase(options: {
  hash?: string;
  keepMcpTable?: boolean;
  keepQuotaColumn?: boolean;
}) {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL
      ${options.keepQuotaColumn ? ", using_free_agent_mode_quota INTEGER" : ""}
    );
    ${options.keepMcpTable ? "CREATE TABLE mcp_servers (id INTEGER PRIMARY KEY);" : ""}
    INSERT INTO __drizzle_migrations (hash, created_at)
    VALUES ('${options.hash ?? cleanupMigration.hash}', ${cleanupTimestamp - 1000});
  `);
  return database;
}

describe("reconcileRenumberedMcpCleanupMigration", () => {
  it("updates the ledger for an identical cleanup migration with an older timestamp", () => {
    const database = createDatabase({});
    try {
      expect(
        reconcileRenumberedMcpCleanupMigration(database, migrationsFolder),
      ).toBe(true);
      const latest = database
        .prepare(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
        )
        .get();
      expect(latest).toEqual({
        hash: cleanupMigration.hash,
        created_at: cleanupTimestamp,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    ["the MCP table still exists", { keepMcpTable: true }],
    ["the legacy quota column still exists", { keepQuotaColumn: true }],
    ["the migration hash differs", { hash: "different-hash" }],
  ])("does not reconcile when %s", (_description, options) => {
    const database = createDatabase(options);
    try {
      expect(
        reconcileRenumberedMcpCleanupMigration(database, migrationsFolder),
      ).toBe(false);
      const latest = database
        .prepare(
          "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
        )
        .get() as { created_at: number };
      expect(latest.created_at).toBe(cleanupTimestamp - 1000);
    } finally {
      database.close();
    }
  });
});
