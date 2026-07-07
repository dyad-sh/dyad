// @vitest-environment node
//
// Migrated from e2e-tests/lm_studio.spec.ts.
//
// The e2e pointed LM_STUDIO_BASE_URL_FOR_TESTING at the fake server's
// /lmstudio route before app launch, selected "lmstudio-model-1", sent "hi"
// and aria-snapshotted the rendered messages.
//
// LM_STUDIO_BASE_URL is a module-level constant frozen when app code is first
// imported, and the harness's fake server port is only known later. To bridge
// that (without touching the harness), vi.hoisted starts a tiny local HTTP
// relay on an ephemeral port BEFORE app modules load, points
// LM_STUDIO_BASE_URL_FOR_TESTING at it, and the relay forwards to the
// harness's fake server once it exists — the same wiring the e2e achieved by
// setting the env var before launching Electron.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const { createServer, request } = await import("node:http");
  const shared = {
    ipcHandlers: new Map(),
    relayTarget: "",
    relayRequests: [] as string[],
    relay: undefined as import("node:http").Server | undefined,
  };
  const relay = createServer((req, res) => {
    shared.relayRequests.push(req.url ?? "");
    if (!shared.relayTarget) {
      res.statusCode = 502;
      res.end("relay target not set");
      return;
    }
    const target = new URL(shared.relayTarget);
    const upstream = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.statusCode = 502;
      res.end("relay error");
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.LM_STUDIO_BASE_URL_FOR_TESTING = `http://127.0.0.1:${port}/lmstudio`;
  shared.relay = relay;
  return shared;
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("lm studio send message (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      // Built-in LM Studio local provider with the model the fake server's
      // /lmstudio/api/v0/models endpoint lists.
      selectedModel: { provider: "lmstudio", name: "lmstudio-model-1" },
    });
    h.relayTarget = harness.fakeLlmUrl;
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    h.relay?.close();
    delete process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
  });

  it("sends a message to LM Studio and processes the response", async () => {
    const { result, messages, eventsFor } = await harness.streamChat("hi");

    expect(result).toBe(harness.chatId);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    expect(messages).toHaveLength(2);
    const userMessage = messages.find((m) => m.role === "user")!;
    const assistantMessage = messages.find((m) => m.role === "assistant")!;
    expect(userMessage.content).toBe("hi");

    // An unmarked prompt gets the fake server's canned <dyad-write> reply;
    // applying it proves the LM Studio route round-tripped.
    expect(assistantMessage.content).toContain('<dyad-write path="file1.txt"');
    expect(assistantMessage.approvalState).toBe("approved");
    expect(harness.appFileExists("file1.txt")).toBe(true);
    expect(harness.readAppFile("file1.txt").trim()).toBe("A file (2)");

    // The request really went through the LM Studio base URL.
    expect(
      h.relayRequests.some((url) =>
        url.startsWith("/lmstudio/v1/chat/completions"),
      ),
    ).toBe(true);
  }, 30_000);
});
