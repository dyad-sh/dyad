import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  drainChatSearchIndexOnce,
  resetChatSearchIndexerForTesting,
} from "./chat_search_indexer";
import {
  buildMatchExpression,
  extractQueryTerms,
  searchChatsTool,
} from "./search_chats";
import {
  makeAgentContext,
  setupChatSearchTestDb,
  type ChatSearchTestHarness,
} from "./chat_search_spec_utils";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

describe("searchChatsTool", () => {
  let harness: ChatSearchTestHarness;

  beforeEach(() => {
    harness = setupChatSearchTestDb();
  });

  afterEach(() => {
    resetChatSearchIndexerForTesting();
    harness.dispose();
  });

  it("constructs quoted Unicode-aware FTS terms without raw syntax", () => {
    expect(extractQueryTerms("what is the auth decision")).toEqual([
      "auth",
      "decision",
    ]);
    const expression = buildMatchExpression(
      extractQueryTerms('NEAR("foo" OR bar*)'),
    );
    for (const part of expression.split(" OR ")) {
      expect(part).toMatch(/^".*"$/);
    }
  });

  it("returns only other chats from the current app", async () => {
    const appId = harness.insertApp("mine");
    const otherAppId = harness.insertApp("other");
    const currentChat = harness.insertChat(appId, "Current");
    const historicalChat = harness.insertChat(appId, "Payments");
    const foreignChat = harness.insertChat(otherAppId, "Foreign");
    harness.insertMessage({
      chatId: currentChat,
      role: "user",
      content: "zebra current chat",
    });
    const targetMessage = harness.insertMessage({
      chatId: historicalChat,
      role: "assistant",
      content: "We fixed the zebra webhook by retrying.",
    });
    harness.insertMessage({
      chatId: foreignChat,
      role: "user",
      content: "zebra foreign secret",
    });
    await drainChatSearchIndexOnce();

    const output = await searchChatsTool.execute(
      { query: "zebra" },
      makeAgentContext({ appId, chatId: currentChat }),
    );
    const result = JSON.parse(output);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].chat_id).toBe(historicalChat);
    expect(result.results[0].matches[0].message_id).toBe(targetMessage);
    expect(output).not.toContain("foreign secret");
    expect(output).not.toContain("current chat");
    expect(result.archival_content).toBe(true);
  });

  it("ranks a title match ahead of a body-only match", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const bodyChat = harness.insertChat(appId, "Misc");
    harness.insertMessage({
      chatId: bodyChat,
      role: "user",
      content: "narwhal appears once in the body",
    });
    const titleChat = harness.insertChat(appId, "Narwhal migration");
    harness.insertMessage({
      chatId: titleChat,
      role: "user",
      content: "begin the migration",
    });
    await drainChatSearchIndexOnce();

    const output = await searchChatsTool.execute(
      { query: "narwhal" },
      makeAgentContext({ appId, chatId: currentChat }),
    );

    expect(JSON.parse(output).results[0].chat_id).toBe(titleChat);
  });
});
