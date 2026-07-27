import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";

const mocks = vi.hoisted(() => ({
  deployAffectedSupabaseFunctions: vi.fn(),
  readSettings: vi.fn(),
  getGitUncommittedFiles: vi.fn(),
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(),
  hasStagedChanges: vi.fn(),
}));

vi.mock("@/supabase_admin/supabase_utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/supabase_admin/supabase_utils")
  >("@/supabase_admin/supabase_utils");
  return {
    ...actual,
    deployAffectedSupabaseFunctions: mocks.deployAffectedSupabaseFunctions,
  };
});

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("@/ipc/utils/git_utils", async () => {
  const actual = await vi.importActual<typeof import("@/ipc/utils/git_utils")>(
    "@/ipc/utils/git_utils",
  );
  return {
    ...actual,
    getGitUncommittedFiles: mocks.getGitUncommittedFiles,
    gitAddAll: mocks.gitAddAll,
    gitCommit: mocks.gitCommit,
    hasStagedChanges: mocks.hasStagedChanges,
  };
});

import {
  commitPiTurnChanges,
  deployPiSupabaseFunctions,
} from "./file_operations";

describe("deployPiSupabaseFunctions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockReturnValue({ skipPruneEdgeFunctions: false });
    mocks.deployAffectedSupabaseFunctions.mockResolvedValue([]);
  });

  it("deploys shared changes and records the final status card", async () => {
    mocks.deployAffectedSupabaseFunctions.mockImplementation(
      async ({ onProgress }) => {
        onProgress({
          phase: "finished",
          completed: 2,
          total: 2,
          active: 0,
          queued: 0,
          succeeded: 2,
          failed: 0,
        });
        return [];
      },
    );

    const result = await deployPiSupabaseFunctions({
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: true,
      sharedServerModulePaths: ["supabase/functions/_shared/foo.ts"],
      pendingFunctionDeploys: ["beta"],
    });

    expect(mocks.deployAffectedSupabaseFunctions).toHaveBeenCalledWith(
      expect.objectContaining({
        sharedModulesChanged: true,
        changedSharedModulePaths: ["supabase/functions/_shared/foo.ts"],
        pendingFunctionDeploys: ["beta"],
      }),
    );
    expect(result.warningMessages).toEqual([]);
    expect(result.xmlParts.join("\n")).toContain(
      "Supabase functions deployed: 2/2 complete",
    );
  });

  it("surfaces deploy failures as persisted warning output", async () => {
    mocks.deployAffectedSupabaseFunctions.mockResolvedValue([
      "Failed to bundle alpha",
    ]);

    const result = await deployPiSupabaseFunctions({
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: true,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
    });

    expect(result.warningMessages).toEqual([
      "Some Supabase functions failed to deploy: Failed to bundle alpha",
    ]);
    expect(result.xmlParts.join("\n")).toContain('dyad-output type="warning"');
  });

  it("does not turn cancellation into a persisted deploy warning", async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.deployAffectedSupabaseFunctions.mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    await expect(
      deployPiSupabaseFunctions({
        appPath: "/apps/test",
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: null,
        isSharedModulesChanged: true,
        sharedServerModulePaths: [],
        pendingFunctionDeploys: [],
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.UserCancelled });
  });
});

describe("commitPiTurnChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGitUncommittedFiles.mockResolvedValue(["src/hello.ts"]);
    mocks.gitAddAll.mockResolvedValue(undefined);
    mocks.gitCommit.mockResolvedValue("commit-hash");
    mocks.hasStagedChanges.mockResolvedValue(true);
  });

  it("skips the commit when detected changes produce no staged diff", async () => {
    mocks.hasStagedChanges.mockResolvedValue(false);

    await expect(commitPiTurnChanges("/apps/test")).resolves.toBeUndefined();
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("accepts a concurrent commit that consumes the staged diff", async () => {
    mocks.hasStagedChanges
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mocks.gitCommit.mockRejectedValue(new Error("nothing to commit"));

    await expect(commitPiTurnChanges("/apps/test")).resolves.toBeUndefined();
  });

  it("still surfaces commit failures when staged changes remain", async () => {
    mocks.gitCommit.mockRejectedValue(new Error("commit hook failed"));

    await expect(commitPiTurnChanges("/apps/test")).rejects.toThrow(
      "Failed to commit changes: Error: commit hook failed",
    );
  });
});
