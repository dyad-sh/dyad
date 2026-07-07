import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("chat input proposal gating (integration)", () => {
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

  it.each([
    {
      actionTestId: "approve-proposal-button",
      label: "approve",
    },
    {
      actionTestId: "reject-proposal-button",
      label: "reject",
    },
  ])(
    "disables Send while a proposal is pending, then re-enables after $label",
    async ({ actionTestId }) => {
      const chatId = await harness.createChat();
      harness.mount({ chatId });

      const { send } = await harness.typeInChat("tc=write-index", { chatId });
      send();

      await waitFor(
        () => expect(screen.getByText(/And it's done!/)).toBeTruthy(),
        { timeout: 20_000 },
      );
      await harness.waitForStreamEnd(chatId);

      const proposalButton = await screen.findByTestId(
        actionTestId,
        {},
        { timeout: 15_000 },
      );

      harness.setChatInputValue("test message", { chatId });

      const sendButton = await screen.findByLabelText(
        /^(sendMessage|Send message)$/,
      );
      await waitFor(() =>
        expect((sendButton as HTMLButtonElement).disabled).toBe(true),
      );

      fireEvent.click(proposalButton);

      await waitFor(
        () => expect((sendButton as HTMLButtonElement).disabled).toBe(false),
        { timeout: 15_000 },
      );
    },
    60_000,
  );
});
