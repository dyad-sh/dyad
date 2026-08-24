import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  getGitUncommittedFiles: vi.fn(),
  getCurrentCommitHash: vi.fn(),
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(),
  deployAffectedSupabaseFunctions: vi.fn(),
  deleteSupabaseFunction: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      error: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  getGitUncommittedFiles: mocks.getGitUncommittedFiles,
  getCurrentCommitHash: mocks.getCurrentCommitHash,
  gitAddAll: mocks.gitAddAll,
  gitCommit: mocks.gitCommit,
}));

vi.mock("../../../../../../supabase_admin/supabase_utils", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../../supabase_admin/supabase_utils")
  >("../../../../../../supabase_admin/supabase_utils");

  return {
    ...actual,
    deployAffectedSupabaseFunctions: mocks.deployAffectedSupabaseFunctions,
  };
});

vi.mock("../../../../../../main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("@/supabase_admin/supabase_management_client", () => ({
  deleteSupabaseFunction: mocks.deleteSupabaseFunction,
}));

import {
  commitAllChanges,
  deployAllFunctionsIfNeeded,
  isSupabaseFunctionNotFoundError,
  reconcileDeferredFunctionOperations,
  supabaseFunctionEntryExists,
} from "./file_operations";

describe("commitAllChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGitUncommittedFiles.mockResolvedValue(["src/App.tsx"]);
    mocks.getCurrentCommitHash.mockResolvedValue("current-head");
    mocks.gitCommit.mockResolvedValue("commit-hash");
  });

  it("uses the file-count fallback for a whitespace-only chat summary", async () => {
    const result = await commitAllChanges(
      {
        appId: 1,
        appPath: "/mock/app",
        supabaseProjectId: null,
      },
      "   ",
    );

    expect(mocks.gitAddAll).toHaveBeenCalledWith({ path: "/mock/app" });
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/mock/app",
      message: "(1 files changed)",
      noVerify: true,
    });
    expect(result).toEqual({ commitHash: "commit-hash" });
  });

  it("serializes the complete same-app checkpoint and rechecks status", async () => {
    let releaseFirst!: () => void;
    const firstCommit = new Promise<string>((resolve) => {
      releaseFirst = () => resolve("first-hash");
    });
    mocks.getGitUncommittedFiles
      .mockResolvedValueOnce(["first.ts"])
      .mockResolvedValueOnce([]);
    mocks.gitCommit.mockReturnValueOnce(firstCommit);

    const first = commitAllChanges({
      appId: 9,
      appPath: "/mock/app",
      fileMutationCount: 1,
      supabaseProjectId: null,
    });
    const second = commitAllChanges({
      appId: 9,
      appPath: "/mock/app",
      fileMutationCount: 1,
      supabaseProjectId: null,
    });
    await vi.waitFor(() => expect(mocks.gitCommit).toHaveBeenCalledOnce());
    expect(mocks.getGitUncommittedFiles).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).resolves.toEqual({ commitHash: "first-hash" });
    await expect(second).resolves.toEqual({ commitHash: "current-head" });
    expect(mocks.getGitUncommittedFiles).toHaveBeenCalledTimes(2);
    expect(mocks.gitAddAll).toHaveBeenCalledOnce();
  });

  it("does not attribute an existing commit to a clean no-op turn", async () => {
    mocks.getGitUncommittedFiles.mockResolvedValue([]);

    await expect(
      commitAllChanges({
        appId: 1,
        appPath: "/mock/app",
        fileMutationCount: 0,
        supabaseProjectId: null,
      }),
    ).resolves.toEqual({ commitHash: undefined });

    expect(mocks.getCurrentCommitHash).not.toHaveBeenCalled();
  });

  it("keeps a clean mutated turn successful when HEAD cannot be resolved", async () => {
    mocks.getGitUncommittedFiles.mockResolvedValue([]);
    mocks.getCurrentCommitHash.mockRejectedValue(new Error("missing HEAD"));

    await expect(
      commitAllChanges({
        appId: 1,
        appPath: "/mock/app",
        fileMutationCount: 1,
        supabaseProjectId: null,
      }),
    ).resolves.toEqual({ commitHash: undefined });
  });
});

describe("deployAllFunctionsIfNeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockReturnValue({ skipPruneEdgeFunctions: false });
    mocks.deployAffectedSupabaseFunctions.mockResolvedValue([]);
    mocks.deleteSupabaseFunction.mockResolvedValue(undefined);
  });

  it("delegates shared changes and skipped direct function deploys to the shared deploy helper", async () => {
    const access = vi.spyOn(fs, "access").mockResolvedValueOnce(undefined);
    try {
      const result = await deployAllFunctionsIfNeeded({
        appId: 1,
        appPath: "/apps/test",
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: null,
        isSharedModulesChanged: true,
        sharedServerModulePaths: ["supabase/functions/_shared/foo.ts"],
        pendingFunctionDeploys: ["beta"],
        onXmlStream: vi.fn(),
        onXmlComplete: vi.fn(),
      });

      expect(result).toEqual({ success: true });
      expect(mocks.deployAffectedSupabaseFunctions).toHaveBeenCalledWith(
        expect.objectContaining({
          appPath: "/apps/test",
          supabaseProjectId: "project-id",
          supabaseOrganizationSlug: null,
          skipPruneEdgeFunctions: false,
          sharedModulesChanged: true,
          changedSharedModulePaths: ["supabase/functions/_shared/foo.ts"],
          pendingFunctionDeploys: ["beta"],
          onProgress: expect.any(Function),
        }),
      );
    } finally {
      access.mockRestore();
    }
  });

  it("serializes same-app reconciliation and rechecks after admission", async () => {
    const access = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    let releaseFirst!: () => void;
    mocks.deployAffectedSupabaseFunctions.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          releaseFirst = () => resolve([]);
        }),
    );
    const context = {
      appId: 12,
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: ["alpha"],
      pendingFunctionDeletes: [],
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    };
    try {
      const first = deployAllFunctionsIfNeeded(context);
      const second = deployAllFunctionsIfNeeded(context);
      await vi.waitFor(() =>
        expect(mocks.deployAffectedSupabaseFunctions).toHaveBeenCalledOnce(),
      );
      expect(access).toHaveBeenCalledTimes(1);

      releaseFirst();
      await expect(first).resolves.toEqual({ success: true });
      await expect(second).resolves.toEqual({ success: true });
      expect(access).toHaveBeenCalledTimes(2);
      expect(mocks.deployAffectedSupabaseFunctions).toHaveBeenCalledTimes(2);
    } finally {
      access.mockRestore();
    }
  });

  it("returns coordinator admission failures as deploy results", async () => {
    const { appOperationCoordinator } =
      await import("@/ipc/services/app_operation_coordinator");
    const run = vi
      .spyOn(appOperationCoordinator, "run")
      .mockRejectedValueOnce(new Error("recording active"));
    try {
      await expect(
        deployAllFunctionsIfNeeded({
          appId: 1,
          appPath: "/apps/test",
          supabaseProjectId: "project-id",
          supabaseOrganizationSlug: null,
          isSharedModulesChanged: true,
          sharedServerModulePaths: [],
          pendingFunctionDeploys: [],
          onXmlStream: vi.fn(),
          onXmlComplete: vi.fn(),
        }),
      ).resolves.toEqual({
        success: false,
        error: expect.stringContaining("recording active"),
      });
    } finally {
      run.mockRestore();
    }
  });

  it("returns deploy warnings from the shared helper", async () => {
    mocks.deployAffectedSupabaseFunctions.mockResolvedValueOnce([
      "Failed to bundle alpha",
    ]);
    const result = await deployAllFunctionsIfNeeded({
      appId: 1,
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: true,
      sharedServerModulePaths: ["supabase/functions/_shared/unused.ts"],
      pendingFunctionDeploys: [],
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    });

    expect(result).toEqual({
      success: true,
      warning:
        "Some Supabase functions failed to deploy: Failed to bundle alpha",
    });
  });

  it("runs deferred child function deletions during root finalization", async () => {
    const result = await deployAllFunctionsIfNeeded({
      appId: 1,
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: "org",
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
      pendingFunctionDeletes: ["old-function", "old-function"],
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    });

    expect(result).toEqual({ success: true });
    expect(mocks.deleteSupabaseFunction).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSupabaseFunction).toHaveBeenCalledWith({
      supabaseProjectId: "project-id",
      functionName: "old-function",
      organizationSlug: "org",
    });
    expect(mocks.deployAffectedSupabaseFunctions).not.toHaveBeenCalled();
  });

  it("treats an already-missing deferred function as deleted", async () => {
    mocks.deleteSupabaseFunction.mockRejectedValueOnce({
      response: { status: 404 },
    });

    const result = await deployAllFunctionsIfNeeded({
      appId: 1,
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
      pendingFunctionDeletes: ["never-deployed"],
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    });

    expect(result).toEqual({ success: true });
    expect(isSupabaseFunctionNotFoundError({ response: { status: 404 } })).toBe(
      true,
    );
  });

  it("preserves deferred remote deletions when pruning is disabled", async () => {
    mocks.readSettings.mockReturnValueOnce({ skipPruneEdgeFunctions: true });

    const result = await deployAllFunctionsIfNeeded({
      appId: 1,
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
      pendingFunctionDeletes: ["preserved"],
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    });

    expect(result).toEqual({
      success: true,
      warning:
        'Kept remote Supabase function(s) preserved because "Keep extra Supabase edge functions" is enabled.',
    });
    expect(mocks.deleteSupabaseFunction).not.toHaveBeenCalled();
  });

  it("does not delete remotely when local function inspection is uncertain", async () => {
    const access = vi.spyOn(fs, "access").mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), {
        code: "EACCES",
      }),
    );
    const result = await deployAllFunctionsIfNeeded({
      appId: 1,
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
      pendingFunctionDeletes: ["uncertain"],
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    });

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("permission denied"),
    });
    expect(mocks.deleteSupabaseFunction).not.toHaveBeenCalled();
    access.mockRestore();
  });
});

describe("reconcileDeferredFunctionOperations", () => {
  it("deploys a function restored after a deferred delete", async () => {
    await expect(
      reconcileDeferredFunctionOperations({
        pendingDeploys: [],
        pendingDeletes: ["restored"],
        functionExists: (name) => name === "restored",
      }),
    ).resolves.toEqual({ deploys: ["restored"], deletes: [] });
  });

  it("deletes a function removed after a deferred deploy", async () => {
    await expect(
      reconcileDeferredFunctionOperations({
        pendingDeploys: ["removed"],
        pendingDeletes: ["removed"],
        functionExists: () => false,
      }),
    ).resolves.toEqual({ deploys: [], deletes: ["removed"] });
  });

  it("drops a deploy-only function removed before finalization", async () => {
    await expect(
      reconcileDeferredFunctionOperations({
        pendingDeploys: ["removed"],
        pendingDeletes: [],
        functionExists: () => false,
      }),
    ).resolves.toEqual({ deploys: [], deletes: ["removed"] });
  });
});

describe("supabaseFunctionEntryExists", () => {
  it("requires the concrete index.ts entry point", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-functions-"));
    const functionPath = path.join(appPath, "supabase", "functions", "hello");
    try {
      await fs.mkdir(functionPath, { recursive: true });
      await expect(supabaseFunctionEntryExists(appPath, "hello")).resolves.toBe(
        false,
      );

      await fs.writeFile(path.join(functionPath, "index.ts"), "export {};");
      await expect(supabaseFunctionEntryExists(appPath, "hello")).resolves.toBe(
        true,
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });
});
