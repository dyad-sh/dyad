// @vitest-environment node
//
// Migrated from e2e-tests/app_storage_path.spec.ts.
//
// The e2e test drove the app-details "Move folder" dialog (with a stubbed
// native folder picker) and asserted that the app's files were moved to the
// selected parent directory and the old location was removed. The dialog
// simply invokes the `change-app-location` IPC handler with the picked
// directory; here we call that real handler directly and assert the fs + db
// effects. The dialog/title-bar UI itself is dropped as UI-only.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerAppHandlers } from "@/ipc/handlers/app_handlers";
import { getRegisteredHandlerForTesting } from "@/ipc/handlers/base";
import { apps } from "@/db/schema";

describe("app storage path (integration)", () => {
  let harness: ChatFlowHarness;

  const changeAppLocation = async (input: {
    appId: number;
    parentDirectory: string;
  }) => {
    const handler = getRegisteredHandlerForTesting("change-app-location");
    return (await handler({} as any, input)) as { resolvedPath: string };
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerAppHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("moves the app to a custom storage location", async () => {
    const originalPath = harness.appDir;
    const appFolderName = path.basename(originalPath);
    expect(fs.existsSync(originalPath)).toBe(true);

    const newBasePath = path.join(harness.userDataDir, "alt-app-storage");
    fs.mkdirSync(newBasePath, { recursive: true });

    const { resolvedPath } = await changeAppLocation({
      appId: harness.appId,
      parentDirectory: newBasePath,
    });

    const newAppPath = path.join(newBasePath, appFolderName);
    expect(resolvedPath).toBe(newAppPath);

    // Files moved: new location exists (with the app's files), old one is gone.
    expect(fs.existsSync(newAppPath)).toBe(true);
    expect(fs.existsSync(path.join(newAppPath, "package.json"))).toBe(true);
    expect(fs.existsSync(originalPath)).toBe(false);

    // The db row now points at the new absolute path.
    const appRow = await harness.db.query.apps.findFirst({
      where: eq(apps.id, harness.appId),
    });
    expect(appRow?.path).toBe(newAppPath);
  }, 30_000);

  it("rejects a relative destination folder", async () => {
    await expect(
      changeAppLocation({
        appId: harness.appId,
        parentDirectory: "relative/dir",
      }),
    ).rejects.toThrow("Please select an absolute destination folder.");
  });
});
