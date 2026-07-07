// @vitest-environment node
//
// Migrated from e2e-tests/undo.spec.ts.
//
// The e2e spec asserted undo behavior via the preview iframe (UI). The
// underlying behavior is: the Undo button computes the previous version from
// the version list and calls the real `revert-version` IPC handler, which
// git-restores the app files and deletes the undone chat messages. Here we
// drive `list-versions` + `revert-version` directly (same params the renderer
// computes in MessagesList.tsx) and assert files, git log, and db messages.
//
// Covers all three e2e tests:
//   - "undo" (isomorphic git)
//   - "undo with native git"
//   - "undo after assistant with no code"
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
import { registerVersionHandlers } from "@/ipc/handlers/version_handlers";
import { getRegisteredHandlerForTesting } from "@/ipc/handlers/base";
import { writeSettings } from "@/main/settings";
import { messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

const INDEX_PATH = "src/pages/Index.tsx";

describe("undo (integration)", () => {
  let harness: ChatFlowHarness;

  const invoke = (channel: string, input: unknown): Promise<any> =>
    Promise.resolve(
      getRegisteredHandlerForTesting(channel)(undefined as never, input),
    );

  const loadMessages = () =>
    harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, harness.chatId),
      orderBy: [asc(messagesTable.id)],
    });

  /**
   * Mirrors the renderer's Undo button (MessagesList.tsx): find the previous
   * version relative to the last assistant message's commit and revert to it,
   * deleting the chat turn that produced it.
   */
  const clickUndo = async () => {
    const msgs = await loadMessages();
    const currentMessage = msgs[msgs.length - 1];
    const userMessage = msgs[msgs.length - 2];
    expect(currentMessage?.role).toBe("assistant");

    const versions: Array<{ oid: string }> = await invoke("list-versions", {
      appId: harness.appId,
    });
    const currentCommitIndex = currentMessage?.commitHash
      ? versions.findIndex((v) => v.oid === currentMessage.commitHash)
      : -1;
    const previousVersionId =
      currentCommitIndex >= 0
        ? versions[currentCommitIndex + 1]?.oid
        : undefined;
    const revertTargetVersionId =
      previousVersionId ?? currentMessage?.sourceCommitHash;
    expect(revertTargetVersionId).toBeTruthy();

    const result = await invoke("revert-version", {
      appId: harness.appId,
      previousVersionId: revertTargetVersionId,
      currentChatMessageId: userMessage
        ? { chatId: harness.chatId, messageId: userMessage.id }
        : undefined,
    });
    expect(result).toEqual({ successMessage: "Restored version" });
  };

  const runUndoCycle = async () => {
    // Two code-writing turns.
    const first = await harness.streamChat("tc=write-index");
    expect(first.result).toBe(harness.chatId);
    expect(harness.readAppFile(INDEX_PATH)).toContain("Testing:write-index!");

    const second = await harness.streamChat("tc=write-index-2");
    expect(second.result).toBe(harness.chatId);
    expect(harness.readAppFile(INDEX_PATH)).toContain(
      "Testing:write-index(2)!",
    );
    expect(second.messages).toHaveLength(4);

    // First undo: back to the write-index version; the undone turn's messages
    // are deleted.
    await clickUndo();
    expect(harness.readAppFile(INDEX_PATH)).toContain("Testing:write-index!");
    expect(harness.readAppFile(INDEX_PATH)).not.toContain(
      "Testing:write-index(2)!",
    );
    expect(await loadMessages()).toHaveLength(2);
    expect(harness.gitLog()[0]).toContain(
      "Reverted all changes back to version",
    );

    // Second undo: back to the pristine fixture (the e2e asserted the
    // scaffold's "Welcome to Your Blank App" page; in the minimal fixture the
    // page written by the LLM simply doesn't exist initially).
    await clickUndo();
    expect(harness.appFileExists(INDEX_PATH)).toBe(false);
    expect(await loadMessages()).toHaveLength(0);
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      autoApprove: true,
      enableNativeGit: true,
    });
    registerVersionHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("undo with native git", async () => {
    writeSettings({ enableNativeGit: true });
    await runUndoCycle();
  }, 60_000);

  it("undo with isomorphic git", async () => {
    writeSettings({ enableNativeGit: false });
    await runUndoCycle();
  }, 60_000);

  it("undo after assistant with no code", async () => {
    writeSettings({ enableNativeGit: true });

    // First prompt - no code generated, so no commit on the assistant message.
    const noCode = await harness.streamChat("tc=no-code-response");
    expect(noCode.result).toBe(harness.chatId);
    const noCodeAssistant = noCode.messages[noCode.messages.length - 1];
    expect(noCodeAssistant.role).toBe("assistant");
    expect(noCodeAssistant.commitHash).toBeNull();

    // Second prompt - generates code.
    await harness.streamChat("tc=write-index");
    expect(harness.readAppFile(INDEX_PATH)).toContain("Testing:write-index!");

    // Undo should work even though the first assistant had no commit.
    await clickUndo();
    expect(harness.appFileExists(INDEX_PATH)).toBe(false);

    // Only the code-writing turn is deleted; the no-code turn remains.
    const remaining = await loadMessages();
    expect(remaining).toHaveLength(2);
    expect(remaining[0].content).toBe("tc=no-code-response");
  }, 60_000);
});
