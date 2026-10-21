import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { asc, eq } from "drizzle-orm";

import { messages } from "@/db/schema";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("suggested follow-up prompts (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        enableSuggestedPrompts: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  async function runSuggestedPromptsTurn() {
    const chatId = await harness.createChat();
    harness.mount({ chatId, appId: harness.appId });
    const { send } = await harness.typeInChat(
      "tc=local-agent/suggested-prompts",
      { chatId },
    );
    send();
    await harness.waitForStreamEnd(chatId);
    const strip = await screen.findByTestId("suggested-prompts", undefined, {
      timeout: 20_000,
    });
    return { chatId, strip };
  }

  it("shows the model's follow-up prompts as chips and sends the clicked one", async () => {
    const { chatId, strip } = await runSuggestedPromptsTurn();

    expect(
      within(strip).getByRole("button", { name: "Add a dark mode toggle" }),
    ).toBeTruthy();
    expect(
      within(strip).getByRole("button", {
        name: "Make the homepage text friendlier",
      }),
    ).toBeTruthy();
    // The tag itself never renders inline in the transcript.
    const list = within(screen.getByTestId("messages-list"));
    expect(list.getByText(/added a friendly greeting/i)).toBeTruthy();
    expect(list.queryByText(/dyad-suggested-prompts/)).toBeNull();

    fireEvent.click(
      within(strip).getByRole("button", { name: "Add a dark mode toggle" }),
    );

    await waitFor(() =>
      expect(list.getByText("Add a dark mode toggle")).toBeTruthy(),
    );
    expect(screen.queryByTestId("suggested-prompts")).toBeNull();
    await harness.waitForStreamEnd(chatId);

    const storedMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: [asc(messages.id)],
    });
    expect(storedMessages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(storedMessages[2].content).toBe("Add a dark mode toggle");
    // The canned reply carries no suggestions, so nothing is offered now.
    expect(screen.queryByTestId("suggested-prompts")).toBeNull();
    await harness.bridge.settleInFlight();
  }, 60_000);

  it("hides the chips when dismissed", async () => {
    const { strip } = await runSuggestedPromptsTurn();

    fireEvent.click(
      within(strip).getByRole("button", { name: "Hide suggestions" }),
    );

    expect(screen.queryByTestId("suggested-prompts")).toBeNull();
    await harness.bridge.settleInFlight();
  }, 60_000);
});
