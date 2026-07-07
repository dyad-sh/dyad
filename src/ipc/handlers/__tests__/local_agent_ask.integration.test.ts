// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_ask.spec.ts.
//
// Ask mode for Pro users routes through the local agent in read-only mode.
// Part 1: the ask-read-file fixture runs a read-only sandbox script
// (execute_sandbox_script) that reads src/App.tsx; the completed <dyad-script>
// XML lands in the assistant message. Part 2: a fresh chat sends [dump] and
// the request payload must contain ONLY the read-only toolset.
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
import { chats } from "@/db/schema";

describe("local-agent ask mode (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "ask",
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

  it("runs read-only tools (sandbox read of App.tsx)", async () => {
    const { messages, eventsFor } = await harness.streamChat(
      "tc=local-agent/ask-read-file",
      { requestedChatMode: "ask" },
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe("assistant");
    const content = assistant.content;

    expect(content).toContain(
      "Let me inspect the file in a read-only sandbox.",
    );
    expect(content).toContain(
      "This is a simple React component that renders a div with the text 'Minimal imported app'. The component is exported as the default export.",
    );

    // Completed sandbox-script XML (duration varies, so match loosely).
    expect(content).toMatch(
      /<dyad-script description="Check App\.tsx length" state="finished" truncated="false" execution-ms="\d+">/,
    );
    // The script output is App.tsx's length — verify against the real file.
    const appTsxLength = harness.readAppFile("src/App.tsx").length;
    const payloadMatch = content.match(
      /<dyad-script [^>]*>([\s\S]*?)<\/dyad-script>/,
    );
    expect(payloadMatch).not.toBeNull();
    expect(payloadMatch![1]).toContain(String(appTsxLength));
  }, 30_000);

  it("provides only read-only tools in the request payload", async () => {
    // Fresh chat (mirrors the e2e clicking New Chat) so the dump excludes the
    // sandbox tool result with its nondeterministic execution timing.
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();

    const { eventsFor, getServerDump } = await harness.streamChat("[dump]", {
      chatId: chatRow.id,
      requestedChatMode: "ask",
    });
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const req = getServerDump({ type: "request" });
    expect(req.parsed.body.model).toBe("[[MODEL]]");

    const tools = (req.parsed.body.tools ?? []) as Array<{
      function?: { name: string; description: string };
      name?: string;
    }>;
    const toolNames = tools.map((t) => t.function?.name ?? t.name).sort();
    // The exact read-only toolset the e2e request snapshot asserted.
    expect(toolNames).toEqual([
      "code_search",
      "execute_sandbox_script",
      "grep",
      "list_files",
      "read_file",
      "read_guide",
      "read_logs",
      "run_type_checks",
      "set_chat_summary",
      "web_crawl",
      "web_fetch",
      "web_search",
    ]);
    // Tool descriptions are masked by the harness, keeping the payload
    // snapshot-stable.
    for (const t of tools) {
      const name = t.function?.name ?? t.name;
      const description =
        t.function?.description ?? (t as { description?: string }).description;
      expect(description).toBe(`[[TOOL_DESC:${name}]]`);
    }
  }, 30_000);
});
