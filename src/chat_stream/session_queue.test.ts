import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apps, chatQueueEntries, chatTurnIntents, chats } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { acceptChatTurn } from "@/ipc/handlers/chat_turn_acceptance";
import {
  completeSessionQueueAcceptance,
  loadChatQueue,
  persistSessionQueuedIntent,
} from "./persistence";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import type { SerializableChatTurnIntent } from "./transport";

const liveOwner = vi.hoisted(() => ({
  pending: [] as unknown[],
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: {
    getPending: () => liveOwner.pending,
    followUpRejected: vi.fn(async () => undefined),
  },
}));

describe("main-session follow-up queue", () => {
  let database: TestDb;
  let chatId: number;

  beforeEach(() => {
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

  afterEach(() => database.$client.close());

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

    expect(database.select().from(chatTurnIntents).all()).toEqual([]);
    expect(database.select().from(chatQueueEntries).all()).toEqual([]);
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
      sessionQueued: true,
    });
    completeSessionQueueAcceptance(intent.intentId);

    expect(accepted.userMessageId).toEqual(expect.any(Number));
    expect(database.select().from(chatTurnIntents).all()).toMatchObject([
      {
        intentId: "follow-up-1",
        acceptance: "message-accepted",
        recovery: "started",
      },
    ]);
    expect(loadChatQueue(database, chatId).queue).toEqual([]);
  });
});
