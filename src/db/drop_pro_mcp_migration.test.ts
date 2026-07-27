// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

describe("0042 Pro and MCP cleanup migration", () => {
  it("drops removed structures while preserving message data", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY,
          content TEXT NOT NULL,
          using_free_agent_mode_quota INTEGER,
          retained_metadata TEXT
        );
        CREATE TABLE mcp_servers (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE mcp_tool_consents (id INTEGER PRIMARY KEY, server_id INTEGER);
        INSERT INTO messages
          (id, content, using_free_agent_mode_quota, retained_metadata)
        VALUES (1, 'keep this chat', 1, 'keep this metadata');
      `);

      const migration = fs.readFileSync(
        path.join(process.cwd(), "drizzle", "0042_giant_santa_claus.sql"),
        "utf8",
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) database.exec(statement);
      }

      const tables = database
        .prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN ('mcp_servers', 'mcp_tool_consents')`,
        )
        .all();
      const columns = database
        .prepare("PRAGMA table_info(messages)")
        .all() as Array<{ name: string }>;
      const message = database
        .prepare(
          "SELECT id, content, retained_metadata FROM messages WHERE id = 1",
        )
        .get();

      expect(tables).toEqual([]);
      expect(columns.map((column) => column.name)).toEqual([
        "id",
        "content",
        "retained_metadata",
      ]);
      expect(message).toEqual({
        id: 1,
        content: "keep this chat",
        retained_metadata: "keep this metadata",
      });
    } finally {
      database.close();
    }
  });
});
