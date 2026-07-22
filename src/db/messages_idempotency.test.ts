import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";

describe("message request idempotency", () => {
  let db: TestDb;
  let chatId: number;

  beforeEach(() => {
    db = createInMemoryTestDb();
    const app = db
      .insert(apps)
      .values({ name: "Idempotency Test", path: "/tmp/idempotency-test" })
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

  it("accepts a machine follow-up request id only once per chat", () => {
    const insertFollowUp = () =>
      db
        .insert(messages)
        .values({
          chatId,
          role: "user",
          content: "continue",
          userInputRequestId: "integration:1",
        })
        .onConflictDoNothing({
          target: [messages.chatId, messages.userInputRequestId],
        })
        .returning({ id: messages.id })
        .get();

    expect(insertFollowUp()).toBeDefined();
    expect(insertFollowUp()).toBeUndefined();
  });

  it("continues to allow ordinary messages without request ids", () => {
    const first = db
      .insert(messages)
      .values({ chatId, role: "user", content: "one" })
      .returning({ id: messages.id })
      .get();
    const second = db
      .insert(messages)
      .values({ chatId, role: "user", content: "two" })
      .returning({ id: messages.id })
      .get();

    expect(second.id).not.toBe(first.id);
  });
});
