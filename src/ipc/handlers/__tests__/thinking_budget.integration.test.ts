// @vitest-environment node
//
// Migrated from e2e-tests/thinking_budget.spec.ts.
//
// The e2e set up Dyad Pro (engine), selected Google Gemini 2.5 Pro, changed the
// Thinking Budget setting between turns, and snapshotted the request body sent
// to the engine: `thinking.budget_tokens` must be 1000 (low), 4000 (medium)
// and -1 (high, dynamic).
//
// IMPORTANT ordering detail: `get_model_client` reads DYAD_ENGINE_URL at
// module-load time (exactly like the real app, where the e2e suite sets it
// before launch). So this file must NOT statically import the harness; it
// starts its own fake-LLM server first, points DYAD_ENGINE_URL/DYAD_GATEWAY_URL
// at it, and only then dynamically imports the harness (which loads the app
// modules). The harness's own fake server still serves the catalog and writes
// the dumps (the dump dir is resolved per-request from env).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import type { ChatFlowHarness } from "@/testing/chat_flow_harness";
import type { UserSettings } from "@/lib/schemas";

describe("thinking budget (integration)", () => {
  let harness: ChatFlowHarness;
  let engineServer: { url: string; close: () => Promise<void> } | undefined;
  let writeSettings: (settings: Partial<UserSettings>) => void;

  beforeAll(async () => {
    const { startFakeLlmServer } =
      await import("../../../../testing/fake-llm-server/index");
    engineServer = await startFakeLlmServer();
    process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
    process.env.DYAD_GATEWAY_URL = `${engineServer.url}/gateway/v1`;

    // Import the app modules only AFTER the engine env vars are set.
    const harnessModule = await import("@/testing/chat_flow_harness");
    const settingsModule = await import("@/main/settings");
    writeSettings = settingsModule.writeSettings;

    harness = await harnessModule.setupChatFlowHarness({
      electronMock: h,
      selectedModel: { provider: "google", name: "gemini-2.5-pro" },
      settings: {
        enableDyadPro: true,
        // Dyad Pro defaults to local-agent mode; the e2e pinned build mode.
        defaultChatMode: "build",
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await engineServer?.close();
    delete process.env.DYAD_ENGINE_URL;
    delete process.env.DYAD_GATEWAY_URL;
  });

  const dumpRequestBody = () => {
    const dump = harness.getServerDump({ type: "request", maskModel: false });
    return dump.parsed.body as Record<string, any>;
  };

  it("streams through the Dyad Pro engine with the gateway-prefixed model", async () => {
    const { result, messages, eventsFor } = await harness.streamChat("tc=1");
    expect(result).toBe(harness.chatId);
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    // e2e-tests/fixtures/engine/1.md — the engine route serves the engine/
    // fixture folder, proving the request really went through the engine.
    expect(messages[1].content.trim()).toBe("1");
  }, 30_000);

  it("low thinking budget sends budget_tokens=1000", async () => {
    writeSettings({ thinkingBudget: "low" });
    await harness.streamChat("[dump] hi");
    const body = dumpRequestBody();
    expect(body.model).toBe("gemini/gemini-2.5-pro");
    expect(body.thinking).toEqual({
      type: "enabled",
      include_thoughts: true,
      budget_tokens: 1000,
    });
  }, 30_000);

  it("medium thinking budget sends budget_tokens=4000", async () => {
    writeSettings({ thinkingBudget: "medium" });
    await harness.streamChat("[dump] hi");
    const body = dumpRequestBody();
    expect(body.thinking).toEqual({
      type: "enabled",
      include_thoughts: true,
      budget_tokens: 4000,
    });
  }, 30_000);

  it("high thinking budget sends budget_tokens=-1 (dynamic)", async () => {
    writeSettings({ thinkingBudget: "high" });
    await harness.streamChat("[dump] hi");
    const body = dumpRequestBody();
    expect(body.thinking).toEqual({
      type: "enabled",
      include_thoughts: true,
      budget_tokens: -1,
    });

    // Canonical masked payload snapshot of the final engine request.
    const masked = harness.getServerDump({ type: "request" });
    expect(masked.parsed.body.model).toBe("[[MODEL]]");
    expect(masked.text).toMatchSnapshot("thinking-budget-high-request");
  }, 30_000);
});
