import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { apps, chats, messages, userInputFollowUpHandoffs } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { DyadErrorKind } from "@/errors/dyad_error";
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

  it("acknowledges the handoff in the same transaction as message acceptance", () => {
    db.insert(userInputFollowUpHandoffs)
      .values({
        requestId: "handoff-1",
        ownerSessionId: "session-1",
        chatId,
        prompt: "continue",
        status: "executing",
      })
      .run();

    acceptChatTurn(db, {
      chatId,
      storedChatMode: null,
      selectedChatMode: "build",
      content: "continue",
      userInputRequestId: "handoff-1",
    });

    expect(
      db
        .select()
        .from(userInputFollowUpHandoffs)
        .where(eq(userInputFollowUpHandoffs.requestId, "handoff-1"))
        .get(),
    ).toMatchObject({ status: "acknowledged" });
  });

  it("rejects a handoff acknowledgement with a mismatched durable payload", () => {
    db.insert(userInputFollowUpHandoffs)
      .values({
        requestId: "handoff-1",
        ownerSessionId: "session-1",
        chatId,
        prompt: "continue",
        status: "executing",
      })
      .run();

    let error: unknown;
    try {
      acceptChatTurn(db, {
        chatId,
        storedChatMode: null,
        selectedChatMode: "build",
        content: "different prompt",
        userInputRequestId: "handoff-1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Conflict,
    });
    expect(
      db.select().from(messages).where(eq(messages.chatId, chatId)).all(),
    ).toEqual([]);
    expect(
      db
        .select()
        .from(userInputFollowUpHandoffs)
        .where(eq(userInputFollowUpHandoffs.requestId, "handoff-1"))
        .get(),
    ).toMatchObject({ status: "executing" });
  });
});
