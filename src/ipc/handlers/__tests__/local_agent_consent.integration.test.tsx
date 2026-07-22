import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { mcpClient } from "@/ipc/types/mcp";
import { getTraceLog } from "@/state_machines/trace";

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
    expect(harness.bridge.lastInvoke("user-input:respond")?.args).toEqual([
      {
        requestId: expect.any(String),
        response: { kind: "agent-consent", decision: "accept-always" },
      },
    ]);
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
    expect(harness.bridge.lastInvoke("user-input:respond")?.args).toEqual([
      {
        requestId: expect.any(String),
        response: { kind: "agent-consent", decision: "accept-once" },
      },
    ]);
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
    expect(harness.bridge.lastInvoke("user-input:respond")?.args).toEqual([
      {
        requestId: expect.any(String),
        response: { kind: "agent-consent", decision: "decline" },
      },
    ]);
  });

  it("keeps the local abort signal out of the renderer IPC payload", async () => {
    writeSettings({ agentToolConsents: { add_dependency: "ask" } });
    const abortController = new AbortController();
    const eventBaseline = harness.bridge.sentEvents.length;

    const consent = requireAgentToolConsent(harness.bridge.fakeEvent as any, {
      chatId: harness.chatId,
      toolName: "add_dependency",
      toolDescription: "Install npm packages",
      abortSignal: abortController.signal,
    });

    const requestEvent = harness.bridge.sentEvents
      .slice(eventBaseline)
      .find((event) => event.channel === "agent-tool:consent-request");
    expect(requestEvent?.args[0]).toMatchObject({
      chatId: harness.chatId,
      toolName: "add_dependency",
    });
    expect(requestEvent?.args[0]).not.toHaveProperty("abortSignal");

    abortController.abort();
    await expect(consent).resolves.toBe(false);
  });

  it("clears the consent banner when the main-process waiter aborts", async () => {
    writeSettings({ agentToolConsents: { add_dependency: "ask" } });
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    const abortController = new AbortController();

    const consent = requireAgentToolConsent(harness.bridge.fakeEvent as any, {
      chatId,
      toolName: "add_dependency",
      toolDescription: "Install npm packages",
      abortSignal: abortController.signal,
    });
    await screen.findByRole("button", { name: "Decline" });

    abortController.abort();

    await expect(consent).resolves.toBe(false);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Decline" })).toBeNull(),
    );
    expect(
      harness.bridge.sentEvents.some(
        (event) => event.channel === "agent-tool:consent-resolved",
      ),
    ).toBe(true);
  });

  it("keeps classifier approval when a legacy decline arrives afterward", async () => {
    let approve!: (value: { approved: boolean; reason?: string }) => void;
    const classification = new Promise<{ approved: boolean; reason?: string }>(
      (resolve) => {
        approve = resolve;
      },
    );
    const eventBaseline = harness.bridge.sentEvents.length;
    const traceBaseline = getTraceLog("user_input").length;
    const consent = requireMcpToolConsent(harness.bridge.fakeEvent as any, {
      serverId: 999,
      serverName: "race-server",
      toolName: "safe-tool",
      chatId: harness.chatId,
      autoApprove: () => classification,
    });
    let request: (typeof harness.bridge.sentEvents)[number] | undefined;
    await vi.waitFor(() => {
      request = harness.bridge.sentEvents
        .slice(eventBaseline)
        .find((event) => event.channel === "mcp:tool-consent-request");
      expect(request).toBeDefined();
    });
    if (!request) throw new Error("Missing MCP consent request event");
    const requestId = (request.args[0] as { requestId: string }).requestId;

    approve({ approved: true, reason: "safe" });
    await vi.waitFor(() =>
      expect(
        getTraceLog("user_input")
          .slice(traceBaseline)
          .some((entry) => entry.to === "settled"),
      ).toBe(true),
    );
    await mcpClient.respondToConsent({ requestId, decision: "decline" });

    await expect(consent).resolves.toEqual({
      approved: true,
      autoApprovedReason: "safe",
    });
    expect(
      getTraceLog("user_input")
        .slice(traceBaseline)
        .some((entry) => entry.ignoredReason === "already-settled"),
    ).toBe(true);
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
    expect(harness.bridge.lastInvoke("user-input:respond")?.args).toEqual([
      {
        requestId: expect.any(String),
        response: { kind: "agent-consent", decision: "accept-always" },
      },
    ]);

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
    expect(harness.bridge.lastInvoke("user-input:respond")?.args).toEqual([
      {
        requestId: expect.any(String),
        response: { kind: "agent-consent", decision: "decline" },
      },
    ]);

    // Declining threw before executeAddDependency ran, so nothing was installed.
    const content = await lastAssistantContent(chatId);
    expect(content).toContain('<dyad-output type="error"');
    expect(content).toContain("User denied permission for add_dependency");
    expect(content).not.toContain("Successfully installed");
  }, 60_000);

  it("rehydrates a consent banner after the renderer remounts mid-stream", async () => {
    writeSettings({ agentToolConsents: { add_dependency: "ask" } });

    const chatId = await harness.createChat();
    const firstRenderer = harness.mount({ chatId });
    await harness.selectChatMode("local-agent");

    const { send } = await harness.typeInChat("tc=local-agent/add-dependency", {
      chatId,
    });
    send();
    await screen.findByRole(
      "button",
      { name: "Always allow" },
      {
        timeout: 20_000,
      },
    );

    // The stream is parked main-side. Recreate the renderer with a fresh Jotai
    // store; no legacy event is replayed, so only getPending can restore this.
    firstRenderer.unmount();
    harness.mount({ chatId });
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
    expect(harness.bridge.lastInvoke("user-input:get-pending")?.status).toBe(
      "fulfilled",
    );
    expect(harness.bridge.lastInvoke("user-input:respond")?.args).toEqual([
      {
        requestId: expect.any(String),
        response: { kind: "agent-consent", decision: "accept-always" },
      },
    ]);
  }, 60_000);

  it("cancels promptly while a streamed tool is waiting for consent", async () => {
    writeSettings({ agentToolConsents: { add_dependency: "ask" } });

    const chatId = await harness.createChat();
    harness.mount({ chatId });
    await harness.selectChatMode("local-agent");

    const { send } = await harness.typeInChat("tc=local-agent/add-dependency", {
      chatId,
    });
    send();

    // Prove the real tool loop is parked on its unresolved consent promise.
    await screen.findByRole("button", { name: "Decline" }, { timeout: 20_000 });
    const cancelButton = await screen.findByLabelText(
      /^(cancelGeneration|Cancel generation)$/,
      {},
      { timeout: 20_000 },
    );

    fireEvent.click(cancelButton);

    const endEvent = await harness.waitForStreamEnd(chatId, 10_000);
    expect(endEvent.payload).toMatchObject({
      chatId,
      wasCancelled: true,
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Decline" })).toBeNull(),
    );
  }, 30_000);
});
