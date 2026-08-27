import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { messages } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import {
  CHAT_PROMPT_LENGTH_LIMIT_MESSAGE,
  MAX_CHAT_PROMPT_CHARS,
} from "@/shared/chatAttachmentLimits";

describe("chat input validation (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: false,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("keeps an oversized prompt in the composer and shows its limit", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    const prompt = "a".repeat(MAX_CHAT_PROMPT_CHARS + 1);
    const { send } = await harness.typeInChat(prompt, { chatId });

    send();

    expect(
      await screen.findByText(CHAT_PROMPT_LENGTH_LIMIT_MESSAGE),
    ).toBeTruthy();
    expect(harness.getChatInputValue(chatId)).toBe(prompt);
  });

  it("approves a legacy code proposal through the real ChatInput action", async () => {
    const chatId = await harness.createChat();
    const [assistantMessage] = await harness.db
      .insert(messages)
      .values({
        chatId,
        role: "assistant",
        content:
          '<dyad-write path="src/review-action.txt" description="Add review fixture">approved</dyad-write>',
      })
      .returning({ id: messages.id });

    harness.mount({ chatId });
    fireEvent.click(await screen.findByTestId("approve-proposal-button"));

    await waitFor(async () => {
      const storedMessage = await harness.db.query.messages.findFirst({
        where: eq(messages.id, assistantMessage.id),
      });
      expect(storedMessage?.approvalState).toBe("approved");
    });
    expect(harness.readAppFile("src/review-action.txt")).toBe("approved");
  });

  it("rejects a legacy code proposal through the real ChatInput action", async () => {
    const chatId = await harness.createChat();
    const [assistantMessage] = await harness.db
      .insert(messages)
      .values({
        chatId,
        role: "assistant",
        content:
          '<dyad-write path="src/rejected.txt" description="Reject review fixture">rejected</dyad-write>',
      })
      .returning({ id: messages.id });

    harness.mount({ chatId });
    fireEvent.click(await screen.findByTestId("reject-proposal-button"));

    await waitFor(async () => {
      const storedMessage = await harness.db.query.messages.findFirst({
        where: eq(messages.id, assistantMessage.id),
      });
      expect(storedMessage?.approvalState).toBe("rejected");
    });
    expect(harness.appFileExists("src/rejected.txt")).toBe(false);
  });
});
