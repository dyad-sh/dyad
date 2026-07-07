// @vitest-environment node
//
// Migrated from e2e-tests/version_integrity.spec.ts.
//
// The e2e spec imported the `version-integrity` fixture app, ran two prompts
// (add/edit/delete files, then rename a file), checked out the first version,
// and restored to it — snapshotting the app tree at each step (v1/v2/v3). The
// import dialog UI is replaced by the harness checking out the same fixture;
// the version pane clicks map to the real `checkout-version` / `revert-version`
// IPC handlers. File-tree integrity is asserted by capturing the full app file
// tree at v1 and requiring checkout/restore to reproduce it exactly.
//
// Covers both e2e tests:
//   - "version integrity (git isomorphic)"
//   - "version integrity (git native)"
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

describe("version integrity (integration)", () => {
  let harness: ChatFlowHarness;
  let initOid: string;
  let v1Files: Array<{ relativePath: string; content: string }>;

  const invoke = (channel: string, input: unknown): Promise<any> =>
    Promise.resolve(
      getRegisteredHandlerForTesting(channel)(undefined as never, input),
    );

  const listVersions = (): Promise<Array<{ oid: string; message: string }>> =>
    invoke("list-versions", { appId: harness.appId });

  const expectV1State = () => {
    // Exact tree equality with the captured initial state (the point of the
    // spec: checkout/restore must reproduce every add/edit/delete/rename).
    expect(harness.getAppFiles()).toEqual(v1Files);
  };

  const expectV2State = () => {
    expect(harness.appFileExists("to-be-deleted.txt")).toBe(false);
    expect(harness.readAppFile("new-file.js").trim()).toBe(
      "new-file\nend of new-file",
    );
    expect(harness.readAppFile("to-be-edited.txt").trim()).toBe("after-edit");
    // Untouched files intact.
    expect(harness.readAppFile("a.txt").trim()).toBe("a");
    expect(harness.readAppFile("dir/c.txt").trim()).toBe("dir/c.txt");
  };

  const expectV3State = () => {
    expect(harness.appFileExists("dir/c.txt")).toBe(false);
    expect(harness.readAppFile("new-dir/d.txt").trim()).toBe("dir/c.txt");
    // v2 changes still present.
    expect(harness.appFileExists("to-be-deleted.txt")).toBe(false);
    expect(harness.readAppFile("to-be-edited.txt").trim()).toBe("after-edit");
  };

  const runVersionIntegrityCycle = async () => {
    expectV1State();

    // Add a file, edit a file, and delete a file.
    const addEditDelete = await harness.streamChat(
      "tc=version-integrity-add-edit-delete",
    );
    expect(addEditDelete.result).toBe(harness.chatId);
    expectV2State();

    // Move (rename) a file.
    const moveFile = await harness.streamChat("tc=version-integrity-move-file");
    expect(moveFile.result).toBe(harness.chatId);
    expectV3State();

    // The version list is computed from HEAD, so capture the count while
    // still on main (this is what the pane displays as "Version N").
    const versionCountBefore = (await listVersions()).length;

    // Open the version pane and click the first version (version-row-1)
    // -> checkout-version at the initial commit.
    const checkoutResult = await invoke("checkout-version", {
      appId: harness.appId,
      versionId: initOid,
    });
    expect(checkoutResult).toEqual({});
    expectV1State();

    // "Restore to this version" -> revert-version.
    const revertResult = await invoke("revert-version", {
      appId: harness.appId,
      previousVersionId: initOid,
    });
    expect(revertResult).toEqual({ successMessage: "Restored version" });

    // Should be the same as after the checkout, but just to be sure — and now
    // committed on main as a new version.
    expectV1State();
    const versionsAfter = await listVersions();
    expect(versionsAfter).toHaveLength(versionCountBefore + 1);
    expect(versionsAfter[0].message).toContain(
      `Reverted all changes back to version ${initOid}`,
    );
    const { branch } = await invoke("get-current-branch", {
      appId: harness.appId,
    });
    expect(branch).toBe("main");
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      fixtureApp: "version-integrity",
      autoApprove: true,
      enableNativeGit: true,
    });
    registerVersionHandlers();

    const versions = await listVersions();
    expect(versions).toHaveLength(1);
    initOid = versions[0].oid;
    v1Files = harness.getAppFiles();
    // Sanity-check the fixture's initial state (mirrors the e2e v1 snapshot).
    expect(v1Files.map((f) => f.relativePath)).toContain("to-be-deleted.txt");
    expect(harness.readAppFile("to-be-edited.txt").trim()).toBe("before-edit");
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("version integrity (git native)", async () => {
    writeSettings({ enableNativeGit: true });
    await runVersionIntegrityCycle();
  }, 60_000);

  it("version integrity (git isomorphic)", async () => {
    writeSettings({ enableNativeGit: false });
    await runVersionIntegrityCycle();
  }, 60_000);
});
