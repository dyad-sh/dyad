import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("multi-chat workspace isolation (hybrid)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("isolates drafts, scroll, and sends across two mounted panes", async () => {
    const firstChatId = harness.chatId;
    const secondChatId = await harness.createChat();
    harness.mountSurface({
      chatId: firstChatId,
      workspaceChatIds: [firstChatId, secondChatId],
    });

    const firstPane = await screen.findByTestId(
      `chat-workspace-pane-${firstChatId}`,
    );
    const secondPane = await screen.findByTestId(
      `chat-workspace-pane-${secondChatId}`,
    );
    const firstMessages = within(firstPane).getByTestId("messages-list");
    const secondMessages = within(secondPane).getByTestId("messages-list");
    firstMessages.scrollTop = 120;
    secondMessages.scrollTop = 480;

    harness.setChatInputValue("first pane draft", { chatId: firstChatId });
    harness.setChatInputValue("second pane draft", { chatId: secondChatId });
    expect(harness.getChatInputValue(firstChatId)).toBe("first pane draft");
    expect(harness.getChatInputValue(secondChatId)).toBe("second pane draft");

    const prompt = "[dump] sent only from the first workspace pane";
    const { send } = await harness.typeInChat(prompt, {
      chatId: firstChatId,
    });
    send();

    await waitFor(() => {
      expect(within(firstPane).getByText(prompt)).toBeTruthy();
      expect(within(secondPane).queryByText(prompt)).toBeNull();
    });
    await harness.waitForStreamEnd(firstChatId);

    expect(harness.getChatInputValue(firstChatId)).toBe("");
    expect(harness.getChatInputValue(secondChatId)).toBe("second pane draft");
    expect(firstMessages.scrollTop).toBe(120);
    expect(secondMessages.scrollTop).toBe(480);
  }, 60_000);
});
