import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import type { AgentContext } from "./types";

const {
  assertPathNotGitMetadataMock,
  gitAddMock,
  gitRemoveMock,
  queueCloudSandboxSnapshotSyncMock,
} = vi.hoisted(() => ({
  assertPathNotGitMetadataMock: vi.fn(),
  gitAddMock: vi.fn(),
  gitRemoveMock: vi.fn(),
  queueCloudSandboxSnapshotSyncMock: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      renameSync: vi.fn(),
    },
  };
});

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

vi.mock("@/ipc/utils/path_utils", () => ({
  assertPathNotGitMetadata: assertPathNotGitMetadataMock,
  safeJoin: (basePath: string, relativePath: string) =>
    `${basePath}/${relativePath}`,
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  gitAdd: gitAddMock,
  gitRemove: gitRemoveMock,
}));

vi.mock("../../../../../../supabase_admin/supabase_management_client", () => ({
  deploySupabaseFunction: vi.fn(),
  deleteSupabaseFunction: vi.fn(),
}));

vi.mock("../../../../../../supabase_admin/supabase_utils", () => ({
  extractFunctionNameFromPath: vi.fn(),
  isServerFunction: vi.fn().mockReturnValue(false),
  isSharedServerModule: vi.fn().mockReturnValue(false),
}));

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: queueCloudSandboxSnapshotSyncMock,
}));

import { renameFileTool } from "./rename_file";

describe("renameFileTool", () => {
  const context = {
    appId: 1,
    appPath: "/test/app",
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
  } as unknown as AgentContext;

  beforeEach(() => {
    vi.clearAllMocks();
    assertPathNotGitMetadataMock.mockResolvedValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    gitAddMock.mockResolvedValue(undefined);
    gitRemoveMock.mockResolvedValue(undefined);
  });

  it("validates both paths and suppresses hooks while updating the index", async () => {
    await expect(
      renameFileTool.execute({ from: "src/old.ts", to: "src/new.ts" }, context),
    ).resolves.toBe("Successfully renamed src/old.ts to src/new.ts");

    expect(assertPathNotGitMetadataMock.mock.calls).toEqual([
      [{ appPath: "/test/app", relativePath: "src/old.ts" }],
      [{ appPath: "/test/app", relativePath: "src/new.ts" }],
    ]);
    expect(fs.renameSync).toHaveBeenCalledWith(
      "/test/app/src/old.ts",
      "/test/app/src/new.ts",
    );
    expect(gitAddMock).toHaveBeenCalledWith({
      path: "/test/app",
      filepath: "src/new.ts",
      disableHooks: true,
    });
    expect(gitRemoveMock).toHaveBeenCalledWith({
      path: "/test/app",
      filepath: "src/old.ts",
      disableHooks: true,
    });
  });

  it("does not touch the filesystem when either path is rejected", async () => {
    assertPathNotGitMetadataMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("cannot modify Git metadata"));

    await expect(
      renameFileTool.execute(
        { from: "src/app.ts", to: ".git/config" },
        context,
      ),
    ).rejects.toThrow("cannot modify Git metadata");

    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
    expect(gitAddMock).not.toHaveBeenCalled();
    expect(gitRemoveMock).not.toHaveBeenCalled();
  });
});
