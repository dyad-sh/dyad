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

import { deployAllFunctionsIfNeeded } from "./file_operations";

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
