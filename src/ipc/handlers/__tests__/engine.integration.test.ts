// @vitest-environment node
//
// Migrated from e2e-tests/engine.spec.ts.
//
// Verifies that with Dyad Pro enabled (engine URL + "testdyadkey"), chat
// requests are routed through the Dyad engine with the right gateway model
// ids, auth header and dyad_options for:
//   - Google Gemini 2.5 Pro   -> /engine chat completions, "gemini/..."
//   - OpenAI GPT 5            -> /engine chat completions, "gpt-5"
//   - Anthropic Claude Sonnet -> /engine anthropic messages, "anthropic/..."
//   - auto with smart context (default) and with smart context off
//
// DYAD_ENGINE_URL is read once at module import in get_model_client, and the
// harness's fake-server port is only known later. As in the lm_studio
// migration, vi.hoisted starts a tiny local HTTP relay on an ephemeral port
// BEFORE app modules load, points DYAD_ENGINE_URL at it, and the relay
// forwards to the harness's fake server once it exists — the same wiring the
// e2e achieved by setting the env var before launching Electron.
//
// The old e2e request snapshots used the full new-app scaffold; the harness
// uses the minimal fixture, so we make targeted assertions on the normalized
// request dumps instead of reusing those blobs.
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
  process.env.DYAD_ENGINE_URL = `http://127.0.0.1:${port}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `http://127.0.0.1:${port}/gateway/v1`;
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
import { writeSettings } from "@/main/settings";
import { chats } from "@/db/schema";

interface EngineRequestDump {
  headers: { authorization?: string };
  body: {
    model: string;
    dyad_options?: {
      smart_context_mode?: string;
      versioned_files?: { fileIdToContent: Record<string, string> };
      files?: Array<{ path: string }>;
      enable_lazy_edits?: boolean;
      enable_smart_files_context?: boolean;
    };
    // Responses-API requests use `input` instead of `messages`.
    messages?: unknown[];
    input?: unknown[];
  };
}

describe("engine (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      settings: {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        // setUpDyadPro pinned build mode (Pro users otherwise default to the
        // local agent).
        defaultChatMode: "build",
      },
    });
    h.relayTarget = harness.fakeLlmUrl;
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    h.relay?.close();
    delete process.env.DYAD_ENGINE_URL;
    delete process.env.DYAD_GATEWAY_URL;
  });

  /** Each e2e test used a fresh chat; mirror that so payloads stay isolated. */
  async function streamInFreshChat(model: {
    provider: string;
    name: string;
  }): Promise<{ requestDump: EngineRequestDump }> {
    writeSettings({
      selectedModel: model,
      enableProSmartFilesContextMode: true,
    });
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();
    const { result, eventsFor } = await harness.streamChat(
      "[dump] tc=turbo-edits",
      { chatId: chatRow.id },
    );
    expect(result).toBe(chatRow.id);
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    const requestDump = harness.getServerDump({
      type: "request",
      maskModel: false,
    }).parsed as unknown as EngineRequestDump;
    return { requestDump };
  }

  it("sends message to engine (Google Gemini 2.5 Pro)", async () => {
    const { requestDump } = await streamInFreshChat({
      provider: "google",
      name: "gemini-2.5-pro",
    });

    expect(requestDump.headers.authorization).toBe("Bearer testdyadkey");
    expect(requestDump.body.model).toBe("gemini/gemini-2.5-pro");
    // Smart context is on by default -> deep mode with versioned files.
    const dyadOptions = requestDump.body.dyad_options!;
    expect(dyadOptions.smart_context_mode).toBe("deep");
    expect(dyadOptions.enable_smart_files_context).toBe(true);
    expect(dyadOptions.enable_lazy_edits).toBe(true);
    expect(
      Object.keys(dyadOptions.versioned_files!.fileIdToContent).length,
    ).toBeGreaterThan(0);
    // The engine request hit the /engine chat-completions route via the
    // DYAD_ENGINE_URL env override.
    expect(
      h.relayRequests.some((url) =>
        url.startsWith("/engine/v1/chat/completions"),
      ),
    ).toBe(true);
  }, 30_000);

  it("sends message to engine (OpenAI GPT 5)", async () => {
    const { requestDump } = await streamInFreshChat({
      provider: "openai",
      name: "gpt-5",
    });

    expect(requestDump.headers.authorization).toBe("Bearer testdyadkey");
    // OpenAI has an empty gateway prefix.
    expect(requestDump.body.model).toBe("gpt-5");
    expect(requestDump.body.dyad_options?.smart_context_mode).toBe("deep");
  }, 30_000);

  it("sends message to engine (Anthropic Claude Sonnet 4)", async () => {
    h.relayRequests.length = 0;
    const { requestDump } = await streamInFreshChat({
      provider: "anthropic",
      name: "claude-sonnet-4-20250514",
    });

    expect(requestDump.headers.authorization).toBe("Bearer testdyadkey");
    expect(requestDump.body.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(requestDump.body.dyad_options?.smart_context_mode).toBe("deep");
    // Anthropic engine models go through the /engine messages route.
    expect(
      h.relayRequests.some((url) => url.startsWith("/engine/v1/messages")),
    ).toBe(true);
  }, 30_000);

  it("smart auto sends message to engine (Agent v2 responses route)", async () => {
    // The e2e "smart auto" ran the Pro default mode (Agent v2 / local-agent)
    // with the auto model: the engine resolves dyad/auto/openai from the
    // catalog and calls the /engine responses API with the agent toolset.
    writeSettings({
      selectedModel: { provider: "auto", name: "auto" },
      enableProSmartFilesContextMode: true,
    });
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();
    h.relayRequests.length = 0;
    const { eventsFor } = await harness.streamChat("[dump] tc=turbo-edits", {
      chatId: chatRow.id,
      requestedChatMode: "local-agent",
    });
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const requestDump = harness.getServerDump({
      type: "request",
      maskModel: false,
    }).parsed as unknown as EngineRequestDump & {
      body: { tools?: Array<{ name?: string }> };
    };

    expect(requestDump.headers.authorization).toBe("Bearer testdyadkey");
    // dyad/auto/openai resolves to gpt-5.2 in the fake catalog.
    expect(requestDump.body.model).toBe("gpt-5.2");
    // Responses-API request shape with the agent toolset.
    expect(Array.isArray(requestDump.body.input)).toBe(true);
    const toolNames = (requestDump.body.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("update_todos");
    expect(requestDump.body.dyad_options?.enable_smart_files_context).toBe(
      true,
    );
    expect(
      h.relayRequests.some((url) => url.startsWith("/engine/v1/responses")),
    ).toBe(true);
  }, 30_000);

  it("auto model in build mode with deep smart context routes via engine", async () => {
    const { requestDump } = await streamInFreshChat({
      provider: "auto",
      name: "auto",
    });

    expect(requestDump.headers.authorization).toBe("Bearer testdyadkey");
    expect(requestDump.body.model).toBe("dyad/auto");
    expect(requestDump.body.dyad_options?.smart_context_mode).toBe("deep");
    expect(requestDump.body.dyad_options?.versioned_files).toBeDefined();
  }, 30_000);

  it("regular auto (smart context off) sends message to engine", async () => {
    writeSettings({ enableProSmartFilesContextMode: false });
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();
    writeSettings({ selectedModel: { provider: "auto", name: "auto" } });
    const { result, eventsFor } = await harness.streamChat(
      "[dump] tc=turbo-edits",
      { chatId: chatRow.id },
    );
    expect(result).toBe(chatRow.id);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const requestDump = harness.getServerDump({
      type: "request",
      maskModel: false,
    }).parsed as unknown as EngineRequestDump;

    expect(requestDump.headers.authorization).toBe("Bearer testdyadkey");
    expect(requestDump.body.model).toBe("dyad/auto");
    const dyadOptions = requestDump.body.dyad_options!;
    // Without smart files context: balanced mode, plain files payload, no
    // versioned files.
    expect(dyadOptions.smart_context_mode).toBe("balanced");
    expect(dyadOptions.enable_smart_files_context).toBe(false);
    expect(dyadOptions.versioned_files).toBeUndefined();
    expect(dyadOptions.files!.length).toBeGreaterThan(0);
  }, 30_000);
});
