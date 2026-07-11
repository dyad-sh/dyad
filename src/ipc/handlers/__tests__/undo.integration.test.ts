// Migrated from e2e-tests/undo.spec.ts, then converted from the node
// chat-flow harness to the HYBRID harness (real <ChatPanel> over the real IPC
// stack). The node version invoked `list-versions` + `revert-version` directly
// with the params the renderer computes; this version clicks the REAL Undo
// button in MessagesList's footer, which computes the previous version from
// the loaded version list (falling back to the message's sourceCommitHash)
// and calls the real revert-version IPC — then asserts files, git log, db
// messages, and the message list DOM shrinking.
//
// The harness mounts the real Toaster, so the UI-visible
// "Restored version" success toast is asserted alongside the revert commit,
// restored files, and deleted messages.
//
// Covers all three e2e tests:
//   - "undo" (isomorphic git)
//   - "undo with native git"
//   - "undo after assistant with no code"
import { execFileSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { writeSettings } from "@/main/settings";
import { messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

const INDEX_PATH = "src/pages/Index.tsx";

describe("undo (integration)", () => {
  let harness: HybridChatHarness;

  const loadMessages = () =>
    harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, harness.chatId),
      orderBy: [asc(messagesTable.id)],
    });

  const errorEvents = () =>
    harness.bridge.sentEvents.filter(
      (e) => e.channel === "chat:response:error",
    );

  /** Type + send a prompt through the real UI and gate on ITS stream end. */
  const sendTurn = async (prompt: string) => {
    const end = harness.waitForNextStreamEnd(harness.chatId);
    const { send } = await harness.typeInChat(prompt);
    send();
    await waitFor(() => expect(screen.getByText(prompt)).toBeTruthy(), {
      timeout: 15_000,
    });
    await end;
  };

  /**
   * Click the REAL Undo button in MessagesList's footer (it renders when the
   * last message is an assistant and nothing is streaming) and wait for it to
   * be enabled first.
   */
  const clickUndo = async () => {
    await waitFor(
      () => {
        const button = screen.getByRole("button", { name: /Undo/ });
        expect(button.hasAttribute("disabled")).toBe(false);
      },
      { timeout: 15_000 },
    );
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
  };

  const runUndoCycle = async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // Two code-writing turns.
    await sendTurn("tc=write-index");
    await waitFor(
      () => expect(screen.getAllByText(/And it's done!/)).toHaveLength(1),
      { timeout: 15_000 },
    );
    expect(harness.readAppFile(INDEX_PATH)).toContain("Testing:write-index!");

    await sendTurn("tc=write-index-2");
    await waitFor(
      () => expect(screen.getAllByText(/And it's done!/)).toHaveLength(2),
      { timeout: 15_000 },
    );
    expect(harness.readAppFile(INDEX_PATH)).toContain(
      "Testing:write-index(2)!",
    );
    expect(await loadMessages()).toHaveLength(4);

    // First undo: back to the write-index version; the undone turn's messages
    // are deleted (from the db AND from the rendered messages list).
    await clickUndo();
    await waitFor(() =>
      expect(screen.getAllByText("Restored version").length).toBeGreaterThan(0),
    );
    await waitFor(
      () => expect(screen.queryByText("tc=write-index-2")).toBeNull(),
      { timeout: 15_000 },
    );
    await waitFor(async () => expect(await loadMessages()).toHaveLength(2), {
      timeout: 15_000,
    });
    expect(harness.readAppFile(INDEX_PATH)).toContain("Testing:write-index!");
    expect(harness.readAppFile(INDEX_PATH)).not.toContain(
      "Testing:write-index(2)!",
    );
    expect(harness.gitLog()[0]).toContain(
      "Reverted all changes back to version",
    );

    // Second undo: back to the pristine fixture (the e2e asserted the
    // scaffold's "Welcome to Your Blank App" page; in the minimal fixture the
    // page written by the LLM simply doesn't exist initially).
    await clickUndo();
    await waitFor(() =>
      expect(screen.getAllByText("Restored version").length).toBeGreaterThan(0),
    );
    await waitFor(
      () => expect(screen.queryByText("tc=write-index")).toBeNull(),
      { timeout: 15_000 },
    );
    await waitFor(async () => expect(await loadMessages()).toHaveLength(0), {
      timeout: 15_000,
    });
    expect(harness.appFileExists(INDEX_PATH)).toBe(false);
    // The messages list is empty again (it renders its empty state — the
    // "No messages yet" placeholder or a setup banner — with no chat turns).
    expect(screen.queryByText(/And it's done!/)).toBeNull();
    expect(screen.getByTestId("messages-list")).toBeTruthy();

    // No error events were emitted during the whole cycle.
    expect(errorEvents()).toHaveLength(0);
  };

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: { isTestMode: true },
    });
    execFileSync("git", ["branch", "-M", "master"], {
      cwd: harness.appDir,
      stdio: "pipe",
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("undo with git", async () => {
    await runUndoCycle();
  }, 60_000);

  it("undo after assistant with no code", async () => {
    harness.mount();
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    // First prompt - no code generated, so no commit on the assistant message.
    await sendTurn("tc=no-code-response");
    await waitFor(
      () =>
        expect(
          screen.getByText(/This is a response without any code changes/),
        ).toBeTruthy(),
      { timeout: 15_000 },
    );
    const noCodeMessages = await loadMessages();
    const noCodeAssistant = noCodeMessages[noCodeMessages.length - 1];
    expect(noCodeAssistant.role).toBe("assistant");
    expect(noCodeAssistant.commitHash).toBeNull();

    // Second prompt - generates code.
    await sendTurn("tc=write-index");
    await waitFor(
      () => expect(screen.getAllByText(/And it's done!/)).toHaveLength(1),
      { timeout: 15_000 },
    );
    expect(harness.readAppFile(INDEX_PATH)).toContain("Testing:write-index!");

    // Undo should work even though the first assistant had no commit.
    await clickUndo();
    await waitFor(() =>
      expect(screen.getAllByText("Restored version").length).toBeGreaterThan(0),
    );
    await waitFor(
      () => expect(screen.queryByText("tc=write-index")).toBeNull(),
      { timeout: 15_000 },
    );
    expect(harness.appFileExists(INDEX_PATH)).toBe(false);

    // Only the code-writing turn is deleted; the no-code turn remains (in the
    // db and in the DOM).
    const remaining = await loadMessages();
    expect(remaining).toHaveLength(2);
    expect(remaining[0].content).toBe("tc=no-code-response");
    expect(screen.getByText("tc=no-code-response")).toBeTruthy();
    expect(
      screen.getByText(/This is a response without any code changes/),
    ).toBeTruthy();

    expect(errorEvents()).toHaveLength(0);
  }, 60_000);
});
