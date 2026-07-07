// @vitest-environment node
//
// Migrated from e2e-tests/concurrent_chat.spec.ts.
//
// The e2e started a slow chat (tc=chat1 [sleep=medium], 10s server delay),
// started a second chat while the first was still streaming, verified the
// second completed while the first was still in progress, and then switched
// back to the first chat and saw it complete too. The chat-tab / "Chat in
// progress" indicator interactions are UI-only; the behavior ported here is
// that two chat:stream invocations run concurrently and each chat ends with
// its own assistant response, chat title and stream events.
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
import { chats, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

describe("concurrent chat (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("streams two chats concurrently and both complete with their own content", async () => {
    // Second chat on the same app (the e2e's second chat created from the
    // Apps tab while chat #1 was still streaming).
    const [chat2Row] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();

    // Kick off chat #1; the fake server sleeps 10s before responding.
    let chat1Done = false;
    const chat1Promise = harness
      .streamChat("tc=chat1 [sleep=medium]")
      .then((res) => {
        chat1Done = true;
        return res;
      });

    // While chat #1 is in flight, run chat #2 to completion.
    const chat2 = await harness.streamChat("tc=chat2", {
      chatId: chat2Row.id,
    });
    expect(chat2.result).toBe(chat2Row.id);
    expect(chat2.eventsFor("chat:response:error")).toHaveLength(0);
    expect(chat2.event("chat:stream:end")).toBeDefined();

    // Chat #2 finished while chat #1 was still streaming ("Chat in progress"
    // indicator in the e2e).
    expect(chat1Done).toBe(false);

    const chat2Messages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, chat2Row.id),
      orderBy: [asc(messages.id)],
    });
    expect(chat2Messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(chat2Messages[0].content).toBe("tc=chat2");
    expect(chat2Messages[1].content).toContain("chat2");
    expect(chat2Messages[1].content).not.toContain("chat1");

    // Now wait for chat #1 to finish (the e2e switched back to its tab and
    // snapshotted the completed messages).
    const chat1 = await chat1Promise;
    expect(chat1.result).toBe(harness.chatId);
    expect(chat1.eventsFor("chat:response:error")).toHaveLength(0);
    expect(chat1.event("chat:stream:end")).toBeDefined();
    expect(chat1.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(chat1.messages[0].content).toBe("tc=chat1 [sleep=medium]");
    expect(chat1.messages[1].content).toContain("chat1");
    expect(chat1.messages[1].content).not.toContain("chat2");

    // Each chat got its own title from its dyad-chat-summary.
    const chat1Row = await harness.db.query.chats.findFirst({
      where: eq(chats.id, harness.chatId),
    });
    const chat2RowAfter = await harness.db.query.chats.findFirst({
      where: eq(chats.id, chat2Row.id),
    });
    expect(chat1Row?.title).toBe("Chat 1");
    expect(chat2RowAfter?.title).toBe("Chat 2");
  }, 45_000);
});
