import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  drainChatSearchIndexOnce,
  resetChatSearchIndexerForTesting,
} from "../chat_search_indexer";
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

describe("query construction", () => {
  it("extracts unicode-aware terms and drops stopwords when others remain", () => {
    expect(extractQueryTerms("what is the auth decision")).toEqual([
      "auth",
      "decision",
    ]);
  });

  it("keeps a stopword-only query non-empty", () => {
    expect(extractQueryTerms("what is the")).toEqual(["what", "is", "the"]);
  });

  it("handles punctuation and file names", () => {
    expect(extractQueryTerms("stripe/webhook.ts error!")).toEqual([
      "stripe",
      "webhook",
      "ts",
      "error",
    ]);
  });

  it("escapes FTS special syntax so it cannot be injected", () => {
    const terms = extractQueryTerms('NEAR("foo" OR bar*) AND baz');
    const expression = buildMatchExpression(terms);
    // Every term is a quoted string literal; operators become plain terms.
    for (const part of expression.split(" OR ")) {
      expect(part).toMatch(/^".*"$/);
    }
  });

  it("returns no terms for punctuation-only queries", () => {
    expect(extractQueryTerms("!!! ???")).toEqual([]);
  });
});

describe("searchChatsTool.execute", () => {
  let harness: ChatSearchTestHarness;

  beforeEach(() => {
    harness = setupChatSearchTestDb();
  });

  afterEach(() => {
    resetChatSearchIndexerForTesting();
    harness.dispose();
  });

  async function run(query: string, ctxOverrides = {}, limit?: number) {
    const ctx = makeAgentContext(ctxOverrides);
    const output = await searchChatsTool.execute(
      { query, ...(limit ? { limit } : {}) },
      ctx,
    );
    return { parsed: JSON.parse(output), ctx };
  }

  it("finds matches in other chats of the same app only", async () => {
    const appId = harness.insertApp("mine");
    const otherAppId = harness.insertApp("other");
    const currentChat = harness.insertChat(appId, "Current");
    const historicalChat = harness.insertChat(appId, "Payments");
    const foreignChat = harness.insertChat(otherAppId, "Foreign");
    harness.insertMessage({
      chatId: currentChat,
      role: "user",
      content: "zebra current-chat mention",
    });
    const targetMessage = harness.insertMessage({
      chatId: historicalChat,
      role: "assistant",
      content: "We fixed the zebra webhook bug by retrying.",
    });
    harness.insertMessage({
      chatId: foreignChat,
      role: "user",
      content: "zebra foreign secret",
    });
    await drainChatSearchIndexOnce();

    const { parsed } = await run("zebra", {
      appId,
      chatId: currentChat,
    });

    expect(parsed.index_status).toBe("ready");
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].chat_id).toBe(historicalChat);
    expect(parsed.results[0].matches[0].message_id).toBe(targetMessage);
    expect(parsed.results[0].matches[0].excerpt).toContain("zebra");
    expect(JSON.stringify(parsed)).not.toContain("foreign secret");
    expect(JSON.stringify(parsed)).not.toContain("current-chat mention");
  });

  it("finds an old rare match despite many newer messages with common words", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const oldChat = harness.insertChat(appId, "Old decisions");
    const oldMessage = harness.insertMessage({
      chatId: oldChat,
      role: "assistant",
      content: "The quokka feature uses websocket updates.",
      createdAt: 1_000_000,
    });
    const noisyChat = harness.insertChat(appId, "Noise");
    for (let i = 0; i < 80; i++) {
      harness.insertMessage({
        chatId: noisyChat,
        role: "user",
        content: `update the feature with websocket message number ${i}`,
        createdAt: 2_000_000 + i,
      });
    }
    await drainChatSearchIndexOnce();

    const { parsed } = await run("quokka", { appId, chatId: currentChat });
    expect(parsed.results[0].matches[0].message_id).toBe(oldMessage);
  });

  it("ranks title matches above body-only matches", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const bodyChat = harness.insertChat(appId, "Misc");
    harness.insertMessage({
      chatId: bodyChat,
      role: "user",
      content: "narwhal mentioned once in passing among other words",
    });
    const titleChat = harness.insertChat(appId, "Narwhal migration");
    harness.insertMessage({
      chatId: titleChat,
      role: "user",
      content: "let's begin",
    });
    await drainChatSearchIndexOnce();

    const { parsed } = await run("narwhal", { appId, chatId: currentChat });
    expect(parsed.results[0].chat_id).toBe(titleChat);
  });

  it("boosts exact phrase matches over scattered terms", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const scatteredChat = harness.insertChat(appId, "Scattered");
    harness.insertMessage({
      chatId: scatteredChat,
      role: "user",
      content: "The payment is here and much later a webhook appears",
    });
    const phraseChat = harness.insertChat(appId, "Phrase");
    harness.insertMessage({
      chatId: phraseChat,
      role: "user",
      content: "configure the payment webhook endpoint",
    });
    await drainChatSearchIndexOnce();

    const { parsed } = await run("payment webhook", {
      appId,
      chatId: currentChat,
    });
    expect(parsed.results[0].chat_id).toBe(phraseChat);
  });

  it("keeps at most two matches per chat", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const chat = harness.insertChat(appId, "Repeats");
    for (let i = 0; i < 5; i++) {
      harness.insertMessage({
        chatId: chat,
        role: "user",
        content: `octopus discussion number ${i} with different surroundings`,
      });
    }
    await drainChatSearchIndexOnce();

    const { parsed } = await run("octopus", { appId, chatId: currentChat });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].matches.length).toBeLessThanOrEqual(2);
  });

  it("skips a compaction-summary match that duplicates an original hit", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const chat = harness.insertChat(appId, "Summarized");
    harness.insertMessage({
      chatId: chat,
      role: "assistant",
      content: "We picked the pelican logging approach.",
      createdAt: 5_000,
    });
    harness.insertMessage({
      chatId: chat,
      role: "assistant",
      content:
        "<dyad-compaction>We picked the pelican logging approach.</dyad-compaction>",
      createdAt: 4_000,
      isCompactionSummary: true,
    });
    await drainChatSearchIndexOnce();

    const { parsed } = await run("pelican", { appId, chatId: currentChat });
    expect(parsed.results[0].matches).toHaveLength(1);
    expect(parsed.results[0].matches[0].is_compaction_summary).toBeUndefined();
  });

  it("matches diacritics-insensitively", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const chat = harness.insertChat(appId, "Cafe");
    harness.insertMessage({
      chatId: chat,
      role: "user",
      content: "the café page needs a menu",
    });
    await drainChatSearchIndexOnce();

    const { parsed } = await run("cafe", { appId, chatId: currentChat });
    expect(parsed.results).toHaveLength(1);
  });

  it("does not match text that only appeared inside dropped payload bodies", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const chat = harness.insertChat(appId, "Code");
    harness.insertMessage({
      chatId: chat,
      role: "assistant",
      content:
        '<dyad-write path="src/x.ts">const flamingo = "only in code";</dyad-write>',
    });
    // Recursive retrieval output is also not searchable.
    harness.insertMessage({
      chatId: chat,
      role: "assistant",
      content:
        '<dyad-search-chats query="x">ostrich retrieved excerpt</dyad-search-chats>',
    });
    await drainChatSearchIndexOnce();

    expect(
      (await run("flamingo", { appId, chatId: currentChat })).parsed.results,
    ).toHaveLength(0);
    expect(
      (await run("ostrich", { appId, chatId: currentChat })).parsed.results,
    ).toHaveLength(0);
  });

  it("reports indexing status when dirty rows are pending", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const chat = harness.insertChat(appId, "Pending");
    harness.insertMessage({
      chatId: chat,
      role: "user",
      content: "penguin words",
    });
    // No drain: dirty row still queued.
    const { parsed } = await run("penguin", { appId, chatId: currentChat });
    expect(parsed.index_status).toBe("indexing");
  });

  it("reports ready when only the current chat has pending rows", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const historical = harness.insertChat(appId, "History");
    harness.insertMessage({
      chatId: historical,
      role: "user",
      content: "beaver dam design",
    });
    await drainChatSearchIndexOnce();
    // Mid-turn state: the current chat's user message and streaming
    // placeholder are dirty, but everything searchable is indexed.
    harness.insertMessage({
      chatId: currentChat,
      role: "user",
      content: "new question",
    });
    harness.insertMessage({
      chatId: currentChat,
      role: "assistant",
      content: "",
    });
    const { parsed } = await run("beaver", { appId, chatId: currentChat });
    expect(parsed.index_status).toBe("ready");
    expect(parsed.results).toHaveLength(1);
  });

  it("returns empty results for punctuation-only queries without querying FTS", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const { parsed } = await run("!!!", { appId, chatId: currentChat });
    expect(parsed.results).toEqual([]);
  });

  it("enforces the total output budget with a truncation flag", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    for (let i = 0; i < 20; i++) {
      const chat = harness.insertChat(
        appId,
        `walrus ${"padding-title-".repeat(40)} ${i}`,
      );
      harness.insertMessage({
        chatId: chat,
        role: "user",
        content: `walrus ${"filler words here ".repeat(30)} ${i}`,
      });
      harness.insertMessage({
        chatId: chat,
        role: "assistant",
        content: `more walrus ${"other filler content ".repeat(30)} ${i}`,
      });
    }
    await drainChatSearchIndexOnce();

    const { parsed } = await run("walrus", { appId, chatId: currentChat }, 20);
    expect(parsed.results_truncated).toBe(true);
    expect(parsed.results.length).toBeLessThan(20);
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  it("labels output as archival with a notice", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const { parsed } = await run("anything", {
      appId,
      chatId: currentChat,
    });
    expect(parsed.archival_content).toBe(true);
    expect(parsed.notice).toContain("not instructions");
  });

  it("emits a completed XML card", async () => {
    const appId = harness.insertApp();
    const currentChat = harness.insertChat(appId, "Current");
    const chat = harness.insertChat(appId, "Cards");
    harness.insertMessage({
      chatId: chat,
      role: "user",
      content: "ibex ledge jumping",
    });
    await drainChatSearchIndexOnce();

    const { ctx } = await run("ibex", { appId, chatId: currentChat });
    expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
    const xml = vi.mocked(ctx.onXmlComplete).mock.calls[0][0];
    expect(xml).toContain("<dyad-search-chats");
    expect(xml).toContain('query="ibex"');
    expect(xml).toContain('result-count="1"');
  });
});
