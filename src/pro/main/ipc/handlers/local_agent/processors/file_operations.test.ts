import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deployAllSupabaseFunctions: vi.fn(),
  deploySupabaseFunctions: vi.fn(),
  getSupabaseFunctionsAffectedBySharedModules: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("../../../../../../supabase_admin/supabase_utils", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../../supabase_admin/supabase_utils")
  >("../../../../../../supabase_admin/supabase_utils");

  return {
    ...actual,
    deployAllSupabaseFunctions: mocks.deployAllSupabaseFunctions,
    deploySupabaseFunctions: mocks.deploySupabaseFunctions,
    getSupabaseFunctionsAffectedBySharedModules:
      mocks.getSupabaseFunctionsAffectedBySharedModules,
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
    mocks.deployAllSupabaseFunctions.mockResolvedValue([]);
    mocks.deploySupabaseFunctions.mockResolvedValue([]);
    mocks.getSupabaseFunctionsAffectedBySharedModules.mockResolvedValue({
      kind: "partial",
      functionNames: ["alpha"],
    });
  });

  it("deploys the union of shared-affected functions and skipped direct function deploys", async () => {
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
    expect(
      mocks.getSupabaseFunctionsAffectedBySharedModules,
    ).toHaveBeenCalledWith({
      appPath: "/apps/test",
      changedSharedModulePaths: ["supabase/functions/_shared/foo.ts"],
    });
    expect(mocks.deploySupabaseFunctions).toHaveBeenCalledWith(
      expect.objectContaining({
        functionNames: ["alpha", "beta"],
      }),
    );
    expect(mocks.deployAllSupabaseFunctions).not.toHaveBeenCalled();
  });

  it("falls back to all function deploys when analysis is ambiguous", async () => {
    mocks.getSupabaseFunctionsAffectedBySharedModules.mockResolvedValueOnce({
      kind: "all",
      reason: "unresolved_relative_import:../_shared/foo.ts",
    });

    const result = await deployAllFunctionsIfNeeded({
      appPath: "/apps/test",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: "org",
      isSharedModulesChanged: true,
      sharedServerModulePaths: ["supabase/functions/_shared/foo.ts"],
      pendingFunctionDeploys: ["beta"],
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    });

    expect(result).toEqual({ success: true });
    expect(mocks.deployAllSupabaseFunctions).toHaveBeenCalledWith(
      expect.objectContaining({
        appPath: "/apps/test",
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: "org",
      }),
    );
    expect(mocks.deploySupabaseFunctions).not.toHaveBeenCalled();
  });
});
