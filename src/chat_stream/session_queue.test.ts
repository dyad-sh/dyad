import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apps, chats } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { acceptChatTurn } from "@/ipc/handlers/chat_turn_acceptance";
import {
  completeSessionQueueAcceptance,
  disposeSessionChatQueue,
  getIntentAcceptance,
  loadChatQueue,
  markIntentTerminal,
  mutateChatQueue,
  persistQueuedIntent,
  persistSessionQueuedIntent,
  stageActiveIntent,
} from "./persistence";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import type { SerializableChatTurnIntent } from "./transport";

const liveOwner = vi.hoisted(() => ({
  pending: [] as unknown[],
  followUpRejected: vi.fn(async () => undefined),
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: {
    getPending: () => liveOwner.pending,
    followUpRejected: liveOwner.followUpRejected,
  },
}));

describe("main-session follow-up queue", () => {
  let database: TestDb;
  let chatId: number;

  beforeEach(() => {
    liveOwner.pending = [];
    liveOwner.followUpRejected.mockClear();
    database = createInMemoryTestDb();
    const appId = database
      .insert(apps)
      .values({ name: "Session Queue", path: "/tmp/session-queue" })
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

  function followUpIntent(): SerializableChatTurnIntent {
    const withoutHash = {
      schemaVersion: 1 as const,
      intentId: "follow-up-race",
      chatId,
      invocationRef: {
        kind: "chat-stream" as const,
        entityKey: chatId,
        operationId: "follow-up-race-operation",
      },
      prompt: "Continue safely",
      userInputRequestId: "follow-up-race",
      owner: {
        kind: "user-input-follow-up" as const,
        requestId: "follow-up-race",
      },
    };
    return {
      ...withoutHash,
      payloadHash: computeChatTurnPayloadHash(withoutHash),
    };
  }

  function makeFollowUpDue(): void {
    liveOwner.pending = [
      {
        status: "due",
        descriptor: {
          requestId: "follow-up-race",
          chatId,
          kind: "integration",
        },
        followUpPrompt: "Continue safely",
      },
    ];
  }

  it("persists no owner shell until message acceptance commits", () => {
    const withoutHash = {
      schemaVersion: 1 as const,
      intentId: "follow-up-1",
      chatId,
      invocationRef: {
        kind: "chat-stream" as const,
        entityKey: chatId,
        operationId: "follow-up-operation",
      },
      prompt: "Continue",
      userInputRequestId: "follow-up-1",
      owner: {
        kind: "user-input-follow-up" as const,
        requestId: "follow-up-1",
      },
    };
    const intent: SerializableChatTurnIntent = {
      ...withoutHash,
      payloadHash: computeChatTurnPayloadHash(withoutHash),
    };
    liveOwner.pending = [
      {
        status: "due",
        descriptor: {
          requestId: "follow-up-1",
          chatId,
          kind: "integration",
        },
        followUpPrompt: "Continue",
      },
    ];

    persistSessionQueuedIntent(database, intent);

    expect(loadChatQueue(database, chatId).queue).toMatchObject([
      { intentId: "follow-up-1", persistence: "main-session" },
    ]);

    const accepted = acceptChatTurn(database, {
      chatId,
      storedChatMode: null,
      selectedChatMode: "local-agent",
      content: "Continue",
      userInputRequestId: "follow-up-1",
      chatTurnIntentId: "follow-up-1",
      chatTurnIntent: intent,
    });
    completeSessionQueueAcceptance(intent.intentId);

    expect(accepted.userMessageId).toEqual(expect.any(Number));
    expect(getIntentAcceptance("follow-up-1")).toBe("message-accepted");
    expect(loadChatQueue(database, chatId).queue).toEqual([]);
  });

  it("does not settle a session owner before queue revision validation", async () => {
    const intent = followUpIntent();
    makeFollowUpDue();
    persistSessionQueuedIntent(database, intent);

    await expect(
      mutateChatQueue(database, chatId, {
        type: "mutate-queue",
        mutation: { type: "remove", itemId: intent.intentId },
        expectedQueueRevision: 0,
        mutationId: "stale-remove",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Conflict });

    expect(liveOwner.followUpRejected).not.toHaveBeenCalled();
    expect(loadChatQueue(database, chatId).queue).toMatchObject([
      { intentId: intent.intentId },
    ]);
  });

  it("restores a claimed session entry when owner settlement fails", async () => {
    const intent = followUpIntent();
    makeFollowUpDue();
    persistSessionQueuedIntent(database, intent);
    liveOwner.followUpRejected.mockRejectedValueOnce(
      new Error("owner settlement failed"),
    );

    await expect(
      mutateChatQueue(database, chatId, {
        type: "mutate-queue",
        mutation: { type: "remove", itemId: intent.intentId },
        expectedQueueRevision: 1,
        mutationId: "failed-remove",
      }),
    ).rejects.toThrow("Failed to settle one or more queued message owners");

    expect(loadChatQueue(database, chatId)).toMatchObject({
      queueRevision: 2,
      queue: [{ intentId: intent.intentId }],
    });
  });

  it("validates a blocked clear before settling session owners", async () => {
    const followUp = followUpIntent();
    makeFollowUpDue();
    persistSessionQueuedIntent(database, followUp);
    const planWithoutHash = {
      schemaVersion: 1 as const,
      intentId: "plan-turn",
      chatId,
      invocationRef: {
        kind: "chat-stream" as const,
        entityKey: chatId,
        operationId: "plan-operation",
      },
      prompt: "Implement the plan",
      owner: {
        kind: "plan-handoff" as const,
        handoffId: "handoff",
      },
    };
    persistQueuedIntent(database, {
      ...planWithoutHash,
      payloadHash: computeChatTurnPayloadHash(planWithoutHash),
    });

    await expect(
      mutateChatQueue(database, chatId, {
        type: "mutate-queue",
        mutation: { type: "clear" },
        expectedQueueRevision: 2,
        mutationId: "blocked-clear",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });

    expect(liveOwner.followUpRejected).not.toHaveBeenCalled();
    expect(loadChatQueue(database, chatId).queue).toMatchObject([
      { intentId: followUp.intentId },
      { intentId: "plan-turn" },
    ]);
  });

  it("validates a live due owner before starting an active follow-up", () => {
    const intent = followUpIntent();

    expect(() => stageActiveIntent(database, intent)).toThrowError(
      expect.objectContaining({ kind: DyadErrorKind.NotFound }),
    );

    makeFollowUpDue();
    expect(stageActiveIntent(database, intent)).toBeNull();
    expect(getIntentAcceptance(intent.intentId)).toBe("queued");
  });

  it("finalizes a failed pre-acceptance follow-up without a durable shell", () => {
    const intent = followUpIntent();

    expect(markIntentTerminal(database, intent, false)).toEqual({
      queueRevision: 0,
      queuePaused: false,
      queue: [],
    });
    expect(getIntentAcceptance(intent.intentId)).toBeUndefined();
  });
});
