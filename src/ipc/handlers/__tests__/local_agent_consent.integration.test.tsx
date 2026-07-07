import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { readSettings, writeSettings } from "@/main/settings";
import { requireAgentToolConsent } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";

describe("local-agent consent banner (integration)", () => {
  let harness: HybridChatHarness;

  function requestAddDependencyConsent(chatId = harness.chatId) {
    return requireAgentToolConsent(harness.bridge.fakeEvent as any, {
      chatId,
      toolName: "add_dependency",
      toolDescription: "Install npm packages",
      inputPreview: "Install deno",
    });
  }

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        agentToolConsents: { add_dependency: "ask" },
      },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("persists Always allow through the real consent response path", async () => {
    harness.mount();

    const consent = requestAddDependencyConsent();
    fireEvent.click(
      await screen.findByRole("button", { name: "Always allow" }),
    );

    await expect(consent).resolves.toBe(true);
    await waitFor(() =>
      expect(readSettings().agentToolConsents?.add_dependency).toBe("always"),
    );
    await waitFor(
      () =>
        expect(
          screen.queryByRole("button", { name: "Always allow" }),
        ).toBeNull(),
      { timeout: 10_000 },
    );
    expect(
      harness.bridge.lastInvoke("agent-tool:consent-response")?.args,
    ).toEqual([{ requestId: expect.any(String), decision: "accept-always" }]);
  });

  it("allow once permits the current tool run without persisting consent", async () => {
    writeSettings({ agentToolConsents: { add_dependency: "ask" } });

    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const consent = requestAddDependencyConsent(chatId);
    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));

    await expect(consent).resolves.toBe(true);
    expect(readSettings().agentToolConsents?.add_dependency).toBe("ask");
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(
      harness.bridge.lastInvoke("agent-tool:consent-response")?.args,
    ).toEqual([{ requestId: expect.any(String), decision: "accept-once" }]);
  });

  it("decline rejects the tool run and clears the banner", async () => {
    writeSettings({ agentToolConsents: { add_dependency: "ask" } });

    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const consent = requestAddDependencyConsent(chatId);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));

    await expect(consent).resolves.toBe(false);
    await waitFor(
      () =>
        expect(screen.queryByRole("button", { name: "Decline" })).toBeNull(),
      { timeout: 10_000 },
    );
    expect(readSettings().agentToolConsents?.add_dependency).toBe("ask");
    expect(
      harness.bridge.lastInvoke("agent-tool:consent-response")?.args,
    ).toEqual([{ requestId: expect.any(String), decision: "decline" }]);
  });
});
