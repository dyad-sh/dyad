import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { messages } from "@/db/schema";
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
      engine: true,
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

  async function lastAssistantContent(chatId: number) {
    const stored = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });
    const assistant = stored.at(-1);
    expect(assistant?.role).toBe("assistant");
    return assistant?.content ?? "";
  }

  // The tests above call the internal `requireAgentToolConsent` directly. These
  // drive the REAL streamed local-agent tool loop: the fake LLM returns an
  // add_dependency tool call, and the loop itself must consult the consent gate
  // before executing. If the loop ever stopped gating add_dependency, the banner
  // would never render and these tests would fail.
  it("gates a streamed add_dependency tool call and runs it after Always allow", async () => {
    writeSettings({ agentToolConsents: { add_dependency: "ask" } });

    const chatId = await harness.createChat();
    harness.mount({ chatId });
    await harness.selectChatMode("local-agent");

    const { send } = await harness.typeInChat(
      "tc=local-agent/add-dependency-invalid",
      { chatId },
    );
    send();

    // Banner rendered from the real tool loop (not a direct consent call).
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Always allow" },
        { timeout: 20_000 },
      ),
    );

    await harness.waitForStreamEnd(chatId);

    await waitFor(() =>
      expect(readSettings().agentToolConsents?.add_dependency).toBe("always"),
    );
    expect(
      harness.bridge.lastInvoke("agent-tool:consent-response")?.args,
    ).toEqual([{ requestId: expect.any(String), decision: "accept-always" }]);

    // Approval let execution proceed into executeAddDependency, which failed on
    // the invalid package name — proving the tool ran past the gate rather than
    // being blocked. The turn then continued to its final text.
    const content = await lastAssistantContent(chatId);
    expect(content).toContain('<dyad-output type="error"');
    expect(content).toContain("Invalid npm package name");
    expect(content).toContain("Dependency step finished.");
  }, 60_000);

  it("blocks a streamed add_dependency tool call when Decline is chosen", async () => {
    writeSettings({ agentToolConsents: { add_dependency: "ask" } });

    const chatId = await harness.createChat();
    harness.mount({ chatId });
    await harness.selectChatMode("local-agent");

    const { send } = await harness.typeInChat("tc=local-agent/add-dependency", {
      chatId,
    });
    send();

    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Decline" },
        { timeout: 20_000 },
      ),
    );

    await harness.waitForStreamEnd(chatId);

    expect(readSettings().agentToolConsents?.add_dependency).toBe("ask");
    expect(
      harness.bridge.lastInvoke("agent-tool:consent-response")?.args,
    ).toEqual([{ requestId: expect.any(String), decision: "decline" }]);

    // Declining threw before executeAddDependency ran, so nothing was installed.
    const content = await lastAssistantContent(chatId);
    expect(content).toContain('<dyad-output type="error"');
    expect(content).toContain("User denied permission for add_dependency");
    expect(content).not.toContain("Successfully installed");
  }, 60_000);
});
