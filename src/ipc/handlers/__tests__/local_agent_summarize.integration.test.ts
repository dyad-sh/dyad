// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_summarize.spec.ts.
//
// Regression test for #2292: "Summarize into new chat" while in local-agent
// (Agent v2) mode. The first chat gets real content via the
// `tc=local-agent/read-then-edit` fixture; then a NEW chat streams the
// "Summarize from chat-id=<original>" prompt (the same mechanism the
// "Summarize into new chat" button uses). Before the fix the local agent
// handler didn't receive the formatted chat content and errored; now the
// summarization stream must complete and produce an assistant message in the
// new chat.
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
import { chats, messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

describe("local agent summarize to new chat (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("summarizes the original chat into a new chat", async () => {
    // 1. Build up content in the original chat.
    const first = await harness.streamChat("tc=local-agent/read-then-edit");
    expect(first.eventsFor("chat:response:error")).toHaveLength(0);
    expect(harness.readAppFile("src/App.tsx")).toContain(
      "UPDATED imported app",
    );

    // 2. "New Chat": create a second chat on the same app.
    const [newChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();

    // 3. Trigger summarization in the new chat (same mechanism as the
    //    "Summarize into new chat" button).
    const summarize = await harness.streamChat(
      `Summarize from chat-id=${harness.chatId}`,
      { chatId: newChat.id },
    );
    expect(summarize.eventsFor("chat:response:error")).toHaveLength(0);
    expect(summarize.events.map((e) => e.channel)).toContain("chat:stream:end");

    // 4. The summarization actually ran: the new chat holds the summarize
    //    user message plus a non-empty assistant response (before the fix
    //    this failed with a "no technical discussion" error).
    const newChatMessages = await harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, newChat.id),
      orderBy: [asc(messagesTable.id)],
    });
    expect(newChatMessages.length).toBeGreaterThanOrEqual(2);
    expect(newChatMessages[0].role).toBe("user");
    expect(newChatMessages[0].content).toBe(
      `Summarize from chat-id=${harness.chatId}`,
    );
    const assistant = newChatMessages.find((m) => m.role === "assistant")!;
    expect(assistant.content?.trim()).toBeTruthy();
    expect(assistant.content).not.toContain("no technical discussion");
  }, 60_000);
});
