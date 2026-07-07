// @vitest-environment node
//
// Migrated from e2e-tests/new_chat.spec.ts.
//
// The e2e spec sent tc=chat1, clicked "new chat", verified the new chat was
// empty, then sent tc=chat2 and snapshotted the messages each time (aria
// snapshots). The behavior ported here: the first chat records its messages
// and title, `create-chat` produces a fresh empty chat for the same app (with
// the app's current commit as initialCommitHash), streaming into the new chat
// stores messages there, and the first chat is left untouched. The "which of
// the two new-chat buttons was clicked" variants are UI-only and dropped.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import {
  createFakeIpcEvent,
  type RendererEvent,
} from "@/testing/electron_mock";
import { registerChatHandlers } from "@/ipc/handlers/chat_handlers";
import { chats, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

type Envelope = { ok: boolean; value?: unknown; error?: unknown };

describe("new chat (integration)", () => {
  let harness: ChatFlowHarness;
  let newChatId: number;
  const rendererEvents: RendererEvent[] = [];

  const invoke = async (
    channel: string,
    input?: unknown,
  ): Promise<Envelope> => {
    const handler = h.ipcHandlers.get(channel);
    if (!handler) throw new Error(`No ipc handler registered for ${channel}`);
    return (await handler(
      createFakeIpcEvent(rendererEvents),
      input,
    )) as Envelope;
  };

  const messagesFor = (chatId: number) =>
    harness.db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: [asc(messages.id)],
    });

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerChatHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("records the first chat's messages and title", async () => {
    const { result, messages: msgs } = await harness.streamChat("tc=chat1");
    expect(result).toBe(harness.chatId);

    expect(
      msgs.map((m) => ({ role: m.role, content: m.content.trim() })),
    ).toEqual([
      { role: "user", content: "tc=chat1" },
      {
        role: "assistant",
        content: "chat1\n\n<dyad-chat-summary>Chat 1</dyad-chat-summary>",
      },
    ]);

    // The dyad-chat-summary sets the chat title.
    const chatRow = await harness.db.query.chats.findFirst({
      where: eq(chats.id, harness.chatId),
    });
    expect(chatRow!.title).toBe("Chat 1");
  }, 30_000);

  it("create-chat produces a fresh, empty chat for the same app", async () => {
    const result = await invoke("create-chat", { appId: harness.appId });
    expect(result.ok).toBe(true);
    newChatId = result.value as number;

    expect(typeof newChatId).toBe("number");
    expect(newChatId).not.toBe(harness.chatId);

    const chatRow = await harness.db.query.chats.findFirst({
      where: eq(chats.id, newChatId),
    });
    expect(chatRow).toBeTruthy();
    expect(chatRow!.appId).toBe(harness.appId);
    expect(chatRow!.title).toBeNull();
    // The new chat starts at the app's current commit.
    const headCommit = harness.gitLog()[0].split(" ")[0];
    expect(chatRow!.initialCommitHash).toMatch(new RegExp(`^${headCommit}`));

    // The new chat is empty ("Make sure it's empty" in the e2e).
    expect(await messagesFor(newChatId)).toEqual([]);
  }, 30_000);

  it("streams into the new chat without touching the first chat", async () => {
    const { result } = await harness.streamChat("tc=chat2", {
      chatId: newChatId,
    });
    expect(result).toBe(newChatId);

    const newChatMessages = await messagesFor(newChatId);
    expect(
      newChatMessages.map((m) => ({ role: m.role, content: m.content.trim() })),
    ).toEqual([
      { role: "user", content: "tc=chat2" },
      {
        role: "assistant",
        content: "chat2\n\n<dyad-chat-summary>Chat 2</dyad-chat-summary>",
      },
    ]);

    const newChatRow = await harness.db.query.chats.findFirst({
      where: eq(chats.id, newChatId),
    });
    expect(newChatRow!.title).toBe("Chat 2");

    // First chat is untouched.
    const firstChatMessages = await messagesFor(harness.chatId);
    expect(
      firstChatMessages.map((m) => ({
        role: m.role,
        content: m.content.trim(),
      })),
    ).toEqual([
      { role: "user", content: "tc=chat1" },
      {
        role: "assistant",
        content: "chat1\n\n<dyad-chat-summary>Chat 1</dyad-chat-summary>",
      },
    ]);
    const firstChatRow = await harness.db.query.chats.findFirst({
      where: eq(chats.id, harness.chatId),
    });
    expect(firstChatRow!.title).toBe("Chat 1");
  }, 30_000);
});
