// @vitest-environment node
//
// Migrated from e2e-tests/free_agent_quota.spec.ts.
//
// Basic Agent mode (local-agent for non-Pro users) has a 10-message quota per
// 24h window. The e2e drove the UI: mode selector availability and the quota
// banner are renderer concerns (dropped as UI-only); the behaviors covered
// here are the main-process ones the e2e ultimately exercised:
//   - each Basic Agent message consumes quota (tracked on the user message);
//   - once 10 messages are used the quota is exceeded;
//   - the next message falls back to Build mode instead of erroring;
//   - the test-only time-elapse handler resets the quota after >24h;
//   - after a reset, Basic Agent messages stream again and consume quota.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // The e2e ran against a test build; IS_TEST_BUILD (frozen at import) gates
  // the test-only quota time-elapse IPC handler and local server time.
  process.env.E2E_TEST_BUILD = "true";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import {
  getFreeAgentQuotaStatus,
  registerFreeAgentQuotaHandlers,
  FREE_AGENT_QUOTA_LIMIT,
} from "@/ipc/handlers/free_agent_quota_handlers";
import { createFakeIpcEvent } from "@/testing/electron_mock";

const SIMPLE_RESPONSE_TEXT =
  "Hello! I understand your request. This is a simple response from the Basic Agent mode.";

describe("free agent quota (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      // Free user: no Dyad Pro. Keep build as the pinned default so quota
      // fallback has somewhere to land (mirrors po.setUp + build pinning).
      settings: { defaultChatMode: "build" },
    });
    registerFreeAgentQuotaHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("consumes quota per Basic Agent message and falls back to build once exhausted", async () => {
    expect(FREE_AGENT_QUOTA_LIMIT).toBe(10);

    // 1. Send 10 Basic Agent messages to exhaust the quota.
    for (let i = 0; i < FREE_AGENT_QUOTA_LIMIT; i++) {
      const { events, eventsFor, messages } = await harness.streamChat(
        `tc=local-agent/simple-response message ${i + 1}`,
        { requestedChatMode: "local-agent" },
      );
      expect(eventsFor("chat:response:error")).toHaveLength(0);
      // The turn really ran as Basic Agent (local-agent), not build.
      const firstChunk = events.find(
        (e) => e.channel === "chat:response:chunk",
      )!;
      expect(
        (firstChunk.payload as { effectiveChatMode: string }).effectiveChatMode,
      ).toBe("local-agent");
      // The agent streamed the fixture's simple response.
      const assistant = messages[messages.length - 1];
      expect(assistant.role).toBe("assistant");
      expect(assistant.content).toContain(SIMPLE_RESPONSE_TEXT);

      const status = await getFreeAgentQuotaStatus();
      expect(status.messagesUsed).toBe(i + 1);
      expect(status.isQuotaExceeded).toBe(i + 1 >= FREE_AGENT_QUOTA_LIMIT);
    }

    // 2. Quota is now exhausted.
    const exhausted = await getFreeAgentQuotaStatus();
    expect(exhausted.messagesUsed).toBe(10);
    expect(exhausted.isQuotaExceeded).toBe(true);

    // 3. The 11th message does NOT error: chat-mode resolution falls back to
    // build mode (quota-exhausted) and the request succeeds.
    const eleventh = await harness.streamChat(
      "tc=local-agent/simple-response message 11",
      { requestedChatMode: "local-agent" },
    );
    expect(eleventh.eventsFor("chat:response:error")).toHaveLength(0);
    const chunk = eleventh.events.find(
      (e) => e.channel === "chat:response:chunk",
    )!;
    expect(
      (
        chunk.payload as {
          effectiveChatMode: string;
          chatModeFallbackReason?: string;
        }
      ).effectiveChatMode,
    ).toBe("build");
    expect(
      (chunk.payload as { chatModeFallbackReason?: string })
        .chatModeFallbackReason,
    ).toBe("quota-exhausted");
    // Build-mode turn resolved with the chat id (agent turns return early).
    expect(eleventh.result).toBe(harness.chatId);

    // The build-mode message did not consume Basic Agent quota.
    const afterFallback = await getFreeAgentQuotaStatus();
    expect(afterFallback.messagesUsed).toBe(10);
  }, 120_000);

  it("quota resets after 24 hours", async () => {
    // Still exhausted from the previous test.
    const before = await getFreeAgentQuotaStatus();
    expect(before.isQuotaExceeded).toBe(true);

    // Simulate 25 hours passing via the same test-only IPC handler the e2e
    // invoked from the renderer.
    const simulate = h.ipcHandlers.get("test:simulateQuotaTimeElapsed") as (
      event: unknown,
      hoursAgo: number,
    ) => Promise<{ success: boolean }>;
    expect(simulate).toBeDefined();
    const simulateResult = await simulate(createFakeIpcEvent([]), 25);
    expect(simulateResult).toEqual({ success: true });

    // Quota is fresh again (10/10 remaining).
    const after = await getFreeAgentQuotaStatus();
    expect(after.messagesUsed).toBe(0);
    expect(after.isQuotaExceeded).toBe(false);

    // And Basic Agent messages stream again, consuming quota anew.
    const { events, eventsFor, messages } = await harness.streamChat(
      "tc=local-agent/simple-response post-reset message",
      { requestedChatMode: "local-agent" },
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    const firstChunk = events.find((e) => e.channel === "chat:response:chunk")!;
    expect(
      (firstChunk.payload as { effectiveChatMode: string }).effectiveChatMode,
    ).toBe("local-agent");
    const assistant = messages[messages.length - 1];
    expect(assistant.content).toContain(SIMPLE_RESPONSE_TEXT);

    const postReset = await getFreeAgentQuotaStatus();
    expect(postReset.messagesUsed).toBe(1);
    expect(postReset.isQuotaExceeded).toBe(false);
  }, 60_000);
});
