// Migrated from e2e-tests/local_agent_read_logs.spec.ts, then converted from
// the node chat-flow harness to the HYBRID harness (real <ChatPanel> over the
// real IPC stack).
//
// Exercises the local-agent read_logs tool: the fixture streams three
// read_logs tool calls with different filters (all, level=error + limit,
// type=client). The real tool executes against the central log store (empty —
// same as the e2e, where no preview app was running) and the completed
// <dyad-read-logs> XML lands in the assistant message. The e2e asserted the
// rendered "Reading N logs" cards; the hybrid harness renders the same DyadLogs
// cards in the DOM (asserted below), and the tool XML + narration text is also
// asserted from the persisted message content, as in the node version.
//
// Dyad Pro engine setup: the pro model client captures DYAD_ENGINE_URL at
// module load, so a dedicated fake-LLM server is started inside vi.hoisted
// (before any app module is imported) and the env var pointed at it. The
// harness's own server still serves the catalog and dump endpoints; both are
// the same in-process express app and share fixture/dump env resolution.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const engineServer = await vi.hoisted(async () => {
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const engineServer = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `${engineServer.url}/gateway/v1`;
  return engineServer;
});

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("local-agent read_logs (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        enableCodeExplorer: false,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
    await engineServer.close();
  });

  it("reads logs with various filters", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const { send } = await harness.typeInChat("tc=local-agent/read-logs");
    send();

    // The three DyadLogs cards render in the DOM — the same "Reading N logs"
    // surface the e2e asserted. count="0" for each (no preview app running),
    // with the filter summary in the card header.
    await waitFor(
      () => {
        expect(screen.getByText("Reading 0 logs")).toBeTruthy();
        expect(screen.getByText("Reading 0 logs (level: error)")).toBeTruthy();
        expect(screen.getByText("Reading 0 logs (type: client)")).toBeTruthy();
      },
      { timeout: 20_000 },
    );
    // The agent's final narration also renders.
    await waitFor(
      () =>
        expect(
          screen.getByText(
            /The application appears to be running normally with no critical errors detected/,
          ),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );

    // Gate main-side (db) assertions on the real end-of-stream event.
    await harness.waitForStreamEnd(harness.chatId);
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const messages = await harness.db.query.messages.findMany();
    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe("assistant");
    const content = assistant.content;

    // Narration text from each fixture turn.
    expect(content).toContain(
      "Let me check the recent console logs to see what's happening in the application.",
    );
    expect(content).toContain(
      "Now let me filter for only error logs to identify any issues.",
    );
    expect(content).toContain(
      "Let me also check client-side logs specifically.",
    );
    expect(content).toContain(
      "I've reviewed the console logs. The application appears to be running normally with no critical errors detected.",
    );

    // Completed read_logs tool XML for each filter combination. No app is
    // running, so the store is empty (count="0"), matching the e2e which only
    // asserted "Reading \d+ logs".
    expect(content).toMatch(/<dyad-read-logs {2}count="0">/); // type=all, level=all
    expect(content).toMatch(/<dyad-read-logs level="error" count="0">/);
    expect(content).toMatch(/<dyad-read-logs type="client" count="0">/);

    // Filter summaries rendered inside the tags.
    expect(content).toContain(
      "Time: last 5 minutes | Level: error | Limit: 10",
    );
    expect(content).toContain("Time: last 5 minutes | Type: client");
    expect(content).toContain("No logs found matching the specified filters.");

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});
