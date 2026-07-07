import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, screen } from "@testing-library/react";

import type { UserSettings } from "@/lib/schemas";
import { writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

const PRO_SETTINGS: Partial<UserSettings> = {
  enableDyadPro: true,
  providerSettings: {
    auto: {
      apiKey: { value: "testdyadkey" },
    },
  },
};

describe("voice-to-text chat input controls (integration)", () => {
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
    writeSettings({
      enableDyadPro: false,
      providerSettings: {},
    });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows an enabled mic button for Pro users", async () => {
    writeSettings(PRO_SETTINGS);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const micButton = await screen.findByRole("button", {
      name: "Voice to text",
    });
    expect(micButton).toBeTruthy();
    expect((micButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the locked mic button for non-Pro users", async () => {
    writeSettings({
      enableDyadPro: false,
      providerSettings: {},
    });
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    expect(
      await screen.findByRole("button", { name: "Voice to text (Pro)" }),
    ).toBeTruthy();
  });
});
