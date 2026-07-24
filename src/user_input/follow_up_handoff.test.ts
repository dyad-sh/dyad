import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { apps, chats, userInputFollowUpHandoffs } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { createUserInputFollowUpHandoffStore } from "./follow_up_handoff";

describe("durable user-input follow-up handoff", () => {
  let db: TestDb;
  let chatId: number;
  const payload = () => ({
    requestId: "integration:durable",
    chatId,
    prompt: "Continue after integration",
  });

  beforeEach(() => {
    db = createInMemoryTestDb();
    const app = db
      .insert(apps)
      .values({ name: "Handoff Test", path: "/tmp/handoff-test" })
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

  const record = () =>
    db
      .select()
      .from(userInputFollowUpHandoffs)
      .where(eq(userInputFollowUpHandoffs.requestId, payload().requestId))
      .get();

  it("deduplicates receiver acceptance by stable request id", () => {
    const store = createUserInputFollowUpHandoffStore(db, "session-1");
    store.recoverOwnerSession();
    store.create(payload());
    store.accept(payload());
    store.accept(payload());

    expect(record()).toMatchObject({
      schemaVersion: 1,
      ownerSessionId: "session-1",
      status: "accepted",
      attemptCount: 0,
    });
  });

  it("returns a failed execution to an accepted retryable state", () => {
    const store = createUserInputFollowUpHandoffStore(db, "session-1");
    store.create(payload());
    store.accept(payload());
    store.beginExecution(payload().requestId);
    store.retry(payload().requestId, "dispatch failed");

    expect(record()).toMatchObject({
      status: "accepted",
      attemptCount: 1,
      lastError: "dispatch failed",
    });
  });

  it("rejects unfinished records when their memory-only owner session is gone", () => {
    const oldStore = createUserInputFollowUpHandoffStore(db, "old-session");
    oldStore.create(payload());
    oldStore.accept(payload());

    const restartedStore = createUserInputFollowUpHandoffStore(
      db,
      "new-session",
    );
    restartedStore.recoverOwnerSession();

    expect(record()).toMatchObject({
      status: "rejected",
      lastError: "owning main-process session ended",
    });
    expect(record()?.settledAt).toBeInstanceOf(Date);
  });
});
