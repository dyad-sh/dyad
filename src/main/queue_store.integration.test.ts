import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPersistedQueue, writePersistedQueue } from "@/main/queue_store";
import { setDatabaseForTesting } from "@/db";
import { apps, chats } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import type { PersistedQueue, PersistedQueuedMessage } from "@/ipc/types/queue";

let tempDir: string;
let db: TestDb;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-store-test-"));
  db = createInMemoryTestDb();
  setDatabaseForTesting(db);
});

afterEach(() => {
  db.$client.close();
  setDatabaseForTesting(null);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Create an app whose on-disk path is an absolute directory inside tempDir.
 * getDyadAppPath returns absolute paths as-is, so no path mocking is needed.
 */
function createApp(name: string): number {
  const appPath = path.join(tempDir, name);
  fs.mkdirSync(appPath, { recursive: true });
  const row = db
    .insert(apps)
    .values({ name, path: appPath })
    .returning({ id: apps.id })
    .get();
  return row.id;
}

function createChat(appId: number): number {
  const row = db
    .insert(chats)
    .values({ appId })
    .returning({ id: chats.id })
    .get();
  return row.id;
}

function queueFilePath(appName: string, chatId: number): string {
  return path.join(tempDir, appName, ".dyad", "queue", `${chatId}.json`);
}

const sampleItem: PersistedQueuedMessage = {
  id: "item-1",
  prompt: "hello",
  selectedComponents: [
    {
      id: "c1",
      name: "Button",
      relativePath: "src/Button.tsx",
      lineNumber: 10,
      columnNumber: 2,
    },
  ],
};

describe("queue_store", () => {
  it("returns an empty queue when nothing is persisted", async () => {
    expect(await readPersistedQueue()).toEqual({});
  });

  it("round-trips a chat's queue through write + read", async () => {
    const appId = createApp("app1");
    const chatId = createChat(appId);
    const queue: PersistedQueue = { [String(chatId)]: [sampleItem] };

    await writePersistedQueue(queue);

    expect(fs.existsSync(queueFilePath("app1", chatId))).toBe(true);
    expect(await readPersistedQueue()).toEqual(queue);
    // The app's `.dyad/` folder is kept out of git.
    const gitignore = fs.readFileSync(
      path.join(tempDir, "app1", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).toContain(".dyad/");
  });

  it("writes each chat's queue under its own app directory", async () => {
    const app1 = createApp("app1");
    const app2 = createApp("app2");
    const chat1 = createChat(app1);
    const chat2 = createChat(app2);

    await writePersistedQueue({
      [String(chat1)]: [{ id: "a", prompt: "one" }],
      [String(chat2)]: [{ id: "b", prompt: "two" }],
    });

    expect(fs.existsSync(queueFilePath("app1", chat1))).toBe(true);
    expect(fs.existsSync(queueFilePath("app2", chat2))).toBe(true);
  });

  it("removes the file for a chat that is no longer queued", async () => {
    const appId = createApp("app1");
    const chatId = createChat(appId);
    await writePersistedQueue({ [String(chatId)]: [sampleItem] });
    expect(fs.existsSync(queueFilePath("app1", chatId))).toBe(true);

    // Chat's queue is now empty (completed / cleared).
    await writePersistedQueue({});
    expect(fs.existsSync(queueFilePath("app1", chatId))).toBe(false);
    expect(await readPersistedQueue()).toEqual({});
  });

  it("skips and cleans up a corrupt queue file instead of throwing", async () => {
    const appId = createApp("app1");
    const chatId = createChat(appId);
    const filePath = queueFilePath("app1", chatId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{ not valid json");

    expect(await readPersistedQueue()).toEqual({});
  });

  it("cleans up an orphan file whose chat no longer exists", async () => {
    const appId = createApp("app1");
    const chatId = createChat(appId);
    await writePersistedQueue({ [String(chatId)]: [sampleItem] });
    const filePath = queueFilePath("app1", chatId);
    expect(fs.existsSync(filePath)).toBe(true);

    // Delete the chat, leaving the queue file orphaned.
    db.delete(chats).run();

    expect(await readPersistedQueue()).toEqual({});
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("does not persist queues for unknown chats", async () => {
    createApp("app1");
    await writePersistedQueue({ "99999": [sampleItem] });
    expect(await readPersistedQueue()).toEqual({});
  });
});
