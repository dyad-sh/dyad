import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { writeSettings } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";

const DYAD_PRO_SETTINGS: Partial<UserSettings> = {
  enableDyadPro: true,
  providerSettings: {
    auto: {
      apiKey: { value: "testdyadkey" },
    },
  },
  selectedChatMode: "local-agent",
  defaultChatMode: "local-agent",
};

describe("default chat mode selector (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      chatMode: "local-agent",
      // Dyad Pro settings trigger free-quota fetches; route them to the fake
      // engine instead of the real engine.dyad.sh.
      engine: true,
      settings: { isTestMode: true, ...DYAD_PRO_SETTINGS },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows Agent for a Pro local-agent default", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const selector = await screen.findByTestId("chat-mode-selector");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe("Chat mode: Agent"),
    );
    expect(selector.textContent).toContain("Agent");
  });

  it("shows Build for a non-Pro build default", async () => {
    writeSettings({
      enableDyadPro: false,
      providerSettings: {},
      selectedChatMode: "build",
      defaultChatMode: "build",
    });

    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const selector = await screen.findByTestId("chat-mode-selector");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe("Chat mode: Build"),
    );
    expect(selector.textContent).toContain("Build");
  });
});
