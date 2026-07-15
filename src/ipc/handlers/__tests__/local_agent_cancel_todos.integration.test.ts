// Migrated from e2e-tests/local_agent_cancel_todos.spec.ts to the HYBRID
// harness: real <ChatPanel>, real local-agent stream, real todo persistence,
// and real renderer todo wiring.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { chats, messages } from "@/db/schema";
import { getCurrentCommitHash } from "@/ipc/utils/git_utils";
import { ipc } from "@/ipc/types";

describe("local-agent cancel todos (integration)", () => {
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
        enableCodeExplorer: false,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("clears visible and persisted todos when a turn is cancelled", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );
    await harness.selectChatMode("local-agent");

    const todosDir = path.join(harness.appDir, ".dyad", "todos");
    const streamStarted = harness.waitForEvent(
      "chat:stream:start",
      (payload) =>
        !!payload &&
        typeof payload === "object" &&
        (payload as { chatId?: number }).chatId === harness.chatId,
      60_000,
    );
    const { send } = await harness.typeInChat("tc=local-agent/cancel-todos");
    send();
    await streamStarted;

    await screen.findByText("First cancellable task", {}, { timeout: 20_000 });
    await waitFor(() => {
      expect(fs.existsSync(todosDir)).toBe(true);
      expect(fs.readdirSync(todosDir).length).toBeGreaterThan(0);
    });

    const cancelButton = await screen.findByLabelText(
      /^(cancelGeneration|Cancel generation)$/,
      {},
      { timeout: 60_000 },
    );
    fireEvent.click(cancelButton);

    const endEvent = await harness.waitForEvent(
      "chat:response:end",
      (payload) =>
        !!payload &&
        typeof payload === "object" &&
        (payload as { chatId?: number }).chatId === harness.chatId &&
        (payload as { wasCancelled?: boolean }).wasCancelled === true,
      60_000,
    );
    expect(endEvent.payload).toMatchObject({
      chatId: harness.chatId,
      wasCancelled: true,
    });

    await waitFor(() =>
      expect(screen.queryByText("First cancellable task")).toBeNull(),
    );
    await waitFor(() => {
      const remaining = fs.existsSync(todosDir) ? fs.readdirSync(todosDir) : [];
      expect(remaining).toHaveLength(0);
    });
  }, 90_000);

  it("cancels every background stream for the app before restoring", async () => {
    const initialCommitHash = await getCurrentCommitHash({
      path: harness.appDir,
    });
    const [selectedChat, backgroundChat] = await harness.db
      .insert(chats)
      .values([
        {
          appId: harness.appId,
          chatMode: "local-agent",
          initialCommitHash,
        },
        {
          appId: harness.appId,
          chatMode: "local-agent",
          initialCommitHash,
        },
      ])
      .returning();
    const [restoreTarget] = await harness.db
      .insert(messages)
      .values({
        chatId: selectedChat.id,
        role: "user",
        content: "Restore to before this prompt",
      })
      .returning();

    const cancellationEventBaseline = harness.bridge.sentEvents.length;
    const selectedStream = harness.streamChat("tc=local-agent/cancel-todos", {
      chatId: selectedChat.id,
    });
    const backgroundStream = harness.streamChat("tc=local-agent/cancel-todos", {
      chatId: backgroundChat.id,
    });

    // Both fixtures create their assistant placeholders before entering a
    // 30-second delayed turn. Wait for that state so the restore definitely
    // races two active streams rather than merely pending requests.
    await vi.waitFor(
      async () => {
        const activeAssistantChats = await harness.db.query.messages.findMany({
          columns: { chatId: true },
          where: (message, { and, eq, inArray }) =>
            and(
              inArray(message.chatId, [selectedChat.id, backgroundChat.id]),
              eq(message.role, "assistant"),
            ),
        });
        const activeChatIds = new Set(
          activeAssistantChats.map(({ chatId }) => chatId),
        );
        expect(activeChatIds.has(selectedChat.id)).toBe(true);
        expect(activeChatIds.has(backgroundChat.id)).toBe(true);
      },
      { timeout: 20_000 },
    );

    const restoreStartedAt = Date.now();
    const result = await ipc.version.restoreToMessageVersion({
      appId: harness.appId,
      chatId: selectedChat.id,
      messageId: restoreTarget.id,
      restoreCodebase: true,
    });
    await Promise.all([selectedStream, backgroundStream]);

    expect(result).toHaveProperty("newChatId");
    expect(Date.now() - restoreStartedAt).toBeLessThan(15_000);
    const cancelledChatIds = harness.bridge.sentEvents
      .slice(cancellationEventBaseline)
      .filter(
        (event) =>
          event.channel === "chat:response:end" &&
          (event.args[0] as { wasCancelled?: boolean })?.wasCancelled,
      )
      .map((event) => (event.args[0] as { chatId: number }).chatId);
    expect(new Set(cancelledChatIds)).toEqual(
      new Set([selectedChat.id, backgroundChat.id]),
    );
  }, 60_000);
});
