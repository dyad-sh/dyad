// @vitest-environment node
//
// Migrated from e2e-tests/mention_app.spec.ts.
//
// Mentioning another app via @app:<name> must pull that app's codebase into
// the LLM request:
//   - without Dyad Pro: as a "# Referenced Apps" user message with inline
//     <dyad-file> blocks;
//   - with Dyad Pro (engine): as dyad_options.mentioned_apps entries, with the
//     current app's files in dyad_options.files (deep smart context is
//     disabled when apps are referenced, so the mode stays "balanced").
//
// The e2e imported "minimal-with-ai-rules" through the import UI; here the
// mentioned app is registered the way an import ends up persisted: a checkout
// of the same fixture on disk plus an apps row pointing at it.
//
// DYAD_ENGINE_URL is read once at module import in get_model_client, and the
// harness's fake-server port is only known later, so (as in the engine
// migration) vi.hoisted starts a tiny HTTP relay on an ephemeral port BEFORE
// app modules load and forwards to the harness's fake server once it exists.
//
// The old e2e snapshots used the full new-app scaffold as the current app; the
// harness uses the minimal fixture, so we snapshot the harness's own masked
// dump and make targeted assertions instead of reusing those blobs.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const { createServer, request } = await import("node:http");
  const shared = {
    ipcHandlers: new Map(),
    relayTarget: "",
    relay: undefined as import("node:http").Server | undefined,
  };
  const relay = createServer((req, res) => {
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { writeSettings } from "@/main/settings";
import { apps, chats } from "@/db/schema";

const MENTIONED_APP = "minimal-with-ai-rules";
const PROMPT = `[dump] @app:${MENTIONED_APP} hi`;

interface MentionedAppFilesDump {
  headers: { authorization?: string };
  body: {
    model: string;
    dyad_options?: {
      files?: Array<{ path: string; content: string; force?: boolean }>;
      versioned_files?: unknown;
      enable_smart_files_context?: boolean;
      smart_context_mode?: string;
      mentioned_apps?: Array<{
        appName: string;
        files: Array<{ path: string; content: string }>;
      }>;
    };
  };
}

describe("mention app (integration)", () => {
  let harness: ChatFlowHarness;
  let mentionedAppRoot: string;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      settings: {
        // The e2e pinned "build" chat mode (Pro would otherwise default a
        // fresh chat to the agent mode).
        defaultChatMode: "build",
      },
    });
    h.relayTarget = harness.fakeLlmUrl;

    // Register the mentioned app: a real checkout of the same fixture the e2e
    // imported, plus its apps row (absolute path, as the importer persists).
    mentionedAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mention-app-"));
    const mentionedAppDir = path.join(mentionedAppRoot, MENTIONED_APP);
    fs.cpSync(
      path.join(process.cwd(), "e2e-tests/fixtures/import-app", MENTIONED_APP),
      mentionedAppDir,
      { recursive: true },
    );
    await harness.db
      .insert(apps)
      .values({ name: MENTIONED_APP, path: mentionedAppDir });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    h.relay?.close();
    delete process.env.DYAD_ENGINE_URL;
    delete process.env.DYAD_GATEWAY_URL;
    if (mentionedAppRoot) {
      fs.rmSync(mentionedAppRoot, { recursive: true, force: true });
    }
  });

  it("mention app (without pro) includes the referenced codebase inline", async () => {
    const { result, eventsFor } = await harness.streamChat(PROMPT);
    expect(result).toBe(harness.chatId);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const dump = harness.getServerDump({ type: "all-messages" });

    // The referenced app's codebase rides along as its own user message.
    expect(dump.text).toContain("# Referenced Apps");
    expect(dump.text).toContain(`=== Referenced App: ${MENTIONED_APP} ===`);
    expect(dump.text).toContain(
      '<dyad-file path="src/App.tsx">\nconst App = () => <div>Minimal imported app</div>;',
    );
    expect(dump.text).toContain("There's already AI rules...");
    // The raw prompt (mention included) is still the final user message.
    expect(dump.text.trimEnd()).toMatch(
      /role: user\nmessage: \[dump\] @app:minimal-with-ai-rules hi$/,
    );

    expect(dump.text).toMatchSnapshot("mention-app-without-pro");
  }, 30_000);

  it("mention app (with pro) sends mentioned apps via dyad_options", async () => {
    writeSettings({
      enableDyadPro: true,
      providerSettings: {
        auto: { apiKey: { value: "testdyadkey" } },
      },
      selectedModel: { provider: "auto", name: "auto" },
    });

    // Fresh chat, as in the e2e (the pro test started its own chat).
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();
    const { result, eventsFor } = await harness.streamChat(PROMPT, {
      chatId: chatRow.id,
      requestedChatMode: "build",
    });
    expect(result).toBe(chatRow.id);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const requestDump = harness.getServerDump({
      type: "request",
      maskModel: false,
    }).parsed as unknown as MentionedAppFilesDump;

    // Engine request with the Dyad Pro key and auto model.
    expect(requestDump.headers.authorization).toBe("Bearer testdyadkey");
    expect(requestDump.body.model).toBe("dyad/auto");

    const dyadOptions = requestDump.body.dyad_options!;
    // Referencing another app disables deep smart context: balanced mode with
    // a plain files payload for the current app instead of versioned files.
    expect(dyadOptions.enable_smart_files_context).toBe(true);
    expect(dyadOptions.smart_context_mode).toBe("balanced");
    expect(dyadOptions.versioned_files).toBeUndefined();
    expect(dyadOptions.files!.length).toBeGreaterThan(0);
    expect(dyadOptions.files!.map((f) => f.path)).toContain("src/App.tsx");

    // The mentioned app's codebase is carried in dyad_options.mentioned_apps.
    expect(dyadOptions.mentioned_apps).toHaveLength(1);
    const mentioned = dyadOptions.mentioned_apps![0];
    expect(mentioned.appName).toBe(MENTIONED_APP);
    expect(mentioned.files.map((f) => f.path).sort()).toEqual([
      ".gitignore",
      "AI_RULES.md",
      "index.html",
      "package.json",
      "src/App.tsx",
      "src/main.tsx",
      "src/vite-env.d.ts",
      "tsconfig.app.json",
      "tsconfig.json",
      "tsconfig.node.json",
      "vite.config.ts",
    ]);
    expect(
      mentioned.files.find((f) => f.path === "src/App.tsx")?.content,
    ).toContain("Minimal imported app");
    expect(
      mentioned.files.find((f) => f.path === "AI_RULES.md")?.content,
    ).toContain("There's already AI rules...");
  }, 30_000);
});
