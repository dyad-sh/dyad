import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { writeSettings } from "@/main/settings";
import { ipc } from "@/ipc/types";

describe("default chat mode selector (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        selectedChatMode: "local-agent",
        defaultChatMode: "local-agent",
      },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows Agent for the default mode", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const selector = await screen.findByTestId("chat-mode-selector");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe("Chat mode: Agent"),
    );
  });

  it("shows an explicit Ask default", async () => {
    writeSettings({
      selectedChatMode: "ask",
      defaultChatMode: "ask",
    });

    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const selector = await screen.findByTestId("chat-mode-selector");
    await waitFor(() =>
      expect(selector.getAttribute("aria-label")).toBe("Chat mode: Ask"),
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
