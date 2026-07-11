import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deployAffectedSupabaseFunctions: vi.fn(),
  readSettings: vi.fn(),
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

import {
  commitAllChanges,
  deployAllFunctionsIfNeeded,
} from "./file_operations";
import {
  gitAddAll,
  gitCommit,
  getGitUncommittedFiles,
} from "@/ipc/utils/git_utils";

vi.mock("@/ipc/utils/git_utils", () => ({
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(),
  getGitUncommittedFiles: vi.fn(),
}));

describe("deployAllFunctionsIfNeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockReturnValue({ skipPruneEdgeFunctions: false });
    mocks.deployAffectedSupabaseFunctions.mockResolvedValue([]);
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
});

describe("commitAllChanges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips repository hooks for automatic Agent commits", async () => {
    vi.mocked(getGitUncommittedFiles).mockResolvedValue(["src/app.ts"]);
    vi.mocked(gitCommit).mockResolvedValue("commit-hash");

    await expect(
      commitAllChanges({ appPath: "/test/app", supabaseProjectId: null }),
    ).resolves.toEqual({ commitHash: "commit-hash" });

    expect(gitAddAll).toHaveBeenCalledWith({
      path: "/test/app",
      disableHooks: true,
    });
    expect(gitCommit).toHaveBeenCalledWith({
      path: "/test/app",
      message: "[dyad] (1 files changed)",
      disableHooks: true,
    });
  });
});
