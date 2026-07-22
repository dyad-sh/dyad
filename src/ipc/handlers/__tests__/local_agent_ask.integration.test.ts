// Migrated from e2e-tests/local_agent_ask.spec.ts, then converted from the
// node chat-flow harness to the HYBRID harness (real <ChatPanel> over the real
// IPC stack).
//
// Ask mode for Pro users routes through the local agent in read-only mode.
// Part 1: the ask-read-file fixture runs a read-only sandbox script
// (execute_sandbox_script) that reads src/App.tsx; the completed <dyad-script>
// card renders in the DOM (data-testid="dyad-script-card") and the XML lands
// in the assistant message. Part 2: a fresh chat sends [dump] and the request
// payload must contain ONLY the read-only toolset and preserve the engine auth
// header through the hybrid harness's Node fetch seam.
//
// Dyad Pro engine/gateway calls are routed to the harness fake server via
// `engine: true`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

describe("local-agent ask mode (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "ask",
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
  });

  it("runs read-only tools (sandbox read of App.tsx)", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // Select Ask mode through the REAL chat-mode selector (persists
    // chatMode="ask" onto the chat row). Without this the submit would fall
    // back to the Pro default mode (local-agent) — `chatMode: "ask"` on the
    // harness only seeds settings.selectedChatMode, which per-chat submits
    // don't read for existing chats.
    await harness.selectChatMode("ask");

    const { send } = await harness.typeInChat("tc=local-agent/ask-read-file");
    send();

    // The execute_sandbox_script tool call renders its dyad-script card in the
    // DOM — the same surface the e2e asserted.
    await waitFor(
      () => expect(screen.getByTestId("dyad-script-card")).toBeTruthy(),
      { timeout: 20_000 },
    );
    // The card header shows the script description, and the agent's final
    // narration renders as message text.
    await waitFor(
      () => expect(screen.getByText("Check App.tsx length")).toBeTruthy(),
      { timeout: 20_000 },
    );
    await waitFor(
      () =>
        expect(
          screen.getByText(
            /This is a simple React component that renders a div with the text/,
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

    const messages = await harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, harness.chatId),
      orderBy: [asc(messagesTable.id)],
    });
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
    const appTsxLength = fs.readFileSync(
      path.join(harness.appDir, "src/App.tsx"),
      "utf8",
    ).length;
    const payloadMatch = content.match(
      /<dyad-script [^>]*>([\s\S]*?)<\/dyad-script>/,
    );
    expect(payloadMatch).not.toBeNull();
    expect(payloadMatch![1]).toContain(String(appTsxLength));

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);

  it("provides only read-only tools in the request payload", async () => {
    // Fresh chat (mirrors the e2e clicking New Chat) so the dump excludes the
    // sandbox tool result with its nondeterministic execution timing.
    const chatId = await harness.createChat();

    harness.mount({ chatId });
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // Select Ask mode through the REAL chat-mode selector for this fresh chat
    // (see note in the previous test).
    await harness.selectChatMode("ask");

    // Baseline-aware end gate: the previous it already produced
    // chat:response:end events on this bridge.
    const streamEnd = harness.waitForNextStreamEnd(chatId);
    const { send } = await harness.typeInChat("[dump]", { chatId });
    send();

    // The dump-path marker streams back and renders as the assistant message.
    await waitFor(
      () => expect(screen.getByText(/dyad-dump-path/)).toBeTruthy(),
      { timeout: 20_000 },
    );

    await streamEnd;
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const req = harness.getServerDump({ type: "request" });
    expect(req.parsed.headers.authorization).toBe("Bearer testdyadkey");
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
      "git_diff",
      "git_log",
      "git_show_commit",
      "git_show_file",
      "git_status",
      "grep",
      "list_files",
      "read_chat",
      "read_file",
      "read_guide",
      "read_logs",
      "run_type_checks",
      "search_chats",
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

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});
