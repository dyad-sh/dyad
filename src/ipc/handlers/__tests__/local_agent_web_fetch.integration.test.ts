// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_web_fetch.spec.ts.
//
// Runs the local agent (Agent v2) loop against the fake LLM server's
// `tc=local-agent/web-fetch` fixture: the model calls the web_fetch tool
// (which hits the Dyad engine's /tools/web-crawl endpoint) and then replies
// with a summary. web_fetch has defaultConsent "always", so no consent flow
// is involved.
//
// The web_fetch tool requires Dyad Pro (isEnabled: ctx.isDyadPro) and calls
// the engine via DYAD_ENGINE_URL, which engine_fetch captures at module
// import. So we reserve an ephemeral port inside the hoisted block (before
// app modules load) and start a second fake-LLM server on it in beforeAll.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const net = await import("node:net");
  const enginePort: number = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
  process.env.DYAD_ENGINE_URL = `http://127.0.0.1:${enginePort}/engine/v1`;
  return { ipcHandlers: new Map(), enginePort };
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
  startFakeLlmServer,
  type FakeLlmServerHandle,
} from "../../../../testing/fake-llm-server/index";

describe("local agent web_fetch (integration)", () => {
  let harness: ChatFlowHarness;
  let engineServer: FakeLlmServerHandle;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
    engineServer = await startFakeLlmServer({ port: h.enginePort });
  }, 30_000);

  afterAll(async () => {
    await engineServer?.close();
    await harness?.dispose();
  });

  it("fetches web page content via the web_fetch tool", async () => {
    const { messages, events, eventsFor } = await harness.streamChat(
      "tc=local-agent/web-fetch",
    );
    // The local-agent branch of chat:stream returns void; success is signaled
    // by the stream-end event and the absence of error events.
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(events.map((e) => e.channel)).toContain("chat:stream:end");

    const assistant = messages.find((m) => m.role === "assistant")!;
    // Turn 0 intro text.
    expect(assistant.content).toContain(
      "I'll fetch the content of that page for you.",
    );
    // The completed web-fetch tool card for the fixture's URL.
    expect(assistant.content).toContain(
      "<dyad-web-fetch>https://example.com/docs/getting-started</dyad-web-fetch>",
    );
    // Final summary text after the tool result was fed back to the model.
    expect(assistant.content).toContain(
      "Here's a summary of the page content. The getting started guide covers three main items. Let me know if you need more details!",
    );
  }, 30_000);
});
