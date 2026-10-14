import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { expect, it } from "vitest";

it("adds chat execution identity without changing existing messages", () => {
  const sqlite = new Database(":memory:");
  try {
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
    const addition = migrations.findIndex((migration) =>
      migration.sql.some((sql) => sql.includes("ADD `execution_backend`")),
    );
    expect(addition).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, addition)) {
      for (const sql of migration.sql) sqlite.exec(sql);
    }
    sqlite
      .prepare("INSERT INTO apps (name, path) VALUES (?, ?)")
      .run("fixture", "/tmp/fixture");
    sqlite.prepare("INSERT INTO chats (app_id) VALUES (1)").run();
    const content =
      '<dyad-claude-tool name="Read">historical card</dyad-claude-tool>';
    sqlite
      .prepare(
        "INSERT INTO messages (chat_id, role, content, model) VALUES (1, 'assistant', ?, ?)",
      )
      .run(content, "claude-resolved");
    const messageColumns = sqlite.pragma("table_info(messages)");
    for (const migration of migrations.slice(addition)) {
      for (const sql of migration.sql) {
        sqlite.exec(sql);
        // No intermediate migration should introduce prototype message columns.
        expect(sqlite.pragma("table_info(messages)")).toEqual(messageColumns);
      }
    }
    expect(
      sqlite
        .prepare(
          "SELECT execution_backend, claude_session_id, claude_session_state FROM chats",
        )
        .get(),
    ).toEqual({
      execution_backend: "dyad",
      claude_session_id: null,
      claude_session_state: null,
    });
    sqlite
      .prepare(
        "INSERT INTO chats (app_id, execution_backend, claude_session_id, claude_session_state) VALUES (1, ?, ?, ?)",
      )
      .run("claude-code", "session", "ready");
    expect(
      sqlite
        .prepare(
          "SELECT execution_backend, claude_session_id, claude_session_state FROM chats WHERE id = 2",
        )
        .get(),
    ).toEqual({
      execution_backend: "claude-code",
      claude_session_id: "session",
      claude_session_state: "ready",
    });
    expect(sqlite.prepare("SELECT content, model FROM messages").get()).toEqual(
      { content, model: "claude-resolved" },
    );
  } finally {
    sqlite.close();
  }
});
