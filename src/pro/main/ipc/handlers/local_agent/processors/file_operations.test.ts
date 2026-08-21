import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  getGitUncommittedFiles: vi.fn(),
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
    }),
  },
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  getGitUncommittedFiles: mocks.getGitUncommittedFiles,
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
  reconcileDeferredFunctionOperations,
  supabaseFunctionEntryExists,
} from "./file_operations";

describe("commitAllChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGitUncommittedFiles.mockResolvedValue(["src/App.tsx"]);
    mocks.gitCommit.mockResolvedValue("commit-hash");
  });

  it("uses the file-count fallback for a whitespace-only chat summary", async () => {
    const result = await commitAllChanges(
      {
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
});

describe("deployAllFunctionsIfNeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockReturnValue({ skipPruneEdgeFunctions: false });
    mocks.deployAffectedSupabaseFunctions.mockResolvedValue([]);
    mocks.deleteSupabaseFunction.mockResolvedValue(undefined);
  });

  it("delegates shared changes and skipped direct function deploys to the shared deploy helper", async () => {
    const result = await deployAllFunctionsIfNeeded({
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
  });

  it("returns deploy warnings from the shared helper", async () => {
    mocks.deployAffectedSupabaseFunctions.mockResolvedValueOnce([
      "Failed to bundle alpha",
    ]);
    const result = await deployAllFunctionsIfNeeded({
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

  it("does not delete remotely when local function inspection is uncertain", async () => {
    const access = vi.spyOn(fs, "access").mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), {
        code: "EACCES",
      }),
    );
    const result = await deployAllFunctionsIfNeeded({
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
