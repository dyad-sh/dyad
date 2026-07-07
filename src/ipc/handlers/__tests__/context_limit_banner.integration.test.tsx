import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { messages, language_models } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

async function setContextWindow(
  harness: HybridChatHarness,
  contextWindow: number,
) {
  await harness.db
    .update(language_models)
    .set({ context_window: contextWindow })
    .where(eq(language_models.apiName, "test-model"));
}

describe("context limit banner (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      provider: { id: "custom::testing" },
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows the near-limit warning and summarizes into a new chat", async () => {
    await setContextWindow(harness, 128_000);
    const originalChatId = await harness.createChat();
    harness.mount({ chatId: originalChatId });

    const { send } = await harness.typeInChat(
      "tc=context-limit-response [high-tokens=110000]",
      { chatId: originalChatId },
    );
    send();

    await harness.waitForStreamEnd(originalChatId);

    const banner = await screen.findByTestId(
      "context-limit-banner",
      {},
      { timeout: 15_000 },
    );
    expect(banner.textContent).toContain("This chat context is running out");

    fireEvent.click(screen.getByRole("button", { name: /Summarize/ }));

    await waitFor(
      () => {
        const newChatId = harness.currentLocation().search.id;
        expect(newChatId).toBeTruthy();
        expect(String(newChatId)).not.toBe(String(originalChatId));
      },
      { timeout: 15_000 },
    );
    await screen.findByText(`Summarize from chat-id=${originalChatId}`, {
      exact: false,
    });

    const newChatId = Number(harness.currentLocation().search.id);
    await harness.waitForStreamEnd(newChatId);

    const newChatMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, newChatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });
    expect(newChatMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(newChatMessages[0].content).toBe(
      `Summarize from chat-id=${originalChatId}`,
    );
    expect(newChatMessages[1].content.replace(/\s+/g, " ")).toContain(
      "More EOM",
    );
  }, 60_000);

  it("shows the long-context cost warning for large context models", async () => {
    await setContextWindow(harness, 1_000_000);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const { send } = await harness.typeInChat(
      "tc=context-limit-response [high-tokens=250000]",
      { chatId },
    );
    send();

    await harness.waitForStreamEnd(chatId);

    const banner = await screen.findByTestId(
      "context-limit-banner",
      {},
      { timeout: 15_000 },
    );
    expect(banner.textContent).toContain("Long chat context costs extra");
  }, 60_000);

  it("does not show the banner while safely within the context window", async () => {
    await setContextWindow(harness, 128_000);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const { send } = await harness.typeInChat(
      "tc=context-limit-response [high-tokens=50000]",
      { chatId },
    );
    const countTokensCallsBeforeSend = harness.bridge.invokeLog.filter(
      (entry) => entry.channel === "chat:count-tokens",
    ).length;
    send();

    await harness.waitForStreamEnd(chatId);

    // The banner renders off the chat:count-tokens query that refetches after
    // the stream ends. Wait for that round-trip to complete (a wall-clock
    // sleep here lets the absence check pass vacuously under load).
    await waitFor(() => {
      const settledAfterSend = harness.bridge.invokeLog.filter(
        (entry) =>
          entry.channel === "chat:count-tokens" && entry.status !== "pending",
      ).length;
      expect(settledAfterSend).toBeGreaterThan(countTokensCallsBeforeSend);
    });
    expect(screen.queryByTestId("context-limit-banner")).toBeNull();
  }, 60_000);
});
