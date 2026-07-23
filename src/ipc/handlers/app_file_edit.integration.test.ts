import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { apps } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerAppHandlers } from "./app_handlers";
import { registerVersionHandlers } from "./version_handlers";

const TEMP_BASE = path.join(os.tmpdir(), "dyad-app-file-edit-handler-tests");

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  app: {
    getPath: vi.fn(() =>
      path.join(os.tmpdir(), "dyad-app-file-edit-user-data"),
    ),
    getAppPath: vi.fn(() => process.cwd()),
  },
  dialog: { showOpenDialog: vi.fn() },
}));

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  const nodePath = await import("node:path");
  const base = nodePath.join(
    (await import("node:os")).tmpdir(),
    "dyad-app-file-edit-handler-tests",
  );
  return {
    ...actual,
    getDyadAppPath: (appPath: string) =>
      nodePath.isAbsolute(appPath) ? appPath : nodePath.join(base, appPath),
    isAppLocationAccessible: () => true,
  };
});

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  createCloudSandboxShareLink: vi.fn(),
  getCloudSandboxStatus: vi.fn(),
  queueCloudSandboxSnapshotSync: vi.fn(),
  reconcileCloudSandboxes: vi.fn(async () => {}),
  registerCloudSandboxSyncUpdateListener: vi.fn(),
  restartCloudSandbox: vi.fn(),
  setCloudSandboxSyncUpdateListener: vi.fn(),
  startCloudSandboxLogStream: vi.fn(),
  syncCloudSandboxSnapshot: vi.fn(),
}));

vi.mock("@/ipc/handlers/createFromTemplate", () => ({
  createFromTemplate: vi.fn(),
}));

vi.mock("@/ipc/handlers/gitignoreUtils", () => ({
  ensureDyadGitignored: vi.fn(async () => {}),
}));

vi.mock("@/ipc/handlers/chat_mode_resolution", () => ({
  getInitialChatModeForNewChat: vi.fn(async () => "build"),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeFile(appPath: string, filePath: string, content: string) {
  const fullPath = path.join(appPath, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function initRepoWithTip(appPath: string) {
  fs.mkdirSync(appPath, { recursive: true });
  git(appPath, ["init"]);
  git(appPath, ["config", "user.email", "test@example.com"]);
  git(appPath, ["config", "user.name", "Test User"]);
  writeFile(appPath, "src/App.tsx", "tip\n");
  git(appPath, ["add", "src/App.tsx"]);
  git(appPath, ["commit", "-m", "initial"]);
  git(appPath, ["branch", "-M", "feature/test"]);
  const tipOid = git(appPath, ["rev-parse", "HEAD"]);
  git(appPath, ["checkout", "--detach", tipOid]);
  return { tipOid };
}

describe("edit-app-file version diff safety", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEMP_BASE, { recursive: true });
    harness = setupHandlerTestHarness();
    registerAppHandlers();
    registerVersionHandlers();
  });

  afterEach(() => {
    harness.dispose();
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
  });

  function seedGitApp(relativePath: string) {
    const appPath = path.join(TEMP_BASE, relativePath);
    const { tipOid } = initRepoWithTip(appPath);
    const result = harness.db
      .insert(apps)
      .values({ name: relativePath, path: relativePath })
      .run();
    return { appId: Number(result.lastInsertRowid), appPath, tipOid };
  }

  it("rejects a version-diff save when the writable branch tip moved", async () => {
    const { appId, appPath, tipOid } = seedGitApp("moved-tip");
    git(appPath, ["checkout", "feature/test"]);
    writeFile(appPath, "src/App.tsx", "newer tip\n");
    git(appPath, ["add", "src/App.tsx"]);
    git(appPath, ["commit", "-m", "move branch"]);
    git(appPath, ["checkout", "--detach", tipOid]);

    await expect(
      harness.invokeHandler("edit-app-file", {
        appId,
        filePath: "src/App.tsx",
        content: "edited\n",
        targetBranchName: "feature/test",
        expectedBranchTipOid: tipOid,
        expectedFileContent: "tip\n",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Conflict,
      message:
        "Cannot save this version diff because the branch has changed. Reopen the latest version and try again.",
    });

    expect(fs.readFileSync(path.join(appPath, "src/App.tsx"), "utf-8")).toBe(
      "tip\n",
    );
    expect(git(appPath, ["branch", "--show-current"])).toBe("");
  });

  it("rejects a version-diff save when the file changed on disk", async () => {
    const { appId, appPath, tipOid } = seedGitApp("stale-disk");
    writeFile(appPath, "src/App.tsx", "external edit\n");

    await expect(
      harness.invokeHandler("edit-app-file", {
        appId,
        filePath: "src/App.tsx",
        content: "edited\n",
        targetBranchName: "feature/test",
        expectedBranchTipOid: tipOid,
        expectedFileContent: "tip\n",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Conflict,
      message:
        "Cannot save this version diff because the file has changed on disk. Reopen the latest version and try again.",
    });

    expect(fs.readFileSync(path.join(appPath, "src/App.tsx"), "utf-8")).toBe(
      "external edit\n",
    );
    expect(git(appPath, ["branch", "--show-current"])).toBe("");
  });

  it("reattaches from detached HEAD, writes the file, and stages the edit", async () => {
    const { appId, appPath, tipOid } = seedGitApp("reattach-and-stage");

    const result = await harness.invokeHandler<{
      switchedToMainBranch?: boolean;
    }>("edit-app-file", {
      appId,
      filePath: "src/App.tsx",
      content: "edited\n",
      targetBranchName: "feature/test",
      expectedBranchTipOid: tipOid,
      expectedFileContent: "tip\n",
    });

    expect(result.switchedToMainBranch).toBe(true);
    expect(git(appPath, ["branch", "--show-current"])).toBe("feature/test");
    expect(fs.readFileSync(path.join(appPath, "src/App.tsx"), "utf-8")).toBe(
      "edited\n",
    );
    expect(git(appPath, ["diff", "--cached", "--name-only"])).toBe(
      "src/App.tsx",
    );
  });
});
