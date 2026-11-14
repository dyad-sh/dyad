import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { readSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

async function clickComposerMenuItem(name: string) {
  fireEvent.click(await screen.findByTestId("auxiliary-actions-menu"));
  const item = await screen.findByRole("menuitem", { name });
  fireEvent.pointerDown(item);
  fireEvent.pointerUp(item);
  fireEvent.click(item);
}

describe("token usage setting (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("saves the toggle in user settings and restores it in a new renderer", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    await screen.findByTestId("auxiliary-actions-menu");
    expect(screen.queryByTestId("token-bar")).toBeNull();
    expect(readSettings().showTokenBar).toBeUndefined();

    await clickComposerMenuItem("Show token usage");
    await screen.findByTestId("token-bar");
    await waitFor(() => expect(readSettings().showTokenBar).toBe(true));

    cleanup();
    harness.mount({ chatId });
    await screen.findByTestId("token-bar");

    await clickComposerMenuItem("Hide token usage");
    await waitFor(() => expect(screen.queryByTestId("token-bar")).toBeNull());
    await waitFor(() => expect(readSettings().showTokenBar).toBe(false));

    cleanup();
    harness.mount({ chatId });
    await screen.findByTestId("auxiliary-actions-menu");
    expect(screen.queryByTestId("token-bar")).toBeNull();
  });
});
