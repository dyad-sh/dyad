// Migrated from e2e-tests/reject.spec.ts, then converted from the node
// chat-flow harness to the HYBRID harness (real <ChatPanel> over the real IPC
// stack). With auto-approve OFF, a <dyad-write> response becomes a pending
// proposal: no file is written and no commit is made. This version drives the
// REAL approve/reject proposal bar that ChatInput renders (ChatInputActions)
// and clicks the real Reject button, instead of invoking the
// "reject-proposal" IPC directly. Every original db/file/git assertion is
// preserved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { messages as messagesTable } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("reject (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: false,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("reject", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // Send the prompt through the real UI (type + click the real Send button).
    const { send } = await harness.typeInChat("tc=write-index");
    send();

    await waitFor(
      () => expect(screen.getByText("tc=write-index")).toBeTruthy(),
      { timeout: 15_000 },
    );
    // The streamed assistant text renders in the DOM.
    await waitFor(
      () => expect(screen.getByText(/And it's done!/)).toBeTruthy(),
      { timeout: 20_000 },
    );
    await harness.waitForStreamEnd(harness.chatId);
    // Equivalent of the node harness's `result === chatId`: the stream ended
    // for this chat with no error events.
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    // The response proposes a <dyad-write> but nothing is applied yet.
    const messages = await harness.db.query.messages.findMany();
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain(
      '<dyad-write path="src/pages/Index.tsx"',
    );
    expect(assistant.approvalState).toBeNull();
    expect(assistant.commitHash).toBeNull();
    expect(harness.appFileExists("src/pages/Index.tsx")).toBe(false);
    // Only the init commit exists.
    expect(harness.gitLog()).toHaveLength(1);

    // The REAL proposal bar renders in ChatInput with both actions enabled.
    const rejectButton = await screen.findByTestId(
      "reject-proposal-button",
      {},
      { timeout: 15_000 },
    );
    expect(screen.getByTestId("approve-proposal-button")).toBeTruthy();
    await waitFor(() =>
      expect((rejectButton as HTMLButtonElement).hasAttribute("disabled")).toBe(
        false,
      ),
    );

    // Click the real Reject button (ChatInput.handleReject -> reject-proposal).
    fireEvent.click(rejectButton);

    // The assistant message is now marked rejected...
    await waitFor(
      async () => {
        const rejected = (await harness.db.query.messages.findFirst({
          where: eq(messagesTable.id, assistant.id),
        }))!;
        expect(rejected.approvalState).toBe("rejected");
        expect(rejected.commitHash).toBeNull();
      },
      { timeout: 15_000 },
    );

    // ...the proposal bar disappears from the UI (proposal refetch finds the
    // message no longer pending)...
    await waitFor(
      () => expect(screen.queryByTestId("reject-proposal-button")).toBeNull(),
      { timeout: 15_000 },
    );

    // ...and the proposed change was never applied.
    expect(harness.appFileExists("src/pages/Index.tsx")).toBe(false);
    expect(harness.gitLog()).toHaveLength(1);
  }, 60_000);
});
