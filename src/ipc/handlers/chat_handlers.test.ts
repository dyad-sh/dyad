import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apps, chats, messages } from "@/db/schema";
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
});
