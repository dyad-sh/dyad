import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { acceptChatTurn } from "./chat_turn_acceptance";

describe("acceptChatTurn", () => {
  let db: TestDb;
  let chatId: number;

  beforeEach(() => {
    db = createInMemoryTestDb();
    const app = db
      .insert(apps)
      .values({ name: "Latch Test", path: "/tmp/latch-test" })
      .returning({ id: apps.id })
      .get();
    chatId = db
      .insert(chats)
      .values({ appId: app.id })
      .returning({ id: chats.id })
      .get().id;
  });

  afterEach(() => {
    db.$client.close();
  });

  it("uses the winning mode when two stale null snapshots are accepted", () => {
    const first = acceptChatTurn(db, {
      chatId,
      storedChatMode: null,
      selectedChatMode: "build",
      content: "first",
      userInputRequestId: "first-request",
    });
    const second = acceptChatTurn(db, {
      chatId,
      storedChatMode: null,
      selectedChatMode: "ask",
      content: "second",
      userInputRequestId: "second-request",
    });

    expect(first.authoritativeChatMode).toBe("build");
    expect(second.authoritativeChatMode).toBe("build");
    expect(
      db
        .select({ chatMode: chats.chatMode })
        .from(chats)
        .where(eq(chats.id, chatId))
        .get()?.chatMode,
    ).toBe("build");
    expect(
      db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .all(),
    ).toHaveLength(2);
  });
});
