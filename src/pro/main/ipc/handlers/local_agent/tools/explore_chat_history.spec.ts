import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runExploreChatHistorySubagent: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ agentToolConsents: {} })),
  writeSettings: vi.fn(),
}));

vi.mock("@/ipc/handlers/app_blueprint_handlers", () => ({
  getAppBlueprintForChat: vi.fn(() => null),
  setAppBlueprintForChat: vi.fn(),
  deleteAppBlueprintForChat: vi.fn(),
  updateAppBlueprintVisuals: vi.fn(),
  registerAppBlueprintHandlers: vi.fn(),
}));

vi.mock("./explore_chat_history_subagent", () => ({
  runExploreChatHistorySubagent: mocks.runExploreChatHistorySubagent,
}));

import { exploreChatHistoryTool } from "./explore_chat_history";
import { searchChatsTool } from "./search_chats";
import { readChatTool } from "./read_chat";
import { shouldIncludeTool } from "../tool_definitions";
import { makeAgentContext } from "./chat_search_spec_utils";
import { constructLocalAgentPrompt } from "@/prompts/local_agent_prompt";
import type { HistoryReportStats } from "./explore_chat_history_report";

const REPORT_TEXT =
  'Chat history report for: "auth"\n- Decided on <magic-link> auth & sessions [chat 4, message 7]';
const REPORT_STATS: HistoryReportStats = {
  chats: 2,
  evidence: 3,
  outcome: "complete",
  fabricatedCitations: 0,
};

// Distinctive substring of the pre-explorer Understand-step guidance
// (CHAT_HISTORY_RECALL_GUIDANCE). The explorer guidance also mentions
// `search_chats`, so tests key on this longer phrase.
const PLAIN_RECALL_GUIDANCE =
  "use `search_chats` (chat history, not code), then `read_chat` with a match's `around_message_id`";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runExploreChatHistorySubagent.mockResolvedValue({
    report: { text: REPORT_TEXT, stats: REPORT_STATS },
  });
});

describe("exploreChatHistoryTool contract", () => {
  it("declares the expected tool contract", () => {
    expect(exploreChatHistoryTool.name).toBe("explore_chat_history");
    expect(exploreChatHistoryTool.defaultConsent).toBe("always");
    expect(exploreChatHistoryTool.usesEngineEndpoint).toBe(true);
    // Read-only research tool: must never count as a state-modifying tool.
    expect(exploreChatHistoryTool.modifiesState).toBeUndefined();
  });

  it("is enabled only for Dyad Pro contexts", () => {
    expect(exploreChatHistoryTool.isEnabled).toBeDefined();
    expect(
      exploreChatHistoryTool.isEnabled!(makeAgentContext({ isDyadPro: true })),
    ).toBe(true);
    expect(
      exploreChatHistoryTool.isEnabled!(makeAgentContext({ isDyadPro: false })),
    ).toBe(false);
  });
});

describe("tool exposure via shouldIncludeTool", () => {
  it("is included for a Pro context", () => {
    const ctx = makeAgentContext({ isDyadPro: true });
    expect(shouldIncludeTool(exploreChatHistoryTool, ctx)).toBe(true);
  });

  it("is excluded for a non-Pro context", () => {
    const ctx = makeAgentContext({ isDyadPro: false });
    expect(shouldIncludeTool(exploreChatHistoryTool, ctx)).toBe(false);
  });

  it("is excluded in free-model mode even for Pro (engine-backed)", () => {
    const ctx = makeAgentContext({ isDyadPro: true });
    expect(
      shouldIncludeTool(exploreChatHistoryTool, ctx, { freeModelMode: true }),
    ).toBe(false);
  });

  it("supersedes search_chats for Pro while keeping read_chat", () => {
    const ctx = makeAgentContext({ isDyadPro: true });
    expect(shouldIncludeTool(exploreChatHistoryTool, ctx)).toBe(true);
    expect(shouldIncludeTool(searchChatsTool, ctx)).toBe(false);
    expect(shouldIncludeTool(readChatTool, ctx)).toBe(true);
  });

  it("keeps search_chats for non-Pro, and for Pro when the explorer is filtered out", () => {
    // Non-Pro: no explorer, direct search remains.
    const nonPro = makeAgentContext({ isDyadPro: false });
    expect(shouldIncludeTool(searchChatsTool, nonPro)).toBe(true);
    // Pro in free-model mode: the engine-backed explorer is filtered, so
    // hiding search_chats too would leave no history discovery at all.
    const pro = makeAgentContext({ isDyadPro: true });
    expect(
      shouldIncludeTool(searchChatsTool, pro, { freeModelMode: true }),
    ).toBe(true);
  });
});

describe("exploreChatHistoryTool.execute", () => {
  it("returns the sub-agent report text", async () => {
    const ctx = makeAgentContext({ isDyadPro: true });
    const result = await exploreChatHistoryTool.execute(
      { query: "what did we decide about auth?" },
      ctx,
    );

    expect(result).toBe(REPORT_TEXT);
    expect(mocks.runExploreChatHistorySubagent).toHaveBeenCalledTimes(1);
    expect(mocks.runExploreChatHistorySubagent).toHaveBeenCalledWith({
      query: "what did we decide about auth?",
      ctx,
      onProgress: expect.any(Function),
    });
  });

  it("streams a pending card with the escaped query and no closing tag", async () => {
    const ctx = makeAgentContext({ isDyadPro: true });
    await exploreChatHistoryTool.execute({ query: 'auth "flow" <v2>' }, ctx);

    expect(ctx.onXmlStream).toHaveBeenCalled();
    const pending = vi.mocked(ctx.onXmlStream).mock.calls[0][0];
    expect(pending).toContain(
      '<dyad-explore-chat-history query="auth &quot;flow&quot; &lt;v2&gt;"',
    );
    expect(pending).toContain("Exploring chat history…");
    expect(pending).not.toContain("</dyad-explore-chat-history>");
    // Stats attributes only appear on the completed card.
    expect(pending).not.toContain("chats=");
    expect(pending).not.toContain("outcome=");
  });

  it("streams sub-agent progress through onXmlStream with escaped content", async () => {
    const ctx = makeAgentContext({ isDyadPro: true });
    mocks.runExploreChatHistorySubagent.mockImplementation(
      async ({ onProgress }: { onProgress?: (text: string) => void }) => {
        onProgress?.('1. search_chats "login" → 3 chats <partial>');
        return { report: { text: REPORT_TEXT, stats: REPORT_STATS } };
      },
    );

    await exploreChatHistoryTool.execute({ query: "login history" }, ctx);

    expect(ctx.onXmlStream).toHaveBeenCalledWith(
      expect.stringContaining(
        '1. search_chats "login" → 3 chats &lt;partial&gt;',
      ),
    );
  });

  it("completes with stats attributes and escaped report content", async () => {
    const ctx = makeAgentContext({ isDyadPro: true });
    await exploreChatHistoryTool.execute(
      { query: "what did we decide about auth?" },
      ctx,
    );

    expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
    const xml = vi.mocked(ctx.onXmlComplete).mock.calls[0][0];
    expect(xml).toContain("<dyad-explore-chat-history ");
    expect(xml).toContain('query="what did we decide about auth?"');
    expect(xml).toContain('chats="2"');
    expect(xml).toContain('evidence="3"');
    expect(xml).toContain('outcome="complete"');
    expect(xml).toContain(
      "Decided on &lt;magic-link&gt; auth &amp; sessions [chat 4, message 7]",
    );
    expect(xml).not.toContain("<magic-link>");
    expect(xml).toContain("</dyad-explore-chat-history>");
  });
});

describe("prompt guidance", () => {
  it("uses explore_chat_history guidance in the Understand step when the explorer is available", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      historyExplorerAvailable: true,
    });

    const understandStep = prompt
      .split("\n")
      .find((line) => line.includes("**Understand:**"));
    expect(understandStep).toBeDefined();
    expect(understandStep).toContain("`explore_chat_history`");
    // search_chats is hidden when the explorer is present; drill-down routes
    // through read_chat with a report citation.
    expect(understandStep).not.toContain("`search_chats`");
    expect(understandStep).toContain("`read_chat`");
    expect(prompt).not.toContain(PLAIN_RECALL_GUIDANCE);
  });

  it("keeps the search_chats-first guidance when the explorer is unavailable", () => {
    for (const options of [undefined, { historyExplorerAvailable: false }]) {
      const prompt = constructLocalAgentPrompt(undefined, undefined, options);
      expect(prompt).toContain(PLAIN_RECALL_GUIDANCE);
      expect(prompt).not.toContain("explore_chat_history");
    }
  });

  it("never mentions explore_chat_history in basic or free-model mode", () => {
    for (const options of [
      { basicAgentMode: true, historyExplorerAvailable: true },
      { freeModelMode: true, historyExplorerAvailable: true },
    ]) {
      const prompt = constructLocalAgentPrompt(undefined, undefined, options);
      expect(prompt).not.toContain("explore_chat_history");
      expect(prompt).toContain(PLAIN_RECALL_GUIDANCE);
    }
  });
});
