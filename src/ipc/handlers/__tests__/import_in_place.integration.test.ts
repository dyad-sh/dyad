// @vitest-environment node
//
// Migrated from e2e-tests/import_in_place.spec.ts ("import app without
// copying to dyad-apps").
//
// The e2e unchecked the "Copy to the dyad-apps folder" checkbox (which makes
// the renderer pass skipCopy: true to the `import-app` IPC handler) and
// verified the import succeeded. Here we call the real handler directly:
//  - the app is NOT copied into the dyad-apps directory;
//  - the app row stores the absolute source path;
//  - a git repo is initialized in place in the source folder;
//  - an initial chat is created and is usable (chat:stream works against the
//    in-place app).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
import { registerImportHandlers } from "@/ipc/handlers/import_handlers";
import { invalidateDyadAppsBaseDirectoryCache } from "@/paths/paths";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";

const fakeEvent = { sender: { send: () => {}, isDestroyed: () => false } };

async function invoke(channel: string, params?: unknown): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(fakeEvent, params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

describe("import app in place (integration)", () => {
  let harness: ChatFlowHarness;
  let appsBaseDir: string;
  let sourceDir: string;

  beforeAll(async () => {
    appsBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-inplace-apps-"));
    // Copy the fixture to a temp dir (like the e2e did) so the original
    // fixture is never modified by the in-place git init.
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-inplace-src-"));
    fs.cpSync(
      path.join(
        process.cwd(),
        "e2e-tests",
        "fixtures",
        "import-app",
        "minimal",
      ),
      sourceDir,
      { recursive: true },
    );

    harness = await setupChatFlowHarness({
      electronMock: h,
      settings: { customAppsFolder: appsBaseDir },
    });
    invalidateDyadAppsBaseDirectoryCache();
    registerImportHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    fs.rmSync(appsBaseDir, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it("imports the app in place without copying to dyad-apps", async () => {
    // skipCopy means the filesystem check is skipped and only the db decides
    // whether the name is taken.
    await expect(
      invoke("check-app-name", { appName: "minimal-in-place", skipCopy: true }),
    ).resolves.toEqual({ exists: false });

    const result = await invoke("import-app", {
      path: sourceDir,
      appName: "minimal-in-place",
      skipCopy: true,
    });
    expect(result.appId).toBeGreaterThan(0);
    expect(result.chatId).toBeGreaterThan(0);

    // Nothing was copied into the dyad-apps folder.
    expect(fs.readdirSync(appsBaseDir)).toEqual([]);

    // The app row keeps the absolute source path.
    const appRow = await db.query.apps.findFirst({
      where: eq(apps.id, result.appId),
    });
    expect(appRow?.name).toBe("minimal-in-place");
    expect(appRow?.path).toBe(sourceDir);

    // A git repo was initialized in place, with an initial commit.
    expect(fs.existsSync(path.join(sourceDir, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, "src", "App.tsx"))).toBe(true);

    // The imported app is fully usable: a chat turn writes + commits in place.
    const { result: streamResult } = await harness.streamChat(
      "write something",
      { chatId: result.chatId },
    );
    expect(streamResult).toBe(result.chatId);
    // The canned fake-LLM reply writes file1.txt into the in-place app dir.
    expect(fs.existsSync(path.join(sourceDir, "file1.txt"))).toBe(true);
  }, 30_000);
});
