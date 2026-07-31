import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

const MCP_CLEANUP_MIGRATION_TAG = "0043_uneven_hardball";

interface MigrationJournal {
  entries: Array<{ tag: string; when: number }>;
}

interface MigrationLedgerRow {
  hash: string;
  created_at: number;
}

function tableExists(sqlite: Database.Database, tableName: string): boolean {
  return Boolean(
    sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(tableName),
  );
}

function columnExists(
  sqlite: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  if (!tableExists(sqlite, tableName)) return false;
  const columns = sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{
    name: string;
  }>;
  return columns.some((column) => column.name === columnName);
}

/**
 * Reconcile the historical MCP cleanup migration whose journal timestamp was
 * changed after some fork databases had already applied the identical SQL.
 */
export function reconcileRenumberedMcpCleanupMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
): boolean {
  if (!tableExists(sqlite, "__drizzle_migrations")) return false;

  const latest = sqlite
    .prepare(
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    )
    .get() as MigrationLedgerRow | undefined;
  if (!latest) return false;

  const journal = JSON.parse(
    fs.readFileSync(
      path.join(migrationsFolder, "meta", "_journal.json"),
      "utf8",
    ),
  ) as MigrationJournal;
  const migrationIndex = journal.entries.findIndex(
    (entry) => entry.tag === MCP_CLEANUP_MIGRATION_TAG,
  );
  if (migrationIndex < 0) return false;

  const migration = readMigrationFiles({ migrationsFolder })[migrationIndex];
  const journalEntry = journal.entries[migrationIndex];
  if (
    !migration ||
    !journalEntry ||
    latest.hash !== migration.hash ||
    Number(latest.created_at) >= journalEntry.when
  ) {
    return false;
  }

  const cleanupAlreadyApplied =
    !tableExists(sqlite, "mcp_servers") &&
    !tableExists(sqlite, "mcp_tool_consents") &&
    !columnExists(sqlite, "messages", "using_free_agent_mode_quota");
  if (!cleanupAlreadyApplied) return false;

  const result = sqlite
    .prepare(
      "UPDATE __drizzle_migrations SET created_at = ? WHERE hash = ? AND created_at = ?",
    )
    .run(journalEntry.when, latest.hash, latest.created_at);
  return result.changes === 1;
}
