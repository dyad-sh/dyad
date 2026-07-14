// Migrated from the deleted e2e-tests/local_agent_basic.spec.ts
// "local-agent - dump request" snapshot: it captured the full LLM request
// (system prompt + complete tool schema list) for the DEFAULT agent mode
// (Pro local-agent) with enableCodeExplorer: false. The e2e masked the system
// prompt in its snapshot, so the load-bearing coverage was the exact tool list
// and the Pro-vs-ask/basic prompt shape. This hybrid test reproduces that golden
// through the real UI + IPC stack: [dump] captures the request the real Send
// button produced.
//
// The prompt-builder itself is snapshot-tested in
// src/prompts/local_agent_prompt.test.ts; here we assert only that the assembled
// Pro agent-mode prompt (not ask, not basic) is the one actually wired into the
// request, plus the exact default tool NAME list.
import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("local-agent default request (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        // Matches the e2e: with the code explorer off the request carries
        // `code_search` (not `explore_code`), keeping the tool list stable.
        enableCodeExplorer: false,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("sends the full Pro agent-mode tool list and system prompt", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // Drive the real chat-mode selector so the chat row persists local-agent
    // mode (see the note in local_agent_ask.integration.test.ts).
    await harness.selectChatMode("local-agent");

    const streamEnd = harness.waitForNextStreamEnd(harness.chatId);
    const { send } = await harness.typeInChat("[dump]");
    send();

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
      description?: string;
    }>;
    const toolNames = tools.map((t) => t.function?.name ?? t.name).sort();
    // The exact default (Pro, code-explorer-off) agent-mode toolset the e2e
    // request snapshot asserted.
    expect(toolNames).toEqual([
      "add_dependency",
      "add_integration",
      "cancel_agent",
      "code_search",
      "copy_file",
      "delete_file",
      "enable_nitro",
      "execute_sandbox_script",
      "followup_task",
      "generate_image",
      "grep",
      "list_agents",
      "list_files",
      "planning_questionnaire",
      "read_file",
      "read_guide",
      "read_logs",
      "rename_file",
      "run_type_checks",
      "search_replace",
      "send_message",
      "set_chat_summary",
      "spawn_agent",
      "update_todos",
      "wait_agents",
      "web_crawl",
      "web_fetch",
      "web_search",
      "write_file",
    ]);
    // Tool descriptions are masked by the harness, keeping the payload
    // snapshot-stable.
    for (const t of tools) {
      const name = t.function?.name ?? t.name;
      const description = t.function?.description ?? t.description;
      expect(description).toBe(`[[TOOL_DESC:${name}]]`);
    }

    // getServerDump masks the system message; read the raw dump to assert the
    // unmasked prompt is the Pro agent-mode prompt (not ask, not basic).
    const raw = JSON.parse(fs.readFileSync(req.dumpPath, "utf-8"));
    const systemMessage = raw.body.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    const systemText: string =
      typeof systemMessage.content === "string"
        ? systemMessage.content
        : systemMessage.content.map((c: { text: string }) => c.text).join("");
    // Shared role block (create/modify web apps) — distinguishes agent mode from
    // the ask-mode "helps users understand" role.
    expect(systemText).toContain(
      "You are Dyad, an AI assistant that creates and modifies web applications.",
    );
    // Pro-only file-editing guidance (basic mode uses a shorter table).
    expect(systemText).toContain(
      "for moderately large edits, prefer several targeted `search_replace` calls over one `write_file`",
    );
    // Pro-only image generation block.
    expect(systemText).toContain("<image_generation_guidelines>");

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});
