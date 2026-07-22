import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  drainChatSearchIndexOnce,
  getChatSearchPendingCountForApp,
  resetChatSearchIndexerForTesting,
  startChatSearchIndexer,
  stopChatSearchIndexer,
} from "./chat_search_indexer";
import {
  setupChatSearchTestDb,
  type ChatSearchTestHarness,
} from "./tools/chat_search_spec_utils";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

describe("chat_search_indexer", () => {
  let harness: ChatSearchTestHarness;

  beforeEach(() => {
    harness = setupChatSearchTestDb();
  });

  afterEach(() => {
    resetChatSearchIndexerForTesting();
    harness.dispose();
  });

  function ftsRows(): any[] {
    return harness.testDb.$client
      .prepare(
        `SELECT rowid AS message_id, title, body, app_id, chat_id, role
           FROM chat_search_fts ORDER BY rowid`,
      )
      .all();
  }

  it("creates the FTS table, dirty queues, and triggers via migrations", () => {
    const names = harness.testDb.$client
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE name LIKE 'chat_search%' AND type IN ('table', 'trigger')`,
      )
      .all()
      .map((row: any) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "chat_search_fts",
        "chat_search_dirty_messages",
        "chat_search_dirty_chats",
        "chat_search_meta",
        "chat_search_messages_after_insert",
        "chat_search_messages_after_update",
        "chat_search_messages_after_delete",
        "chat_search_chats_after_title_update",
        "chat_search_chats_after_delete",
      ]),
    );
  });

  it("marks inserted messages dirty and indexes their cleaned projection", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Auth setup");
    const messageId = harness.insertMessage({
      chatId,
      role: "assistant",
      content:
        'We chose magic links. <dyad-write path="src/a.ts">SECRET_BODY</dyad-write>',
    });

    expect(getChatSearchPendingCountForApp(appId, 0)).toBe(1);
    await drainChatSearchIndexOnce();
    expect(getChatSearchPendingCountForApp(appId, 0)).toBe(0);

    const rows = ftsRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].message_id).toBe(messageId);
    expect(rows[0].title).toBe("Auth setup");
    expect(rows[0].body).toContain("magic links");
    expect(rows[0].body).not.toContain("SECRET_BODY");
  });

  it("re-indexes a message when its content is updated", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId);
    const messageId = harness.insertMessage({
      chatId,
      role: "user",
      content: "original words",
    });
    await drainChatSearchIndexOnce();

    harness.testDb.$client
      .prepare(`UPDATE messages SET content = ? WHERE id = ?`)
      .run("replacement words", messageId);
    expect(getChatSearchPendingCountForApp(appId, 0)).toBe(1);
    await drainChatSearchIndexOnce();

    expect(ftsRows()[0].body).toBe("replacement words");
  });

  it("re-projects all of a chat's messages when its title changes", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Old title");
    harness.insertMessage({ chatId, role: "user", content: "first" });
    harness.insertMessage({ chatId, role: "user", content: "second" });
    await drainChatSearchIndexOnce();

    harness.testDb.$client
      .prepare(`UPDATE chats SET title = ? WHERE id = ?`)
      .run("New title", chatId);
    await drainChatSearchIndexOnce();

    const rows = ftsRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.title).toBe("New title");
    }
  });

  it("removes FTS rows when messages and chats are deleted (incl. cascades)", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId);
    const messageId = harness.insertMessage({
      chatId,
      role: "user",
      content: "to be deleted",
    });
    harness.insertMessage({ chatId, role: "user", content: "also deleted" });
    await drainChatSearchIndexOnce();
    expect(ftsRows()).toHaveLength(2);

    harness.testDb.$client
      .prepare(`DELETE FROM messages WHERE id = ?`)
      .run(messageId);
    expect(ftsRows()).toHaveLength(1);

    // App delete cascades to chats and messages.
    harness.testDb.$client.prepare(`DELETE FROM apps WHERE id = ?`).run(appId);
    expect(ftsRows()).toHaveLength(0);
    expect(
      harness.testDb.$client
        .prepare(`SELECT COUNT(*) AS c FROM chat_search_dirty_messages`)
        .get(),
    ).toEqual({ c: 0 });
  });

  it("skips empty projections instead of indexing empty documents", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId);
    harness.insertMessage({
      chatId,
      role: "assistant",
      content: "<think>only hidden reasoning</think>",
    });
    await drainChatSearchIndexOnce();
    expect(ftsRows()).toHaveLength(0);
    expect(getChatSearchPendingCountForApp(appId, 0)).toBe(0);
  });

  it("schedules a full rebuild when the projection version changes", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId);
    harness.insertMessage({ chatId, role: "user", content: "some words" });
    await drainChatSearchIndexOnce();
    expect(getChatSearchPendingCountForApp(appId, 0)).toBe(0);

    harness.testDb.$client
      .prepare(
        `INSERT OR REPLACE INTO chat_search_meta (key, value) VALUES ('projection_version', '0')`,
      )
      .run();
    startChatSearchIndexer();
    stopChatSearchIndexer();

    expect(getChatSearchPendingCountForApp(appId, 0)).toBe(1);
    expect(
      harness.testDb.$client
        .prepare(
          `SELECT value FROM chat_search_meta WHERE key = 'projection_version'`,
        )
        .get(),
    ).not.toEqual({ value: "0" });
    await drainChatSearchIndexOnce();
    expect(getChatSearchPendingCountForApp(appId, 0)).toBe(0);
  });

  it("cleans up orphaned FTS rows at startup", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId);
    harness.insertMessage({ chatId, role: "user", content: "live message" });
    await drainChatSearchIndexOnce();

    // Simulate an orphan slipping past the triggers.
    harness.testDb.$client
      .prepare(
        `INSERT INTO chat_search_fts (rowid, title, body, app_id, chat_id, role,
           message_created_at, is_compaction_summary, projection_truncated)
         VALUES (99999, '', 'orphan body', ?, ?, 'user', 1, 0, 0)`,
      )
      .run(appId, chatId);
    expect(ftsRows()).toHaveLength(2);

    startChatSearchIndexer();
    stopChatSearchIndexer();
    expect(ftsRows()).toHaveLength(1);
  });
});
