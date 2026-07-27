import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apps, chats } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import {
  disposeSessionChatQueue,
  hydrateChatStreamPersistence,
  loadChatQueue,
  markIntentTerminal,
  mutateChatQueue,
  peekQueueHead,
  persistQueuedIntent,
} from "./persistence";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import type { SerializableChatTurnIntent } from "./transport";

describe("chat stream persistence", () => {
  let database: TestDb;
  let chatId: number;

  beforeEach(() => {
    database = createInMemoryTestDb();
    const appId = database
      .insert(apps)
      .values({ name: "Queue Test", path: "/tmp/queue-test" })
      .returning({ id: apps.id })
      .get().id;
    chatId = database
      .insert(chats)
      .values({ appId })
      .returning({ id: chats.id })
      .get().id;
  });

  afterEach(() => {
    disposeSessionChatQueue(chatId);
    database.$client.close();
  });

  function intent(
    intentId: string,
    prompt = "Build it",
    owner?: SerializableChatTurnIntent["owner"],
  ): SerializableChatTurnIntent {
    const envelope = {
      schemaVersion: 1 as const,
      intentId,
      chatId,
      invocationRef: {
        kind: "chat-stream" as const,
        entityKey: chatId,
        operationId: `operation-${intentId}`,
      },
      prompt,
      owner,
    };
    return {
      ...envelope,
      payloadHash: computeChatTurnPayloadHash(envelope),
    };
  }

  it("keeps an intent and queue revision in main-process memory", () => {
    const queued = persistQueuedIntent(database, intent("turn-1"));

    expect(queued).toMatchObject({
      kind: "queued",
      queueRevision: 1,
      entry: { intentId: "turn-1", persistence: "main-session" },
    });
    expect(loadChatQueue(database, chatId)).toMatchObject({
      queueRevision: 1,
      queuePaused: false,
      queue: [{ intentId: "turn-1" }],
    });
  });

  it("replays the original result for the same immutable intent", () => {
    const turn = intent("turn-1");
    persistQueuedIntent(database, turn);

    expect(persistQueuedIntent(database, turn)).toEqual({
      kind: "replayed",
      acceptance: "queued",
    });
    expect(loadChatQueue(database, chatId).queue).toHaveLength(1);
  });

  it("rejects reuse of an intent id with a different payload", () => {
    persistQueuedIntent(database, intent("turn-1"));

    expect(() =>
      persistQueuedIntent(database, intent("turn-1", "Different")),
    ).toThrowError(expect.objectContaining({ kind: DyadErrorKind.Conflict }));
  });

  it("updates both the queue projection and the intent dispatched later", async () => {
    persistQueuedIntent(database, intent("turn-1"));

    await mutateChatQueue(database, chatId, {
      type: "mutate-queue",
      mutation: {
        type: "edit",
        itemId: "turn-1",
        prompt: "Build the edited version",
      },
      expectedQueueRevision: 1,
      mutationId: "edit-1",
    });

    expect(loadChatQueue(database, chatId).queue[0]?.prompt).toBe(
      "Build the edited version",
    );
    expect(peekQueueHead(database, chatId)?.prompt).toBe(
      "Build the edited version",
    );
  });

  it("does not remove a queued plan implementation from its live handoff", async () => {
    persistQueuedIntent(
      database,
      intent("plan-turn", "Implement it", {
        kind: "plan-handoff",
        handoffId: "handoff-1",
      }),
    );

    await expect(
      mutateChatQueue(database, chatId, {
        type: "mutate-queue",
        mutation: { type: "remove", itemId: "plan-turn" },
        expectedQueueRevision: 1,
        mutationId: "remove-plan",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    expect(loadChatQueue(database, chatId).queue).toMatchObject([
      { intentId: "plan-turn" },
    ]);
  });

  it("removes a queued turn that fails before message acceptance", () => {
    const turn = intent("failed-turn");
    persistQueuedIntent(database, turn);

    const queue = markIntentTerminal(database, turn, false, true);

    expect(queue).toMatchObject({ queueRevision: 2, queue: [] });
    expect(persistQueuedIntent(database, turn)).toEqual({
      kind: "replayed",
      acceptance: "rejected",
    });
  });

  it("does not restore queued work after process-lifetime state is disposed", () => {
    persistQueuedIntent(database, intent("turn-1"));
    disposeSessionChatQueue(chatId);

    const hydrated = hydrateChatStreamPersistence(database, chatId);

    expect(hydrated).toEqual({
      queueRevision: 0,
      queuePaused: false,
      queue: [],
    });
  });
});
