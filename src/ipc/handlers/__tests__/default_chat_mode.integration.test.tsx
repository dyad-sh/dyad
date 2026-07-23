import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { writeSettings } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";
import { ipc } from "@/ipc/types";

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

  it("shows Agent for the implicit non-Pro baseline", async () => {
    writeSettings({
      enableDyadPro: false,
      providerSettings: {},
      selectedChatMode: "build",
      defaultChatMode: undefined,
    });

    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const selector = await screen.findByTestId("chat-mode-selector");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe(
        "Chat mode: Basic Agent",
      ),
    );
  });

  it("shows Build for the implicit Google-only baseline", async () => {
    writeSettings({
      enableDyadPro: false,
      providerSettings: {
        google: { apiKey: { value: "google-key" } },
      },
      selectedChatMode: "build",
      defaultChatMode: undefined,
    });

    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const selector = await screen.findByTestId("chat-mode-selector");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe("Chat mode: Build"),
    );
  });

  it("honors an explicit Agent default for Google-only users", async () => {
    writeSettings({
      enableDyadPro: false,
      providerSettings: {
        google: { apiKey: { value: "google-key" } },
      },
      selectedChatMode: "local-agent",
      defaultChatMode: "local-agent",
    });

    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const selector = await screen.findByTestId("chat-mode-selector");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe(
        "Chat mode: Basic Agent",
      ),
    );
  });

  it("stores automatic chats as implicit and explicit overrides as latched", async () => {
    const implicitChatId = await ipc.chat.createChat({
      appId: harness.appId,
    });
    const explicitChatId = await ipc.chat.createChat({
      appId: harness.appId,
      initialChatMode: "plan",
    });

    const [implicitChat, explicitChat] = await Promise.all([
      harness.db.query.chats.findFirst({
        where: (chats, { eq }) => eq(chats.id, implicitChatId),
      }),
      harness.db.query.chats.findFirst({
        where: (chats, { eq }) => eq(chats.id, explicitChatId),
      }),
    ]);
    expect(implicitChat?.chatMode).toBeNull();
    expect(explicitChat?.chatMode).toBe("plan");
  });
});
