import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPersistedQueue } from "@/main/queue_store";
import { setDatabaseForTesting } from "@/db";
import { apps, chats } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import type { PersistedQueuedMessage } from "@/ipc/types/queue";

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
};

describe("queue_store", () => {
  it("returns an empty queue when nothing is persisted", async () => {
    expect(await readPersistedQueue()).toEqual({});
  });

  it("reads a legacy chat queue for one-time import", async () => {
    const appId = createApp("app1");
    const chatId = createChat(appId);
    const filePath = queueFilePath("app1", chatId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([sampleItem]));

    expect(await readPersistedQueue()).toEqual({
      [String(chatId)]: [sampleItem],
    });
  });

  it("skips and cleans up a corrupt queue file instead of throwing", async () => {
    const appId = createApp("app1");
    const chatId = createChat(appId);
    const filePath = queueFilePath("app1", chatId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{ not valid json");

    expect(await readPersistedQueue()).toEqual({});
    // The corrupt file is removed so it doesn't log an error on every startup.
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("removes a queue file that fails schema validation", async () => {
    const appId = createApp("app1");
    const chatId = createChat(appId);
    const filePath = queueFilePath("app1", chatId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([{ wrong: "shape" }]));

    expect(await readPersistedQueue()).toEqual({});
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("cleans up an orphan file whose chat no longer exists", async () => {
    const appId = createApp("app1");
    const chatId = createChat(appId);
    const filePath = queueFilePath("app1", chatId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([sampleItem]));

    // Delete the chat, leaving the queue file orphaned.
    db.delete(chats).run();

    expect(await readPersistedQueue()).toEqual({});
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
