import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apps, chats, messages } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerChatHandlers } from "./chat_handlers";

describe("registerChatHandlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
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
});
