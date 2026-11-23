// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileSupabaseFunctions } from "./supabase_function_reconcile";
import { SupabaseFunctionSyncDeferredError } from "./supabase_recording_deferred_sync";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  deployAffected: vi.fn(),
  deleteFunction: vi.fn(),
}));

vi.mock("./supabase_utils", () => ({
  supabaseFunctionEntryExists: mocks.exists,
  deployAffectedSupabaseFunctions: mocks.deployAffected,
}));
vi.mock("./supabase_management_client", () => ({
  deleteSupabaseFunction: mocks.deleteFunction,
}));

const target = {
  appId: 3,
  appPath: "/apps/demo",
  supabaseProjectId: "project-id",
  organizationSlug: "org",
  skipPruneEdgeFunctions: false,
  pruneDanglingFunctions: false,
  functionNames: ["alpha", "gone"],
  sharedModulesChanged: false,
  sharedModulePaths: [],
};

describe("reconcileSupabaseFunctions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exists.mockImplementation(
      async (_appPath: string, name: string) => name !== "gone",
    );
    mocks.deployAffected.mockResolvedValue([]);
    mocks.deleteFunction.mockResolvedValue(undefined);
  });

  it("deploys what the app's folder has and deletes what it lacks", async () => {
    expect(await reconcileSupabaseFunctions(target)).toEqual([]);

    expect(mocks.deleteFunction).toHaveBeenCalledWith({
      appId: 3,
      supabaseProjectId: "project-id",
      functionName: "gone",
      organizationSlug: "org",
    });
    expect(mocks.deployAffected).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 3,
        appPath: "/apps/demo",
        pendingFunctionDeploys: ["alpha"],
        // Other chats may have deployed functions the folder lacks yet.
        skipPruneEdgeFunctions: true,
      }),
    );
  });

  it("prunes like any app deploy when asked to", async () => {
    await reconcileSupabaseFunctions({
      ...target,
      pruneDanglingFunctions: true,
    });
    expect(mocks.deployAffected).toHaveBeenCalledWith(
      expect.objectContaining({ skipPruneEdgeFunctions: false }),
    );
  });

  it("keeps functions the folder lacks when the user keeps extra functions", async () => {
    await reconcileSupabaseFunctions({
      ...target,
      skipPruneEdgeFunctions: true,
      pruneDanglingFunctions: true,
    });
    expect(mocks.deleteFunction).not.toHaveBeenCalled();
    expect(mocks.deployAffected).toHaveBeenCalledWith(
      expect.objectContaining({ skipPruneEdgeFunctions: true }),
    );
  });

  it("redeploys functions a changed shared module affects", async () => {
    await reconcileSupabaseFunctions({
      ...target,
      functionNames: [],
      sharedModulesChanged: true,
      sharedModulePaths: ["supabase/functions/_shared/cors.ts"],
    });
    expect(mocks.deployAffected).toHaveBeenCalledWith(
      expect.objectContaining({
        sharedModulesChanged: true,
        changedSharedModulePaths: ["supabase/functions/_shared/cors.ts"],
        pendingFunctionDeploys: [],
      }),
    );
  });

  it("reports failed deletes, but not missing functions or deferred ones", async () => {
    mocks.exists.mockResolvedValue(false);
    mocks.deleteFunction.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "missing") {
          throw Object.assign(new Error("not found"), {
            response: new Response(null, { status: 404 }),
          });
        }
        if (functionName === "deferred") {
          throw new SupabaseFunctionSyncDeferredError();
        }
        throw new Error("boom");
      },
    );

    const errors = await reconcileSupabaseFunctions({
      ...target,
      functionNames: ["missing", "deferred", "broken"],
    });

    expect(errors).toEqual(["delete broken: Error: boom"]);
    expect(mocks.deployAffected).not.toHaveBeenCalled();
  });
});
