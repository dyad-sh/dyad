// @vitest-environment node
//
// Migrated from e2e-tests/chat_mode.spec.ts.
//
// Behavior tests ported:
//   - "chat mode selector - default build mode": the LLM payload in build mode
//     includes the codebase-priming user turn; response dyad tags are applied.
//   - "chat mode selector - ask mode": with selectedChatMode="ask" the payload
//     omits the codebase-priming user turn and the response is NOT applied as
//     file changes.
// Dropped as UI-only:
//   - "chat mode selector - mode persists per chat" (renderer selector/tab
//     state only).
//   - "dyadwrite edit and save - basic flow" (already test.skip upstream;
//     code-editor UI interaction).
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
import { chats } from "@/db/schema";

describe("chat mode (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("default build mode sends codebase context and applies changes", async () => {
    const { result, messages, eventsFor } =
      await harness.streamChat("[dump] hi");
    expect(result).toBe(harness.chatId);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const dump = harness.getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("message: [[SYSTEM_MESSAGE]]");
    // Build mode primes the model with the codebase as a user turn.
    expect(dump.text).toContain("This is my codebase.");
    expect(dump.text.trimEnd()).toMatch(/role: user\nmessage: \[dump\] hi$/);
    expect(dump.text).toMatchSnapshot("chat-mode-build-all-messages");

    // Equivalent of snapshotMessages: user prompt + assistant response
    // containing the (path-masked in UI) dump marker.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("[dump] hi");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("[[dyad-dump-path=");
  }, 30_000);

  it("ask mode omits codebase context and does not apply changes", async () => {
    // The chat-mode selector stores the mode on the chat row; mirror that by
    // creating a fresh chat pinned to ask mode (like the e2e's separate test).
    const [askChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "ask" })
      .returning();

    const { result, eventsFor } = await harness.streamChat("[dump] hi", {
      chatId: askChat.id,
    });
    // The ask-mode branch of chat:stream returns undefined on success.
    expect(result).toBeUndefined();
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const dump = harness.getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("message: [[SYSTEM_MESSAGE]]");
    // Ask mode does NOT include the codebase-priming user turn.
    expect(dump.text).not.toContain("This is my codebase.");
    expect(dump.text.trimEnd()).toMatch(/role: user\nmessage: \[dump\] hi$/);
    expect(dump.text).toMatchSnapshot("chat-mode-ask-all-messages");

    // The response is recorded on the ask chat but nothing is committed.
    const dbMessages = await harness.db.query.messages.findMany();
    const askChatMessages = dbMessages.filter((m) => m.chatId === askChat.id);
    expect(askChatMessages).toHaveLength(2);
    expect(askChatMessages[0].role).toBe("user");
    expect(askChatMessages[0].content).toBe("[dump] hi");
    const assistant = askChatMessages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.commitHash).toBeNull();
    // No git commit was produced by either turn (only the fixture init commit).
    expect(harness.gitLog()).toHaveLength(1);
  }, 30_000);
});
