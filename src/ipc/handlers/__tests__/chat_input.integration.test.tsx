import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, screen } from "@testing-library/react";

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
});
