import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
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

describe("readChatTool", () => {
  let harness: ChatSearchTestHarness;

  beforeEach(() => {
    harness = setupChatSearchTestDb();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("validates page and around-message input modes", () => {
    expect(
      readChatTool.inputSchema.parse({
        chat_id: 1,
        around_message_id: 2,
        before: 1,
        after: 1,
        offset: 5,
      }),
    ).toEqual({
      chat_id: 1,
      around_message_id: 2,
      before: 1,
      after: 1,
    });
    expect(() =>
      readChatTool.inputSchema.parse({ chat_id: 1, before: 1 }),
    ).toThrow(/around_message_id/);
  });

  it("reads a bounded chronological page with continuation metadata", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "History");
    const messageIds = Array.from({ length: 12 }, (_, index) =>
      harness.insertMessage({
        chatId,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message ${index}`,
        createdAt: 10_000 + index,
      }),
    );

    const output = await readChatTool.execute(
      { chat_id: chatId, offset: 2, limit: 4 },
      makeAgentContext({ appId, chatId: chatId + 1 }),
    );
    const result = JSON.parse(output);

    expect(
      result.messages.map(
        (message: { message_id: number }) => message.message_id,
      ),
    ).toEqual(messageIds.slice(2, 6));
    expect(result.has_more_before).toBe(true);
    expect(result.has_more_after).toBe(true);
    expect(result.archival_content).toBe(true);
  });

  it("rejects cross-app chats and mismatched message ids", async () => {
    const appId = harness.insertApp("mine");
    const currentChat = harness.insertChat(appId, "Current");
    const otherAppId = harness.insertApp("other");
    const otherChat = harness.insertChat(otherAppId, "Other");
    const otherMessage = harness.insertMessage({
      chatId: otherChat,
      role: "user",
      content: "foreign",
    });

    await expect(
      readChatTool.execute(
        { chat_id: otherChat },
        makeAgentContext({ appId, chatId: currentChat }),
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
    await expect(
      readChatTool.execute(
        { chat_id: currentChat, around_message_id: otherMessage },
        makeAgentContext({ appId, chatId: currentChat + 1 }),
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
  });

  it("excludes the in-flight placeholder when reading the current chat", async () => {
    const appId = harness.insertApp();
    const chatId = harness.insertChat(appId, "Current");
    const first = harness.insertMessage({
      chatId,
      role: "user",
      content: "earlier request",
    });
    const placeholder = harness.insertMessage({
      chatId,
      role: "assistant",
      content: "partial response",
    });

    const output = await readChatTool.execute(
      { chat_id: chatId },
      makeAgentContext({ appId, chatId, messageId: placeholder }),
    );

    expect(
      JSON.parse(output).messages.map(
        (message: { message_id: number }) => message.message_id,
      ),
    ).toEqual([first]);
  });
});
