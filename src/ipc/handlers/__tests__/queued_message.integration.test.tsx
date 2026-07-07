import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

async function startMediumStream(harness: HybridChatHarness, chatId: number) {
  const { send } = await harness.typeInChat("tc=1 [sleep=medium]", { chatId });
  send();
  await screen.findByRole("button", { name: /cancel generation/i });
}

function getEditable() {
  const editable = screen
    .getByTestId("chat-input-container")
    .querySelector('[contenteditable="true"]');
  if (!editable) {
    throw new Error("No chat input contenteditable found");
  }
  return editable;
}

describe("queued messages (integration)", () => {
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
  }, 60_000);

  it("restores and clears queued message attachments and selected components while editing", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await startMediumStream(harness, chatId);

    harness.setChatAttachments([
      {
        name: "queued-notes.txt",
        content: "important queued context",
        mimeType: "text/plain",
      },
    ]);
    harness.setSelectedComponents([
      {
        id: "component-hero",
        name: "HeroTitle",
        relativePath: "src/App.tsx",
        lineNumber: 1,
        columnNumber: 1,
      },
    ]);
    await screen.findByText("queued-notes.txt");
    await screen.findByTestId("selected-component-display");

    await harness.pressEnterInChat("queued with extras", { chatId });
    await waitFor(() =>
      expect(screen.getByTestId("queue-header").textContent).toMatch(
        /^1\s+Queued/i,
      ),
    );
    expect(screen.queryByText("queued-notes.txt")).toBeNull();
    expect(screen.queryByTestId("selected-component-display")).toBeNull();

    const queuedRow = within(screen.getByTestId("queue-header"))
      .getByText("queued with extras")
      .closest("li");
    expect(queuedRow).toBeTruthy();
    fireEvent.click(within(queuedRow!).getByTitle("Edit"));

    await waitFor(() =>
      expect(screen.getByTestId("chat-input-container").textContent).toContain(
        "queued with extras",
      ),
    );
    await screen.findByText("queued-notes.txt");
    const selectedDisplay = await screen.findByTestId(
      "selected-component-display",
    );
    expect(selectedDisplay.textContent).toContain("HeroTitle");
    expect(selectedDisplay.textContent).toContain("src/App.tsx:1");

    fireEvent.keyDown(getEditable(), { key: "Enter", keyCode: 13 });
    await waitFor(() =>
      expect(screen.queryByText("queued-notes.txt")).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("selected-component-display")).toBeNull(),
    );

    await harness.waitForStreamEnd(chatId, 40_000);
    await harness.waitForStreamEnd(chatId, 40_000);
    expect(screen.getByText("queued with extras")).toBeTruthy();
  }, 60_000);
});
