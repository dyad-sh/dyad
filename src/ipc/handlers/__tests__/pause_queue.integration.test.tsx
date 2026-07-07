import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

function queuedCountText(count: number) {
  return new RegExp(`^${count}\\s+Queued`, "i");
}

async function startMediumStream(harness: HybridChatHarness, chatId: number) {
  const { send } = await harness.typeInChat("tc=1 [sleep=medium]", {
    chatId,
  });
  send();
  await screen.findByRole("button", { name: /cancel generation/i });
}

async function queueMessages(
  harness: HybridChatHarness,
  chatId: number,
  messages: string[],
) {
  for (const [index, message] of messages.entries()) {
    await harness.pressEnterInChat(message, { chatId });
    await waitFor(() =>
      expect(screen.getByTestId("queue-header").textContent).toMatch(
        queuedCountText(index + 1),
      ),
    );
  }
}

describe("pause queue (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("prevents dequeuing after the current stream completes", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await startMediumStream(harness, chatId);
    await queueMessages(
      harness,
      chatId,
      Array.from({ length: 4 }, (_, index) => `message ${index + 1}`),
    );

    const queueHeader = screen.getByTestId("queue-header");
    expect(queueHeader.textContent).toMatch(queuedCountText(4));

    fireEvent.click(screen.getByRole("button", { name: /pause queue/i }));
    await screen.findByText("Paused");

    await harness.waitForStreamEnd(chatId);
    expect(queueHeader.textContent).toMatch(queuedCountText(4));
  }, 60_000);

  it("keeps the queue when stopped while paused, then resumes sending", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await startMediumStream(harness, chatId);
    await queueMessages(
      harness,
      chatId,
      Array.from({ length: 4 }, (_, index) => `queued ${index + 1}`),
    );

    const queueHeader = screen.getByTestId("queue-header");
    const stopButton = screen.getByRole("button", {
      name: /cancel generation/i,
    });

    fireEvent.click(screen.getByRole("button", { name: /pause queue/i }));
    await screen.findByText("Paused");

    fireEvent.click(stopButton);
    await waitFor(() =>
      expect(queueHeader.textContent).toMatch(queuedCountText(4)),
    );

    fireEvent.click(screen.getByRole("button", { name: /resume queue/i }));
    await waitFor(() => expect(screen.queryByText("Paused")).toBeNull(), {
      timeout: 15_000,
    });
    await waitFor(
      () => {
        const match = queueHeader.textContent?.match(/(\d+)\s+Queued/i);
        const count = match ? Number(match[1]) : 0;
        expect(count).toBeLessThan(4);
      },
      { timeout: 20_000 },
    );
  }, 60_000);

  it("sends immediately while stopped with a paused queue", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await startMediumStream(harness, chatId);
    await queueMessages(
      harness,
      chatId,
      Array.from({ length: 3 }, (_, index) => `queued ${index + 1}`),
    );

    const queueHeader = screen.getByTestId("queue-header");
    const stopButton = screen.getByRole("button", {
      name: /cancel generation/i,
    });

    fireEvent.click(screen.getByRole("button", { name: /pause queue/i }));
    await screen.findByText("Paused");

    fireEvent.click(stopButton);
    await waitFor(() =>
      expect(queueHeader.textContent).toMatch(queuedCountText(3)),
    );

    await harness.pressEnterInChat("should send immediately", { chatId });

    await screen.findByText("should send immediately");
    expect(queueHeader.textContent).toMatch(queuedCountText(3));
    expect(screen.getByText("Paused")).toBeTruthy();
  }, 60_000);
});
