// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_read_logs.spec.ts.
//
// Exercises the local-agent read_logs tool: the fixture streams three
// read_logs tool calls with different filters (all, level=error + limit,
// type=client). The real tool executes against the central log store (empty —
// same as the e2e, where no preview app was running) and the completed
// <dyad-read-logs> XML lands in the assistant message. The e2e asserted the
// rendered "Reading N logs" cards; here we assert the same tool XML +
// narration text directly from the persisted message content.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const engineServer = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `${engineServer.url}/gateway/v1`;
  return { ipcHandlers: new Map(), engineServer };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("local-agent read_logs (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        enableCodeExplorer: false,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await h.engineServer.close();
  });

  it("reads logs with various filters", async () => {
    const { messages, eventsFor } = await harness.streamChat(
      "tc=local-agent/read-logs",
      { requestedChatMode: "local-agent" },
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);

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
  }, 30_000);
});
