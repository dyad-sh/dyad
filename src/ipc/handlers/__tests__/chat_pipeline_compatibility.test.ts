// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { chats, messages } from "@/db/schema";
import { registerProposalHandlers } from "@/ipc/handlers/proposal_handlers";
import { createFakeIpcEvent } from "@/testing/electron_mock";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});
vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

describe("one generation pipeline with saved-proposal compatibility", () => {
  let harness: ChatFlowHarness;
  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerProposalHandlers();
  }, 30_000);
  afterAll(async () => {
    await harness?.dispose();
  });

  it.each(["build", "ask", "plan", "local-agent"] as const)(
    "%s uses native tools and persists structured history",
    async (chatMode) => {
      await harness.db.delete(messages);
      await harness.db
        .update(chats)
        .set({ chatMode })
        .where(eq(chats.id, harness.chatId));
      const result = await harness.streamChat("[dump]");
      expect(result.eventsFor("chat:response:error")).toEqual([]);
      expect(result.eventsFor("chat:response:end")).toHaveLength(1);
      const tools = result.getServerDump({ type: "request" }).parsed.body
        .tools as Array<{
        function: { name: string };
      }>;
      const names = tools.map((tool) => tool.function.name);
      expect(names).toContain("read_file");
      expect(names.includes("write_file")).toBe(
        chatMode === "build" || chatMode === "local-agent",
      );
      const assistant = result.messages.find(
        (message) => message.role === "assistant",
      )!;
      expect(assistant.approvalState).toBe("approved");
      expect(assistant.aiMessagesJson).not.toBeNull();
      const proposal = await h.ipcHandlers.get("get-proposal")!(
        createFakeIpcEvent([]),
        {
          chatId: harness.chatId,
        },
      );
      expect(proposal).toMatchObject({ ok: true, value: null });
    },
    30_000,
  );

  it("still discovers and applies a saved XML proposal without a model turn", async () => {
    await harness.db.delete(messages);
    await harness.db
      .update(chats)
      .set({ chatMode: "build" })
      .where(eq(chats.id, harness.chatId));
    const [saved] = await harness.db
      .insert(messages)
      .values({
        chatId: harness.chatId,
        role: "assistant",
        content:
          '<dyad-chat-summary>Saved change</dyad-chat-summary>\n<dyad-write path="legacy.txt" description="Saved file">legacy proposal contents</dyad-write>',
      })
      .returning();
    const event = createFakeIpcEvent([]);
    const proposal = await h.ipcHandlers.get("get-proposal")!(event, {
      chatId: harness.chatId,
    });
    expect(proposal.ok).toBe(true);
    expect(proposal.value).not.toBeNull();
    expect(harness.appFileExists("legacy.txt")).toBe(false);
    const approved = await h.ipcHandlers.get("approve-proposal")!(event, {
      chatId: harness.chatId,
      messageId: saved.id,
    });
    expect(approved).toMatchObject({ ok: true, value: { success: true } });
    expect(harness.readAppFile("legacy.txt")).toContain(
      "legacy proposal contents",
    );
    const persisted = await harness.db.query.messages.findFirst({
      where: eq(messages.id, saved.id),
    });
    expect(persisted?.approvalState).toBe("approved");
  }, 30_000);
});
