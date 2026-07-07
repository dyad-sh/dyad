// @vitest-environment node
//
// Migrated from e2e-tests/reject.spec.ts.
//
// With auto-approve OFF, a <dyad-write> response becomes a pending proposal:
// no file is written and no commit is made. Rejecting the proposal (the same
// "reject-proposal" IPC the UI's Reject button invokes) marks the assistant
// message as rejected and still leaves the codebase untouched.
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
import { createFakeIpcEvent } from "@/testing/electron_mock";
import { registerProposalHandlers } from "@/ipc/handlers/proposal_handlers";
import { messages as messagesTable } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("reject (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      autoApprove: false,
    });
    registerProposalHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("reject", async () => {
    const { result, messages } = await harness.streamChat("tc=write-index");
    expect(result).toBe(harness.chatId);

    // The response proposes a <dyad-write> but nothing is applied yet.
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain(
      '<dyad-write path="src/pages/Index.tsx"',
    );
    expect(assistant.approvalState).toBeNull();
    expect(assistant.commitHash).toBeNull();
    expect(harness.appFileExists("src/pages/Index.tsx")).toBe(false);
    // Only the init commit exists.
    expect(harness.gitLog()).toHaveLength(1);

    // Reject the proposal (same IPC the UI Reject button calls).
    const rejectHandler = h.ipcHandlers.get("reject-proposal") as (
      event: unknown,
      args: { chatId: number; messageId: number },
    ) => Promise<void>;
    expect(rejectHandler).toBeDefined();
    await rejectHandler(createFakeIpcEvent([]), {
      chatId: harness.chatId,
      messageId: assistant.id,
    });

    // The assistant message is now marked rejected...
    const rejected = (await harness.db.query.messages.findFirst({
      where: eq(messagesTable.id, assistant.id),
    }))!;
    expect(rejected.approvalState).toBe("rejected");
    expect(rejected.commitHash).toBeNull();

    // ...and the proposed change was never applied.
    expect(harness.appFileExists("src/pages/Index.tsx")).toBe(false);
    expect(harness.gitLog()).toHaveLength(1);
  }, 30_000);
});
