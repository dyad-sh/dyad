import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apps, chats, messages } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerChatHandlers } from "./chat_handlers";

const deletionOrder = vi.hoisted(() => [] as string[]);
// Lets a test observe database state at the moment streams are drained, which
// is where the revoke-vs-stream-union ordering matters.
const drainHooks = vi.hoisted(
  () => ({ onDrain: undefined }) as { onDrain?: () => void },
);

vi.mock("./chat_stream_handlers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./chat_stream_handlers")>();
  return {
    ...actual,
    blockNewStreamsForChat: vi.fn(() => {
      deletionOrder.push("barrier");
      return () => deletionOrder.push("release");
    }),
    cancelActiveStreamsForChat: vi.fn(async () => {
      deletionOrder.push("drain");
      drainHooks.onDrain?.();
      return true;
    }),
  };
});

vi.mock("@/ipc/services/chat_actor_deletion_service", () => ({
  beginChatActorMutation: vi.fn(() => {
    deletionOrder.push("actor-barrier");
    return () => deletionOrder.push("actor-release");
  }),
  settleChatActorsForDeletion: vi.fn(async () => {
    deletionOrder.push("settle-actors");
  }),
}));

vi.mock("@/ipc/services/chat_actor_service", () => ({
  waitForChatActorIdle: vi.fn(async () => {
    deletionOrder.push("drain-actor");
  }),
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: {
    settleChat: vi.fn(async () => {
      deletionOrder.push("settle-input");
    }),
  },
}));

describe("registerChatHandlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    deletionOrder.length = 0;
    drainHooks.onDrain = undefined;
    harness = setupHandlerTestHarness();
    registerChatHandlers();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("does not expose main-process AI message history through get-chat", async () => {
    const appResult = harness.db
      .insert(apps)
      .values({ name: "test-app", path: "test-app" })
      .run();
    const appId = Number(appResult.lastInsertRowid);
    const chatResult = harness.db.insert(chats).values({ appId }).run();
    const chatId = Number(chatResult.lastInsertRowid);

    harness.db
      .insert(messages)
      .values({
        chatId,
        role: "assistant",
        content: "Visible response",
        maxTokensUsed: 123,
        aiMessagesJson: {
          version: 6,
          messages: [
            {
              role: "assistant",
              content: "MAIN_PROCESS_ONLY_SECRET_PAYLOAD",
            },
          ],
        } as any,
      })
      .run();

    const result = await harness.invokeHandler<{
      messages: Array<Record<string, unknown>>;
    }>("get-chat", chatId);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      role: "assistant",
      content: "Visible response",
      totalTokens: 123,
    });
    expect(result.messages[0]).not.toHaveProperty("aiMessagesJson");
    expect(JSON.stringify(result)).not.toContain(
      "MAIN_PROCESS_ONLY_SECRET_PAYLOAD",
    );
  });

  it("sets a chat favorite explicitly and exposes it in chat summaries", async () => {
    const appResult = harness.db
      .insert(apps)
      .values({ name: "favorites-app", path: "favorites-app" })
      .run();
    const appId = Number(appResult.lastInsertRowid);
    const olderChatResult = harness.db
      .insert(chats)
      .values({
        appId,
        title: "Older chat",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      })
      .run();
    const olderChatId = Number(olderChatResult.lastInsertRowid);
    const newerChatResult = harness.db
      .insert(chats)
      .values({
        appId,
        title: "Newer chat",
        createdAt: new Date("2025-01-02T00:00:00Z"),
      })
      .run();
    const newerChatId = Number(newerChatResult.lastInsertRowid);

    const initialSummaries = await harness.invokeHandler<
      Array<{ id: number; isFavorite: boolean }>
    >("get-chats", appId);
    expect(initialSummaries).toEqual([
      expect.objectContaining({ id: newerChatId, isFavorite: false }),
      expect.objectContaining({ id: olderChatId, isFavorite: false }),
    ]);

    await expect(
      harness.invokeHandler("set-chat-favorite", {
        chatId: olderChatId,
        isFavorite: true,
      }),
    ).resolves.toEqual({ isFavorite: true });

    const favoritedSummaries = await harness.invokeHandler<
      Array<{ id: number; isFavorite: boolean }>
    >("get-chats", appId);
    expect(favoritedSummaries).toEqual([
      expect.objectContaining({ id: newerChatId, isFavorite: false }),
      expect.objectContaining({ id: olderChatId, isFavorite: true }),
    ]);

    await expect(
      harness.invokeHandler("get-chat-metadata", olderChatId),
    ).resolves.toEqual(
      expect.objectContaining({ id: olderChatId, isFavorite: true }),
    );

    await expect(
      harness.invokeHandler("set-chat-favorite", {
        chatId: olderChatId,
        isFavorite: false,
      }),
    ).resolves.toEqual({ isFavorite: false });
  });

  it("throws NotFound when favoriting a missing chat", async () => {
    await expect(
      harness.invokeHandler("set-chat-favorite", {
        chatId: 123,
        isFavorite: true,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Chat not found",
    });
  });

  it("holds the stream barrier while actors drain and the chat is deleted", async () => {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "delete-app", path: "delete-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db.insert(chats).values({ appId }).run().lastInsertRowid,
    );

    await harness.invokeHandler("delete-chat", chatId);
    deletionOrder.push(
      (await harness.db.query.chats.findFirst({
        where: (row, { eq }) => eq(row.id, chatId),
      }))
        ? "row-present"
        : "row-deleted",
    );

    expect(deletionOrder).toEqual([
      "actor-barrier",
      "barrier",
      "settle-input",
      "settle-actors",
      "drain-actor",
      "drain",
      "release",
      "actor-release",
      "row-deleted",
    ]);
  });

  it("drains an admitting actor before deleting chat messages", async () => {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "clear-app", path: "clear-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db.insert(chats).values({ appId }).run().lastInsertRowid,
    );
    harness.db
      .insert(messages)
      .values({ chatId, role: "user", content: "delete me" })
      .run();

    await harness.invokeHandler("delete-messages", chatId);

    expect(deletionOrder).toEqual([
      "actor-barrier",
      "barrier",
      "drain-actor",
      "drain",
      "release",
      "actor-release",
    ]);
    await expect(
      harness.db.query.messages.findMany({
        where: (row, { eq }) => eq(row.chatId, chatId),
      }),
    ).resolves.toEqual([]);
  });

  it("clears sticky referenced apps in the same transaction as the messages", async () => {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "sticky-app", path: "sticky-app" })
        .run().lastInsertRowid,
    );
    const referencedAppId = Number(
      harness.db
        .insert(apps)
        .values({ name: "other-app", path: "other-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db
        .insert(chats)
        .values({ appId, referencedAppIds: [referencedAppId] })
        .run().lastInsertRowid,
    );
    harness.db
      .insert(messages)
      .values({ chatId, role: "user", content: "@app:other-app what is this?" })
      .run();

    await harness.invokeHandler("delete-messages", chatId);

    // Read access must not outlive the history that granted it: an empty chat
    // that still carries referenced ids would keep cross-app reads alive with
    // nothing on screen explaining why.
    expect(readStoredIds(chatId)).toEqual([]);
    await expect(
      harness.db.query.messages.findMany({
        where: (row, { eq }) => eq(row.chatId, chatId),
      }),
    ).resolves.toEqual([]);
  });

  it("revokes a referenced app only after the in-flight turn has drained", async () => {
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "revoke-app", path: "revoke-app" })
        .run().lastInsertRowid,
    );
    const detachedAppId = Number(
      harness.db
        .insert(apps)
        .values({ name: "detached-app", path: "detached-app" })
        .run().lastInsertRowid,
    );
    const keptAppId = Number(
      harness.db
        .insert(apps)
        .values({ name: "kept-app", path: "kept-app" })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db
        .insert(chats)
        .values({ appId, referencedAppIds: [detachedAppId, keptAppId] })
        .run().lastInsertRowid,
    );

    drainHooks.onDrain = () => {
      deletionOrder.push(`ids-at-drain:${readStoredIds(chatId).join(",")}`);
    };

    await harness.invokeHandler("remove-chat-referenced-app", {
      chatId,
      appId: detachedAppId,
    });

    // The revoking write lands after the drain, so a stream that resolved the
    // whole reference set before the removal cannot persist it back.
    expect(deletionOrder).toEqual([
      "actor-barrier",
      "barrier",
      "drain-actor",
      "drain",
      `ids-at-drain:${detachedAppId},${keptAppId}`,
      "release",
      "actor-release",
    ]);
    expect(readStoredIds(chatId)).toEqual([keptAppId]);
  });

  it("throws NotFound when detaching a referenced app from a missing chat", async () => {
    await expect(
      harness.invokeHandler("remove-chat-referenced-app", {
        chatId: 4242,
        appId: 1,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Chat not found",
    });
  });

  function readStoredIds(chatId: number): number[] {
    return (
      harness.db
        .select({ referencedAppIds: chats.referencedAppIds })
        .from(chats)
        .where(eq(chats.id, chatId))
        .get()?.referencedAppIds ?? []
    );
  }
});
