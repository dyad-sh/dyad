// @vitest-environment node
//
// Migrated from e2e-tests/rename_edit.spec.ts ("rename then edit works").
//
// The tc=rename-edit fixture streams a <dyad-rename from="src/App.tsx"
// to="src/Renamed.tsx"> followed by a <dyad-write path="src/Renamed.tsx">.
// The original e2e snapshotted the whole app tree; here we assert the rename +
// write outcome directly and snapshot the resulting tree (masked/sorted by the
// harness the same way Playwright's snapshotAppFiles did).
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

describe("rename then edit (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("renames a file and then writes to the renamed file", async () => {
    const { result, messages } = await harness.streamChat("tc=rename-edit");
    expect(result).toBe(harness.chatId);

    // The rename removed the old file and the write landed in the new one.
    expect(harness.appFileExists("src/App.tsx")).toBe(false);
    expect(harness.appFileExists("src/Renamed.tsx")).toBe(true);
    expect(harness.readAppFile("src/Renamed.tsx").trim()).toBe(
      "// newly added content to renamed file should exist",
    );

    // Auto-approved + committed.
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.approvalState).toBe("approved");
    expect(assistant.commitHash).toBeTruthy();
    expect(harness.gitLog().length).toBeGreaterThan(1);

    // Whole-tree snapshot (equivalent of Playwright snapshotAppFiles).
    expect(harness.getAppFiles()).toMatchSnapshot("rename-edit-app-files");
  }, 30_000);
});
