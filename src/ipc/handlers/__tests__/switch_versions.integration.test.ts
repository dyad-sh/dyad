// @vitest-environment node
//
// Migrated from e2e-tests/switch_versions.spec.ts.
//
// The e2e spec asserted version switching via preview screenshots and the
// version pane UI (aria snapshots + "Version N" labels were UI-only and are
// dropped). The behavior under test is: `checkout-version` checks the app repo
// out at an older commit (files revert to the old state), and "Restore to this
// version" calls `revert-version`, which creates a new revert commit on main
// (so the version count grows by one: Version 2 -> Version 3).
//
// Covers both e2e tests:
//   - "switch versions (native git)"
//   - "switch versions (isomorphic git)"
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

const INDEX_PATH = "src/pages/Index.tsx";

describe("switch versions (integration)", () => {
  let harness: ChatFlowHarness;

  const invoke = (channel: string, input: unknown): Promise<any> =>
    Promise.resolve(
      getRegisteredHandlerForTesting(channel)(undefined as never, input),
    );

  const listVersions = (): Promise<Array<{ oid: string; message: string }>> =>
    invoke("list-versions", { appId: harness.appId });

  /**
   * One full e2e cycle: write code (new version), check out the previous
   * version ("version-row-1" in the pane), then restore to it.
   */
  const runSwitchVersionCycle = async () => {
    const versionsBefore = await listVersions();

    const { result } = await harness.streamChat("tc=write-index");
    expect(result).toBe(harness.chatId);
    expect(harness.readAppFile(INDEX_PATH)).toContain("Testing:write-index!");

    // The pane would now show "Version N+1".
    const versions = await listVersions();
    expect(versions).toHaveLength(versionsBefore.length + 1);
    const previousVersion = versions[1];

    // Click a previous version row -> checkout-version. Files revert to the
    // pre-write state (the e2e asserted this via a preview screenshot).
    const checkoutResult = await invoke("checkout-version", {
      appId: harness.appId,
      versionId: previousVersion.oid,
    });
    expect(checkoutResult).toEqual({});
    expect(harness.appFileExists(INDEX_PATH)).toBe(false);

    // "Restore to this version" -> revert-version (same params as
    // VersionPane.handleRestoreVersion / useVersions).
    const revertResult = await invoke("revert-version", {
      appId: harness.appId,
      previousVersionId: previousVersion.oid,
    });
    expect(revertResult).toEqual({ successMessage: "Restored version" });

    // Still the old file state, but as a NEW commit on main ("Version N+2").
    expect(harness.appFileExists(INDEX_PATH)).toBe(false);
    const versionsAfter = await listVersions();
    expect(versionsAfter).toHaveLength(versions.length + 1);
    expect(versionsAfter[0].message).toContain(
      `Reverted all changes back to version ${previousVersion.oid}`,
    );

    // Back on main (not detached) after the restore.
    const { branch } = await invoke("get-current-branch", {
      appId: harness.appId,
    });
    expect(branch).toBe("main");
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

  it("switch versions (native git)", async () => {
    writeSettings({ enableNativeGit: true });
    await runSwitchVersionCycle();
  }, 60_000);

  it("switch versions (isomorphic git)", async () => {
    writeSettings({ enableNativeGit: false });
    await runSwitchVersionCycle();
  }, 60_000);
});
