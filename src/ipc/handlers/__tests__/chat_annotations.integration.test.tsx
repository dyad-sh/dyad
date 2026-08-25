import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { messages } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("chat annotations (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("submits annotations without composer text through the real chat flow", async () => {
    const [assistantMessage] = await harness.db
      .insert(messages)
      .values({
        chatId: harness.chatId,
        role: "assistant",
        content: "The dashboard title should stay descriptive.",
      })
      .returning({ id: messages.id });

    harness.mount();
    await screen.findByText("The dashboard title should stay descriptive.");

    harness.setChatAnnotations(harness.chatId, [
      {
        id: "annotation-1",
        chatId: harness.chatId,
        messageId: assistantMessage.id,
        selectedText: "dashboard title",
        comment: "[dump] Make this heading concise.",
        createdAt: 1,
        startOffset: 4,
        selectionLength: 15,
      },
    ]);

    expect(screen.getByTestId("chat-annotations-tray")).toBeTruthy();
    expect(harness.getChatInputValue(harness.chatId)).toBe("");

    const sendButton = await screen.findByLabelText(
      /^(sendMessage|Send message)$/,
    );
    await waitFor(() => {
      expect((sendButton as HTMLButtonElement).disabled).toBe(false);
    });

    const streamEnd = harness.waitForNextStreamEnd(harness.chatId);
    fireEvent.click(sendButton);
    await streamEnd;

    expect(
      harness.bridge.sentEvents.filter(
        (event) => event.channel === "chat:response:error",
      ),
    ).toHaveLength(0);
    expect(harness.getChatAnnotations(harness.chatId)).toEqual([]);
    expect(screen.queryByTestId("chat-annotations-tray")).toBeNull();

    const chatMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, harness.chatId),
    });
    const submittedMessage = chatMessages.find(
      (message) => message.role === "user",
    );
    expect(submittedMessage?.content).toBe(
      `I have comments on your latest response. Address every comment below.\n\n## Comment 1\n\nFrom assistant message ${assistantMessage.id}:\n\n> dashboard title\n\n[dump] Make this heading concise.`,
    );

    const dump = harness.getServerDump({ type: "last-message" });
    expect(dump.text).toContain(
      "I have comments on your latest response. Address every comment below.",
    );
    expect(dump.text).toContain(
      `From assistant message ${assistantMessage.id}:`,
    );
    expect(dump.text).toContain("> dashboard title");
    expect(dump.text).toContain("[dump] Make this heading concise.");
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});
