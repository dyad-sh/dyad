import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apps, chats, messages } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { getPostCompactionMessageStartId } from "./chat_history_query";

describe("getPostCompactionMessageStartId", () => {
  let harness: HandlerTestHarness;
  let chatId: number;

  beforeEach(() => {
    harness = setupHandlerTestHarness();
    const appResult = harness.db
      .insert(apps)
      .values({ name: "test-app", path: "test-app" })
      .run();
    const chatResult = harness.db
      .insert(chats)
      .values({ appId: Number(appResult.lastInsertRowid) })
      .run();
    chatId = Number(chatResult.lastInsertRowid);
  });

  afterEach(() => {
    harness.dispose();
  });

  it("returns undefined when the entire history is still needed", async () => {
    harness.db
      .insert(messages)
      .values({ chatId, role: "user", content: "first" })
      .run();

    await expect(getPostCompactionMessageStartId(chatId)).resolves.toBe(
      undefined,
    );
  });

  it("starts at the summary when no triggering user exists", async () => {
    const summaryResult = harness.db
      .insert(messages)
      .values({
        chatId,
        role: "assistant",
        content: "first message is a compaction summary",
        isCompactionSummary: true,
      })
      .run();

    await expect(getPostCompactionMessageStartId(chatId)).resolves.toBe(
      Number(summaryResult.lastInsertRowid),
    );
  });

  it("starts at the triggering user for the latest compaction", async () => {
    harness.db
      .insert(messages)
      .values([
        { chatId, role: "user", content: "old" },
        {
          chatId,
          role: "assistant",
          content: "old summary",
          isCompactionSummary: true,
        },
        { chatId, role: "user", content: "trigger" },
        { chatId, role: "assistant", content: "placeholder" },
        {
          chatId,
          role: "assistant",
          content: "latest summary",
          isCompactionSummary: true,
        },
      ])
      .run();

    const rows = harness.db
      .select({ id: messages.id, content: messages.content })
      .from(messages)
      .all();
    const triggeringUserId = rows.find((row) => row.content === "trigger")!.id;

    await expect(getPostCompactionMessageStartId(chatId)).resolves.toBe(
      triggeringUserId,
    );
  });
});
