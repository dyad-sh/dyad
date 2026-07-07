// @vitest-environment node
//
// Migrated from e2e-tests/rename_app.spec.ts.
//
// Two behaviors from the e2e spec:
//  1. "rename app (including folder)": renaming the app AND its folder moves
//     the app directory (old path gone, new path exists) and updates the db.
//  2. "rename app (without folder)": renaming only the app name leaves the
//     folder in place and updates just the name.
// UI-only assertions (dialog flow, title bar text, path label visibility) are
// dropped; the fs + db effects are asserted directly.
import fs from "node:fs";
import path from "node:path";
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
import {
  createFakeIpcEvent,
  type RendererEvent,
} from "@/testing/electron_mock";
import { registerAppHandlers } from "@/ipc/handlers/app_handlers";
import { writeSettings } from "@/main/settings";
import { invalidateDyadAppsBaseDirectoryCache } from "@/paths/paths";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";

type Envelope = { ok: boolean; value?: unknown; error?: unknown };

describe("rename app (integration)", () => {
  let harness: ChatFlowHarness;
  /** Base dir that plays the role of the dyad-apps folder (the harness tmp root). */
  let appsBaseDir: string;
  const rendererEvents: RendererEvent[] = [];

  const invoke = async (
    channel: string,
    input?: unknown,
  ): Promise<Envelope> => {
    const handler = h.ipcHandlers.get(channel);
    if (!handler) throw new Error(`No ipc handler registered for ${channel}`);
    return (await handler(
      createFakeIpcEvent(rendererEvents),
      input,
    )) as Envelope;
  };

  const getAppRow = async () =>
    (await harness.db.query.apps.findFirst({
      where: eq(apps.id, harness.appId),
    }))!;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerAppHandlers();
    // Same as the e2e setup: run one chat turn so the app has real content
    // (file1.txt written + committed) before renaming.
    const { result } = await harness.streamChat("hi");
    expect(result).toBe(harness.chatId);
    expect(harness.appFileExists("file1.txt")).toBe(true);

    // The e2e apps live at RELATIVE paths under the dyad-apps base directory
    // (rename-app resolves relative paths against it). Recreate that layout:
    // point customAppsFolder at the harness temp root and store the app's
    // path relative to it.
    appsBaseDir = path.dirname(harness.appDir);
    writeSettings({ customAppsFolder: appsBaseDir });
    invalidateDyadAppsBaseDirectoryCache();
    await harness.db
      .update(apps)
      .set({ path: path.basename(harness.appDir) })
      .where(eq(apps.id, harness.appId));
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("renames the app without moving the folder", async () => {
    const before = await getAppRow();
    const relPathBefore = before.path;
    const absPathBefore = path.join(appsBaseDir, relPathBefore);
    expect(fs.existsSync(absPathBefore)).toBe(true);

    // "Rename app only": the UI keeps the existing path and changes the name.
    const result = await invoke("rename-app", {
      appId: harness.appId,
      appName: "renamed-name-only",
      appPath: relPathBefore,
    });
    expect(result.ok).toBe(true);

    const after = await getAppRow();
    expect(after.name).toBe("renamed-name-only");
    expect(after.path).toBe(relPathBefore);
    // The folder was NOT moved.
    expect(fs.existsSync(absPathBefore)).toBe(true);
    expect(fs.existsSync(path.join(absPathBefore, "file1.txt"))).toBe(true);
  }, 30_000);

  it("rejects renames with invalid folder characters", async () => {
    const result = await invoke("rename-app", {
      appId: harness.appId,
      appName: "bad-folder",
      appPath: "bad:folder?name",
    });
    expect(result.ok).toBe(false);
  });

  it("renames the app including the folder", async () => {
    const before = await getAppRow();
    const oldAbsPath = path.join(appsBaseDir, before.path);
    expect(fs.existsSync(oldAbsPath)).toBe(true);

    const result = await invoke("rename-app", {
      appId: harness.appId,
      appName: "new-app-name",
      appPath: "new-app-name",
    });
    expect(result.ok).toBe(true);

    const after = await getAppRow();
    expect(after.name).toBe("new-app-name");
    expect(after.path).toBe("new-app-name");

    // Old folder is gone; new folder exists and kept the app contents
    // (including the file written by the chat flow and the git history).
    const newAbsPath = path.join(appsBaseDir, "new-app-name");
    expect(fs.existsSync(oldAbsPath)).toBe(false);
    expect(fs.existsSync(newAbsPath)).toBe(true);
    expect(fs.existsSync(path.join(newAbsPath, "file1.txt"))).toBe(true);
    expect(fs.existsSync(path.join(newAbsPath, ".git"))).toBe(true);
  }, 30_000);

  it("rejects absolute paths for the new folder", async () => {
    const result = await invoke("rename-app", {
      appId: harness.appId,
      appName: "abs-name",
      appPath: path.join(appsBaseDir, "abs-target"),
    });
    expect(result.ok).toBe(false);
  });
});
