import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import {
  loadChatQueue,
  disposeSessionChatQueue,
  hydrateChatStreamPersistence,
  mutateChatQueue,
  persistQueuedIntent,
} from "@/chat_stream/persistence";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";
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
    disposeSessionChatQueue(chatId);
    db.$client.close();
  });

  it("uses the winning mode when two stale null snapshots are accepted", () => {
    const first = acceptChatTurn(db, {
      chatId,
      storedChatMode: null,
      selectedChatMode: "build",
      selectedModel: {
        provider: "openai",
        name: "first-model",
        effortLevel: "high",
      },
      content: "first",
      userInputRequestId: "first-request",
    });
    const second = acceptChatTurn(db, {
      chatId,
      storedChatMode: null,
      selectedChatMode: "ask",
      selectedModel: {
        provider: "anthropic",
        name: "second-model",
        effortLevel: "low",
      },
      content: "second",
      userInputRequestId: "second-request",
    });

    expect(first.authoritativeChatMode).toBe("build");
    expect(second.authoritativeChatMode).toBe("build");
    expect(first.authoritativeModel).toEqual({
      provider: "openai",
      name: "first-model",
      effortLevel: "high",
    });
    expect(second.authoritativeModel).toEqual(first.authoritativeModel);
    expect(
      db
        .select({
          chatMode: chats.chatMode,
          modelSelection: chats.modelSelection,
        })
        .from(chats)
        .where(eq(chats.id, chatId))
        .get(),
    ).toEqual({
      chatMode: "build",
      modelSelection: first.authoritativeModel,
    });
    expect(
      db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .all(),
    ).toHaveLength(2);
  });

  it("returns the current mode and model when the caller snapshot is stale", () => {
    db.update(chats)
      .set({
        chatMode: "ask",
        modelSelection: {
          provider: "auto",
          name: "free-pro",
          effortLevel: "low",
        },
      })
      .where(eq(chats.id, chatId))
      .run();

    const accepted = acceptChatTurn(db, {
      chatId,
      storedChatMode: "build",
      selectedChatMode: "build",
      selectedModel: {
        provider: "openai",
        name: "stale-model",
        effortLevel: "high",
      },
      content: "use the authoritative pair",
    });

    expect(accepted.authoritativeChatMode).toBe("ask");
    expect(accepted.authoritativeModel).toEqual({
      provider: "auto",
      name: "free-pro",
      effortLevel: "low",
    });
  });

  it("marks quota usage in the same transaction as turn acceptance", () => {
    const accepted = acceptChatTurn(db, {
      chatId,
      storedChatMode: null,
      selectedChatMode: "local-agent",
      selectedModel: {
        provider: "auto",
        name: "auto",
        effortLevel: "medium",
      },
      content: "atomic quota turn",
      usingFreeAgentModeQuota: true,
    });

    expect(
      db
        .select({
          id: messages.id,
          usingFreeAgentModeQuota: messages.usingFreeAgentModeQuota,
        })
        .from(messages)
        .where(eq(messages.id, accepted.userMessageId!))
        .get(),
    ).toEqual({
      id: accepted.userMessageId,
      usingFreeAgentModeQuota: true,
    });
  });

  it("compacts reordered queue positions without uniqueness collisions", async () => {
    const intent = (intentId: string): SerializableChatTurnIntent => {
      const envelope = {
        schemaVersion: 1 as const,
        intentId,
        chatId,
        invocationRef: {
          kind: "chat-stream" as const,
          entityKey: chatId,
          operationId: `operation-${intentId}`,
        },
        prompt: intentId,
      };
      return {
        ...envelope,
        payloadHash: computeChatTurnPayloadHash(envelope),
      };
    };
    persistQueuedIntent(db, intent("first"));
    persistQueuedIntent(db, intent("second"));
    persistQueuedIntent(db, intent("third"));
    await mutateChatQueue(db, chatId, {
      type: "mutate-queue",
      mutation: { type: "reorder", itemId: "third", toIndex: 0 },
      expectedQueueRevision: 3,
      mutationId: "reorder-third",
    });

    const thirdIntent = intent("third");
    expect(() =>
      acceptChatTurn(db, {
        chatId,
        storedChatMode: null,
        selectedChatMode: "build",
        selectedModel: {
          provider: "auto",
          name: "auto",
          effortLevel: "medium",
        },
        content: "third",
        chatTurnIntentId: "third",
        chatTurnIntent: thirdIntent,
      }),
    ).not.toThrow();

    expect(
      loadChatQueue(db, chatId).queue.map((entry) => entry.intentId),
    ).toEqual(["first", "second"]);

    disposeSessionChatQueue(chatId);
    expect(
      hydrateChatStreamPersistence(db, chatId).queue.map(
        (entry) => entry.intentId,
      ),
    ).toEqual(["first", "second"]);
    const replay = acceptChatTurn(db, {
      chatId,
      storedChatMode: "build",
      selectedChatMode: "build",
      selectedModel: {
        provider: "auto",
        name: "auto",
        effortLevel: "medium",
      },
      content: "third",
      chatTurnIntentId: "third",
      chatTurnIntent: thirdIntent,
    });
    expect(replay.userMessageId).toBeNull();
    expect(
      db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .all(),
    ).toHaveLength(1);
  });
});
