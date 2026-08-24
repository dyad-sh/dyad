import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFileWriteKey } from "@/ipc/utils/lock_utils";
import { deleteFileTool } from "./delete_file";
import { renameFileTool } from "./rename_file";

const {
  gitAdd,
  gitRemove,
  queueCloudSandboxSnapshotSync,
  withLockSpy,
  withLocksSpy,
} = vi.hoisted(() => ({
  gitAdd: vi.fn(),
  gitRemove: vi.fn(),
  queueCloudSandboxSnapshotSync: vi.fn(),
  withLockSpy: vi.fn(),
  withLocksSpy: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/ipc/utils/git_utils", () => ({ gitAdd, gitRemove }));
vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync,
}));
vi.mock("@/ipc/utils/lock_utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/lock_utils")>();
  withLockSpy.mockImplementation(actual.withLock);
  withLocksSpy.mockImplementation(actual.withLocks);
  return {
    ...actual,
    withLock: withLockSpy,
    withLocks: withLocksSpy,
  };
});
vi.mock("../../../../../../supabase_admin/supabase_management_client", () => ({
  deleteSupabaseFunction: vi.fn(),
  deploySupabaseFunction: vi.fn(),
}));

describe("Local Agent mutation path locks", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-path-locks-"));
    gitAdd.mockResolvedValue(undefined);
    gitRemove.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function context() {
    return {
      appId: 123456,
      appPath,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
    } as any;
  }

  it("deletes under the physical path's mutation lock", async () => {
    const filePath = path.join(appPath, "victim.ts");
    const physicalAppPath = await fs.realpath(appPath);
    await fs.writeFile(filePath, "delete me");

    await deleteFileTool.execute({ path: "victim.ts" }, context());

    expect(withLockSpy).toHaveBeenCalledWith(
      getFileWriteKey(path.join(physicalAppPath, "victim.ts")),
      expect.any(Function),
    );
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("renames under both physical path mutation locks", async () => {
    const sourcePath = path.join(appPath, "source.ts");
    const destinationPath = path.join(appPath, "destination.ts");
    await fs.writeFile(sourcePath, "source");

    await renameFileTool.execute(
      { from: "source.ts", to: "destination.ts" },
      context(),
    );

    expect(withLocksSpy).toHaveBeenCalledWith(
      [getFileWriteKey(sourcePath), getFileWriteKey(destinationPath)],
      expect.any(Function),
    );
    await expect(fs.stat(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(destinationPath, "utf8")).resolves.toBe("source");
  });
});
