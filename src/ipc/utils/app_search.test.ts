import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDatabaseForTesting } from "@/db";
import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { searchApps } from "./app_search";

describe("searchApps", () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createInMemoryTestDb();
    setDatabaseForTesting(testDb);
  });

  afterEach(() => {
    setDatabaseForTesting(null);
    testDb.$client.close();
  });

  function seedApp(name: string, createdAt = new Date(1_000_000)): number {
    const result = testDb
      .insert(apps)
      .values({ name, path: name, createdAt })
      .run();
    return Number(result.lastInsertRowid);
  }

  function seedChat(appId: number, title: string | null): number {
    const result = testDb.insert(chats).values({ appId, title }).run();
    return Number(result.lastInsertRowid);
  }

  function seedMessage(chatId: number, content: string) {
    testDb
      .insert(messages)
      .values({ chatId, role: "assistant", content })
      .run();
  }

  it("returns only the text around the match for a long message", async () => {
    const appId = seedApp("my-app");
    const chatId = seedChat(appId, "Some chat");
    const before = "b".repeat(5000);
    const after = "a".repeat(5000);
    seedMessage(chatId, `${before}NEEDLE${after}`);

    const results = await searchApps("needle");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: appId,
      name: "my-app",
      matchedChatTitle: "Some chat",
    });
    expect(results[0].matchedChatMessage).toBe(
      `${"b".repeat(100)}NEEDLE${"a".repeat(100)}`,
    );
  });

  it("keeps the start of the message when the match is near the beginning", async () => {
    const chatId = seedChat(seedApp("my-app"), null);
    seedMessage(chatId, `Hi needle ${"x".repeat(500)}`);

    const [result] = await searchApps("needle");

    expect(result.matchedChatMessage).toBe(`Hi needle ${"x".repeat(196)}`);
  });

  it("returns each app once even when many messages match", async () => {
    const appId = seedApp("my-app");
    for (const title of ["first", "second"]) {
      const chatId = seedChat(appId, title);
      seedMessage(chatId, "needle one");
      seedMessage(chatId, "needle two");
    }
    const otherAppId = seedApp("other-app");
    seedMessage(seedChat(otherAppId, "other"), "nothing relevant");

    const results = await searchApps("needle");

    expect(results.map((r) => r.id)).toEqual([appId]);
    expect(results[0].matchedChatMessage).toContain("needle");
  });

  it("matches app names and chat titles, preferring a message match", async () => {
    const nameOnly = seedApp("needle-app", new Date(3_000_000));
    const titleOnly = seedApp("title-app", new Date(2_000_000));
    seedChat(titleOnly, "About the needle");
    const all = seedApp("needle-everything", new Date(1_000_000));
    seedMessage(seedChat(all, "needle chat"), "found the needle here");

    const results = await searchApps("needle");

    expect(results).toEqual([
      {
        id: nameOnly,
        name: "needle-app",
        createdAt: new Date(3_000_000),
        matchedChatTitle: null,
        matchedChatMessage: null,
      },
      {
        id: titleOnly,
        name: "title-app",
        createdAt: new Date(2_000_000),
        matchedChatTitle: "About the needle",
        matchedChatMessage: null,
      },
      {
        id: all,
        name: "needle-everything",
        createdAt: new Date(1_000_000),
        matchedChatTitle: "needle chat",
        matchedChatMessage: "found the needle here",
      },
    ]);
  });

  it("treats %, _ and backslash in the query as literal characters", async () => {
    const percentName = seedApp("100%-app", new Date(4_000_000));
    seedApp("1000-app");
    const underscoreTitle = seedApp("title-app", new Date(3_000_000));
    seedChat(underscoreTitle, "rename snake_case");
    seedChat(seedApp("other-title-app"), "rename snakeXcase");
    const messageApp = seedApp("message-app", new Date(2_000_000));
    const chatId = seedChat(messageApp, null);
    seedMessage(chatId, "progress is 100% done, see snake_case in C:\\temp");
    seedMessage(seedChat(seedApp("other-message-app"), null), "C:/temp");

    expect((await searchApps("100%")).map((r) => r.id)).toEqual([
      percentName,
      messageApp,
    ]);
    expect((await searchApps("snake_case")).map((r) => r.id)).toEqual([
      underscoreTitle,
      messageApp,
    ]);
    const backslashResults = await searchApps("C:\\temp");
    expect(backslashResults.map((r) => r.id)).toEqual([messageApp]);
    expect(backslashResults[0].matchedChatMessage).toContain("C:\\temp");
  });

  it("returns nothing when no app, chat, or message matches", async () => {
    seedMessage(seedChat(seedApp("my-app"), "chat"), "hello world");

    expect(await searchApps("needle")).toEqual([]);
  });
});
