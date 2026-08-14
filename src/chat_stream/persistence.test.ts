import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apps, chats, chatQueueEntries, chatTurnIntents } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import {
  assertQueueSnapshotWithinLimit,
  claimQueueHead,
  disposeSessionChatQueue,
  getAcceptedMessageId,
  getRetainedIntentPayloadBytes,
  hydrateChatStreamPersistence,
  loadChatQueue,
  markIntentAccepted,
  markIntentTerminal,
  mutateChatQueue,
  persistAcceptedChatTurn,
  persistQueuedIntent,
  restoreClaimedQueueHead,
  stageActiveIntent,
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

  it("durably stores an intent and queue revision", () => {
    const queued = persistQueuedIntent(database, intent("turn-1"));

    expect(queued).toMatchObject({
      kind: "queued",
      queueRevision: 1,
      entry: { intentId: "turn-1", persistence: "durable" },
    });
    expect(loadChatQueue(database, chatId)).toMatchObject({
      queueRevision: 1,
      queuePaused: false,
      queue: [{ intentId: "turn-1" }],
    });
  });

  it("cascades queue entries through their parent intents", () => {
    persistQueuedIntent(database, intent("turn-1"));

    database.delete(chats).where(eq(chats.id, chatId)).run();

    expect(database.select().from(chatTurnIntents).all()).toEqual([]);
    expect(database.select().from(chatQueueEntries).all()).toEqual([]);
  });

  it("bounds the aggregate queue projection before transport", () => {
    expect(() =>
      assertQueueSnapshotWithinLimit(
        [
          {
            itemId: "large",
            intentId: "large",
            prompt: "x".repeat(256),
            persistence: "main-session",
            editable: true,
            removable: true,
          },
        ],
        64,
      ),
    ).toThrowError(
      expect.objectContaining({ kind: DyadErrorKind.RateLimited }),
    );
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

  it("releases terminal attachment payloads while retaining replay metadata", () => {
    const turn = {
      ...intent("large-turn"),
      attachments: [
        {
          name: "large.txt",
          type: "text/plain",
          data: "a".repeat(1024 * 1024),
          attachmentType: "chat-context" as const,
        },
      ],
    };
    turn.payloadHash = computeChatTurnPayloadHash(turn);
    persistQueuedIntent(database, turn);
    expect(getRetainedIntentPayloadBytes(turn.intentId)).toBeGreaterThan(
      1024 * 1024,
    );

    markIntentAccepted(turn.intentId, 42);
    markIntentTerminal(database, turn, false);

    expect(getRetainedIntentPayloadBytes(turn.intentId)).toBe(0);
    expect(persistQueuedIntent(database, turn)).toEqual({
      kind: "replayed",
      acceptance: "message-accepted",
      acceptedMessageId: 42,
    });
    expect(() =>
      persistQueuedIntent(database, intent("large-turn", "different")),
    ).toThrowError(expect.objectContaining({ kind: DyadErrorKind.Conflict }));
  });

  it("rejects reuse of an intent id with a different payload", () => {
    persistQueuedIntent(database, intent("turn-1"));

    expect(() =>
      persistQueuedIntent(database, intent("turn-1", "Different")),
    ).toThrowError(expect.objectContaining({ kind: DyadErrorKind.Conflict }));
  });

  it("rejects replay under a different invocation identity", () => {
    const original = intent("turn-1");
    persistQueuedIntent(database, original);
    const replacement = {
      ...original,
      invocationRef: {
        kind: "chat-stream" as const,
        entityKey: chatId,
        operationId: "replacement-operation",
      },
    };

    expect(() =>
      persistQueuedIntent(database, {
        ...replacement,
        payloadHash: computeChatTurnPayloadHash(replacement),
      }),
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
    const claimed = await claimQueueHead(database, chatId);
    expect(claimed).toMatchObject({
      intent: { prompt: "Build the edited version" },
      queue: { queueRevision: 3, queue: [] },
    });
    expect(stageActiveIntent(database, claimed!.intent)).toBeNull();
  });

  it("makes a claimed queue head immutable before asynchronous admission", async () => {
    persistQueuedIntent(database, intent("turn-1", "Original prompt"));

    const claimed = await claimQueueHead(database, chatId);

    expect(claimed?.intent.prompt).toBe("Original prompt");
    expect(loadChatQueue(database, chatId)).toMatchObject({
      queueRevision: 2,
      queue: [],
    });
    await expect(
      mutateChatQueue(database, chatId, {
        type: "mutate-queue",
        mutation: {
          type: "edit",
          itemId: "turn-1",
          prompt: "Stale edit",
        },
        expectedQueueRevision: 2,
        mutationId: "edit-claimed",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
  });

  it("restores a claimed head if the actor becomes busy before dispatch", async () => {
    persistQueuedIntent(database, intent("turn-1"));
    await claimQueueHead(database, chatId);

    await expect(
      restoreClaimedQueueHead(database, chatId, "turn-1"),
    ).resolves.toMatchObject({
      queueRevision: 3,
      queue: [{ intentId: "turn-1" }],
    });
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

  it("clears removable entries while retaining a live plan handoff", async () => {
    persistQueuedIntent(database, intent("ordinary-turn"));
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
        mutation: { type: "clear" },
        expectedQueueRevision: 2,
        mutationId: "clear-removable",
      }),
    ).resolves.toMatchObject({
      queueRevision: 3,
      queue: [{ intentId: "plan-turn", removable: false }],
    });
    expect(getRetainedIntentPayloadBytes("ordinary-turn")).toBe(0);
    expect(getRetainedIntentPayloadBytes("plan-turn")).toBeGreaterThan(0);
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

  it("restores durable queued work paused after process-lifetime disposal", () => {
    persistQueuedIntent(database, intent("turn-1"));
    disposeSessionChatQueue(chatId);

    const hydrated = hydrateChatStreamPersistence(database, chatId);

    expect(hydrated).toEqual({
      queueRevision: 2,
      queuePaused: true,
      queue: [expect.objectContaining({ intentId: "turn-1" })],
    });
  });

  it("restores a claimed durable head paused after a process crash", async () => {
    persistQueuedIntent(database, intent("turn-1"));
    await claimQueueHead(database, chatId);
    disposeSessionChatQueue(chatId);

    expect(hydrateChatStreamPersistence(database, chatId)).toMatchObject({
      queueRevision: 3,
      queuePaused: true,
      queue: [{ intentId: "turn-1", persistence: "durable" }],
    });
  });

  it("quarantines an unusable persisted intent without blocking the chat", () => {
    persistQueuedIntent(database, intent("broken"));
    persistQueuedIntent(database, intent("healthy"));
    database
      .update(chatTurnIntents)
      .set({
        intent: {
          schemaVersion: 999,
        } as unknown as SerializableChatTurnIntent,
      })
      .where(eq(chatTurnIntents.intentId, "broken"))
      .run();
    disposeSessionChatQueue(chatId);

    expect(
      hydrateChatStreamPersistence(database, chatId).queue.map(
        (entry) => entry.intentId,
      ),
    ).toEqual(["healthy"]);
    expect(
      database
        .select()
        .from(chatQueueEntries)
        .where(eq(chatQueueEntries.intentId, "broken"))
        .get(),
    ).toBeUndefined();
  });

  it("restores a claimed head before later queued entries after compaction", async () => {
    const first = intent("first");
    persistQueuedIntent(database, first);
    persistQueuedIntent(database, intent("second"));
    persistQueuedIntent(database, intent("third"));
    persistAcceptedChatTurn(database, first, first.intentId, 1);
    markIntentAccepted(first.intentId, 1);
    await claimQueueHead(database, chatId);
    await mutateChatQueue(database, chatId, {
      type: "mutate-queue",
      mutation: { type: "pause" },
      expectedQueueRevision: 5,
      mutationId: "pause-with-claimed-head",
    });
    disposeSessionChatQueue(chatId);

    expect(
      hydrateChatStreamPersistence(database, chatId).queue.map(
        (entry) => entry.intentId,
      ),
    ).toEqual(["second", "third"]);
  });

  it("does not retain a terminal claimed row after releasing its payload", async () => {
    const turn = intent("terminal-claimed");
    persistQueuedIntent(database, turn);
    await claimQueueHead(database, chatId);
    markIntentTerminal(database, turn, false);
    disposeSessionChatQueue(chatId);

    expect(hydrateChatStreamPersistence(database, chatId).queue).toEqual([]);
  });

  it("does not hydrate terminal receipts into main-process memory", () => {
    const turn = intent("accepted-receipt");
    persistQueuedIntent(database, turn);
    persistAcceptedChatTurn(database, turn, turn.intentId, 42);
    markIntentAccepted(turn.intentId, 42);
    disposeSessionChatQueue(chatId);

    hydrateChatStreamPersistence(database, chatId);
    expect(getAcceptedMessageId(turn.intentId)).toBeUndefined();
  });

  it("restores durable edits, ordering, pause state, and attachments", async () => {
    const first = intent("first", "Original");
    const second = {
      ...intent("second", "Second"),
      attachments: [
        {
          name: "context.txt",
          type: "text/plain",
          data: "data:text/plain;base64,ZHVyYWJsZSBhdHRhY2htZW50",
          attachmentType: "chat-context" as const,
        },
      ],
    };
    second.payloadHash = computeChatTurnPayloadHash(second);
    persistQueuedIntent(database, first);
    persistQueuedIntent(database, second);
    await mutateChatQueue(database, chatId, {
      type: "mutate-queue",
      mutation: {
        type: "edit",
        itemId: "first",
        prompt: "Edited",
      },
      expectedQueueRevision: 2,
      mutationId: "edit-first",
    });
    await mutateChatQueue(database, chatId, {
      type: "mutate-queue",
      mutation: { type: "reorder", itemId: "second", toIndex: 0 },
      expectedQueueRevision: 3,
      mutationId: "reorder-second",
    });
    await mutateChatQueue(database, chatId, {
      type: "mutate-queue",
      mutation: { type: "pause" },
      expectedQueueRevision: 4,
      mutationId: "pause",
    });
    disposeSessionChatQueue(chatId);

    const restored = hydrateChatStreamPersistence(database, chatId);
    expect(restored.queuePaused).toBe(true);
    expect(restored.queue.map((entry) => entry.intentId)).toEqual([
      "second",
      "first",
    ]);
    expect(restored.queue[0]?.attachments).toEqual(second.attachments);
    expect(restored.queue[1]?.prompt).toBe("Edited");
  });

  it("does not restore removed or machine-owned queue entries", async () => {
    persistQueuedIntent(database, intent("ordinary"));
    persistQueuedIntent(
      database,
      intent("plan", "Implement", {
        kind: "plan-handoff",
        handoffId: "handoff",
      }),
    );
    await mutateChatQueue(database, chatId, {
      type: "mutate-queue",
      mutation: { type: "remove", itemId: "ordinary" },
      expectedQueueRevision: 2,
      mutationId: "remove-ordinary",
    });
    disposeSessionChatQueue(chatId);

    expect(hydrateChatStreamPersistence(database, chatId).queue).toEqual([]);
  });
});
