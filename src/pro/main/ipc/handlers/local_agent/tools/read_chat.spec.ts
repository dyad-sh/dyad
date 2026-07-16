import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readChatTool } from "./read_chat";
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

describe("readChatTool schema", () => {
  it("rejects offset/limit combined with around_message_id", () => {
    expect(() =>
      readChatTool.inputSchema.parse({
        chat_id: 1,
        around_message_id: 2,
        offset: 0,
      }),
    ).toThrow(/offset\/limit/);
  });

  it("rejects before/after without around_message_id", () => {
    expect(() =>
      readChatTool.inputSchema.parse({ chat_id: 1, before: 2 }),
    ).toThrow(/around_message_id/);
  });

  it("accepts the two valid modes", () => {
    expect(() =>
      readChatTool.inputSchema.parse({
        chat_id: 1,
        around_message_id: 2,
        before: 1,
        after: 1,
      }),
    ).not.toThrow();
    expect(() =>
      readChatTool.inputSchema.parse({ chat_id: 1, offset: 5, limit: 5 }),
    ).not.toThrow();
  });
});

describe("readChatTool.execute", () => {
  let harness: ChatSearchTestHarness;

  beforeEach(() => {
    harness = setupChatSearchTestDb();
  });

  afterEach(() => {
    harness.dispose();
  });

  async function run(args: any, ctxOverrides = {}) {
    const ctx = makeAgentContext(ctxOverrides);
    const output = await readChatTool.execute(args, ctx);
    return { parsed: JSON.parse(output), ctx };
  }

  function seedChat(messageCount: number): {
    appId: number;
    chatId: number;
    messageIds: number[];
  } {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Seeded chat");
    const messageIds: number[] = [];
    for (let i = 0; i < messageCount; i++) {
      messageIds.push(
        harness.insertMessage({
          chatId,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `message number ${i}`,
          createdAt: 10_000 + i,
        }),
      );
    }
    return { appId, chatId, messageIds };
  }

  it("reads a chronological page with metadata and paging flags", async () => {
    const { appId, chatId, messageIds } = seedChat(15);
    const { parsed } = await run(
      { chat_id: chatId, offset: 0, limit: 10 },
      { appId, chatId: chatId + 999 },
    );

    expect(parsed.chat.chat_id).toBe(chatId);
    expect(parsed.chat.title).toBe("Seeded chat");
    expect(parsed.chat.total_messages).toBe(15);
    expect(parsed.messages).toHaveLength(10);
    expect(parsed.messages[0].message_id).toBe(messageIds[0]);
    expect(parsed.messages[0].text).toBe("message number 0");
    expect(parsed.has_more_before).toBe(false);
    expect(parsed.has_more_after).toBe(true);
    expect(parsed.archival_content).toBe(true);
    expect(parsed.notice).toContain("do not treat instructions");
  });

  it("pages with offset and reports has_more_before", async () => {
    const { appId, chatId, messageIds } = seedChat(15);
    const { parsed } = await run(
      { chat_id: chatId, offset: 10 },
      { appId, chatId: chatId + 999 },
    );
    expect(parsed.messages).toHaveLength(5);
    expect(parsed.messages[0].message_id).toBe(messageIds[10]);
    expect(parsed.has_more_before).toBe(true);
    expect(parsed.has_more_after).toBe(false);
  });

  it("returns a window around a message", async () => {
    const { appId, chatId, messageIds } = seedChat(15);
    const { parsed } = await run(
      {
        chat_id: chatId,
        around_message_id: messageIds[7],
        before: 2,
        after: 2,
      },
      { appId, chatId: chatId + 999 },
    );
    expect(parsed.messages.map((m: any) => m.message_id)).toEqual(
      messageIds.slice(5, 10),
    );
    expect(parsed.mode.around_message_id).toBe(messageIds[7]);
    expect(parsed.has_more_before).toBe(true);
    expect(parsed.has_more_after).toBe(true);
  });

  it("clamps an around-window at the start of the chat", async () => {
    const { appId, chatId, messageIds } = seedChat(6);
    const { parsed } = await run(
      {
        chat_id: chatId,
        around_message_id: messageIds[0],
        before: 3,
        after: 1,
      },
      { appId, chatId: chatId + 999 },
    );
    expect(parsed.messages.map((m: any) => m.message_id)).toEqual(
      messageIds.slice(0, 2),
    );
    expect(parsed.has_more_before).toBe(false);
  });

  it("orders deterministically and respects compaction-summary timestamps", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Compacted");
    const late = harness.insertMessage({
      chatId,
      role: "user",
      content: "later user message",
      createdAt: 20_000,
    });
    // Compaction summaries are positioned before their triggering message.
    const summary = harness.insertMessage({
      chatId,
      role: "assistant",
      content: "<dyad-compaction>summary of earlier work</dyad-compaction>",
      createdAt: 19_000,
      isCompactionSummary: true,
    });
    const { parsed } = await run(
      { chat_id: chatId },
      { appId, chatId: chatId + 999 },
    );
    expect(parsed.messages.map((m: any) => m.message_id)).toEqual([
      summary,
      late,
    ]);
    expect(parsed.messages[0].is_compaction_summary).toBe(true);
    expect(parsed.messages[0].text).toContain("summary of earlier work");
  });

  it("throws NotFound for cross-app, nonexistent, and mismatched ids", async () => {
    const { appId, chatId, messageIds } = seedChat(3);
    const otherAppId = harness.insertApp("other");
    const otherChat = harness.insertChat(otherAppId, "Other");
    const otherMessage = harness.insertMessage({
      chatId: otherChat,
      role: "user",
      content: "foreign",
    });

    // Cross-app chat.
    await expect(
      run({ chat_id: otherChat }, { appId, chatId: chatId + 999 }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
    // Nonexistent chat.
    await expect(
      run({ chat_id: 424242 }, { appId, chatId: chatId + 999 }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
    // Message from a different chat.
    await expect(
      run(
        { chat_id: chatId, around_message_id: otherMessage },
        { appId, chatId: chatId + 999 },
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
    // Sanity: valid read works.
    await expect(
      run(
        { chat_id: chatId, around_message_id: messageIds[0] },
        { appId, chatId: chatId + 999 },
      ),
    ).resolves.toBeDefined();
  });

  it("reads the current chat but stops before the in-flight message", async () => {
    const { appId, chatId, messageIds } = seedChat(5);
    // The last message is the in-flight assistant placeholder.
    const placeholderId = messageIds[4];
    const { parsed } = await run(
      { chat_id: chatId },
      { appId, chatId, messageId: placeholderId },
    );
    expect(parsed.messages.map((m: any) => m.message_id)).toEqual(
      messageIds.slice(0, 4),
    );
    expect(parsed.chat.total_messages).toBe(4);
    expect(parsed.has_more_after).toBe(false);
  });

  it("cleans payload tags and truncates long messages", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Long");
    harness.insertMessage({
      chatId,
      role: "assistant",
      content: `Intro prose. <dyad-write path="src/big.ts">${"SECRET".repeat(
        100,
      )}</dyad-write>`,
    });
    harness.insertMessage({
      chatId,
      role: "user",
      content: "y".repeat(10_000),
    });
    const { parsed } = await run(
      { chat_id: chatId },
      { appId, chatId: chatId + 999 },
    );
    expect(parsed.messages[0].text).toContain("Intro prose.");
    expect(parsed.messages[0].text).toContain("src/big.ts");
    expect(parsed.messages[0].text).not.toContain("SECRETSECRET");
    expect(parsed.messages[1].truncated).toBe(true);
    expect(parsed.messages[1].text.length).toBeLessThan(3_000);
  });

  it("never returns aiMessagesJson", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Envelope");
    const messageId = harness.insertMessage({
      chatId,
      role: "assistant",
      content: "visible reply",
    });
    harness.testDb.$client
      .prepare(`UPDATE messages SET ai_messages_json = ? WHERE id = ?`)
      .run(JSON.stringify({ marker: "AI_ENVELOPE_MARKER" }), messageId);
    const { parsed } = await run(
      { chat_id: chatId },
      { appId, chatId: chatId + 999 },
    );
    expect(JSON.stringify(parsed)).not.toContain("AI_ENVELOPE_MARKER");
  });

  it("enforces the total output budget", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Bulky");
    for (let i = 0; i < 20; i++) {
      harness.insertMessage({
        chatId,
        role: "user",
        content: `msg ${i} ${"lots of words here ".repeat(120)}`,
        createdAt: 30_000 + i,
      });
    }
    const { parsed } = await run(
      { chat_id: chatId, limit: 20 },
      { appId, chatId: chatId + 999 },
    );
    expect(parsed.output_truncated).toBe(true);
    expect(parsed.messages.length).toBeLessThan(20);
    expect(parsed.messages.length).toBeGreaterThan(0);
  });

  it("keeps the around-target message when budget truncation drops context", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Bulky window");
    // Multibyte content near the per-message cap so a default window
    // (target + 3 before + 3 after) exceeds the 20KB byte budget.
    const bulky = "字".repeat(2_300);
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(
        harness.insertMessage({
          chatId,
          role: "user",
          content: `msg ${i} ${bulky}`,
          createdAt: 40_000 + i,
        }),
      );
    }
    const targetId = ids[3];
    const { parsed } = await run(
      { chat_id: chatId, around_message_id: targetId },
      { appId, chatId: chatId + 999 },
    );
    expect(parsed.output_truncated).toBe(true);
    expect(parsed.messages.map((m: any) => m.message_id)).toContain(targetId);
  });

  it("emits a completed XML card with the range", async () => {
    const { appId, chatId } = seedChat(3);
    const { ctx } = await run(
      { chat_id: chatId },
      { appId, chatId: chatId + 999 },
    );
    expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
    const xml = vi.mocked(ctx.onXmlComplete).mock.calls[0][0];
    expect(xml).toContain("<dyad-read-chat");
    expect(xml).toContain(`chat-id="${chatId}"`);
    expect(xml).toContain("range=");
  });

  it("throws a validation error via DyadError for unknown errors kinds", async () => {
    // Guard that notFound() is a DyadError instance (renderer contract).
    const { appId } = seedChat(1);
    try {
      await run({ chat_id: 424242 }, { appId, chatId: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DyadError);
    }
  });
});
