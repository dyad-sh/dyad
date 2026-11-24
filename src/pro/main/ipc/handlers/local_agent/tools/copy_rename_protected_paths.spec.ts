import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileTool } from "./copy_file";
import { renameFileTool } from "./rename_file";
import {
  appendAttachmentManifestEntries,
  getDyadMediaDir,
} from "@/ipc/utils/media_path_utils";

const { findApp, gitAdd, gitRemove } = vi.hoisted(() => ({
  findApp: vi.fn(),
  gitAdd: vi.fn(),
  gitRemove: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: (value: string) => value }));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: findApp } } },
}));
vi.mock("@/ipc/utils/git_utils", () => ({
  gitAdd,
  gitRemove,
  execGit: vi.fn(),
}));
vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: vi.fn(),
}));

describe("copy_file and rename_file protected paths", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-protected-"));
    findApp.mockResolvedValue({ path: appPath, supabaseProjectId: null });
    gitAdd.mockResolvedValue(undefined);
    gitRemove.mockResolvedValue(undefined);
    await fs.writeFile(path.join(appPath, ".env"), "TOKEN=secret\n");
    await fs.mkdir(path.join(appPath, ".git"));
    await fs.writeFile(path.join(appPath, ".git", "config"), "[remote]\n");
    await fs.writeFile(path.join(appPath, "notes.txt"), "hello\n");
    const mediaDir = getDyadMediaDir(appPath);
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, "stored-env"), "TOKEN=secret\n");
    await appendAttachmentManifestEntries(appPath, [
      {
        logicalName: ".env",
        originalName: ".env",
        storedFileName: "stored-env",
        mimeType: "text/plain",
        sizeBytes: 13,
        createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString(),
      },
    ]);
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  const ctx = () =>
    ({
      appId: 1,
      appPath,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
    }) as any;

  const exists = (relativePath: string) =>
    fs.access(path.join(appPath, relativePath)).then(
      () => true,
      () => false,
    );

  it.each([
    [".env", "leaked.txt"],
    [".env", "foo.env"],
    [".git/config", "leaked.txt"],
    ["attachments:.env", "leaked.txt"],
    ["notes.txt", ".git/hooks/pre-commit"],
  ])("copy_file rejects %s -> %s", async (from, to) => {
    await expect(copyFileTool.execute({ from, to }, ctx())).rejects.toThrow(
      /protected/i,
    );
    expect(await exists(to)).toBe(false);
    expect(gitAdd).not.toHaveBeenCalled();
  });

  it.each([
    [".env", "leaked.txt"],
    [".env", "foo.env"],
    [".git/config", "leaked.txt"],
    ["notes.txt", ".git/hooks/pre-commit"],
  ])("rename_file rejects %s -> %s", async (from, to) => {
    await expect(renameFileTool.execute({ from, to }, ctx())).rejects.toThrow(
      /protected/i,
    );
    expect(await exists(from)).toBe(true);
    expect(await exists(to)).toBe(false);
    expect(gitAdd).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")(
    "copy_file rejects a symlink alias of .env",
    async () => {
      await fs.symlink(".env", path.join(appPath, "alias.txt"));
      await expect(
        copyFileTool.execute({ from: "alias.txt", to: "leaked.txt" }, ctx()),
      ).rejects.toThrow(/protected/i);
      expect(await exists("leaked.txt")).toBe(false);
    },
  );

  it("still copies and renames ordinary files", async () => {
    await expect(
      copyFileTool.execute({ from: "notes.txt", to: "copy.txt" }, ctx()),
    ).resolves.toBe("Successfully copied notes.txt to copy.txt");
    await expect(
      renameFileTool.execute({ from: "copy.txt", to: "moved.txt" }, ctx()),
    ).resolves.toBe("Successfully renamed copy.txt to moved.txt");
  });
});
