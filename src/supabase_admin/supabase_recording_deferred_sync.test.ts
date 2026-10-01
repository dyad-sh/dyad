// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { activeRecordings } from "@/ipc/services/recording_registry";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import { withSupabaseFunctionDeployment } from "./supabase_management_client";
import {
  isSupabaseFunctionSyncDeferred,
  resetDeferredSupabaseFunctionSyncForTests,
} from "./supabase_recording_deferred_sync";

const mocks = vi.hoisted(() => ({
  findApp: vi.fn(),
  functionExists: vi.fn(),
  deployAffected: vi.fn(),
  deployAll: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/paths/paths", () => ({ getDyadAppPath: (value: string) => value }));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: mocks.findApp } } },
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    skipPruneEdgeFunctions: false,
    supabase: {
      accessToken: { value: "test-token" },
      expiresIn: 60 * 60,
      tokenTimestamp: Math.floor(Date.now() / 1000),
    },
  }),
  writeSettings: vi.fn(),
}));
vi.mock("./supabase_utils", () => ({
  supabaseFunctionEntryExists: mocks.functionExists,
  deployAffectedSupabaseFunctions: mocks.deployAffected,
  deployAllSupabaseFunctions: mocks.deployAll,
}));

function startRecording(appId: number) {
  let end!: () => void;
  const done = new Promise<{ envRestored: boolean }>((resolve) => {
    end = () => {
      activeRecordings.delete(appId);
      resolve({ envRestored: true });
    };
  });
  activeRecordings.set(appId, { appId, stop: () => {}, done });
  return end;
}

const sync = {
  organizationSlug: null,
  functionNames: ["alpha", "gone"],
  sharedModulesChanged: true,
  sharedModulePaths: ["supabase/functions/_shared/cors.ts"],
};

describe("Supabase function sync during a recording", () => {
  beforeEach(() => {
    mocks.findApp.mockResolvedValue({
      supabaseProjectId: "project-id",
      path: "/apps/demo",
    });
    mocks.functionExists.mockImplementation(
      async (_appPath: string, name: string) => name !== "gone",
    );
    mocks.deployAffected.mockResolvedValue([]);
    mocks.deployAll.mockResolvedValue([]);
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    activeRecordings.clear();
    resetDeferredSupabaseFunctionSyncForTests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("defers instead of queueing behind the recording, then reconciles after it ends", async () => {
    const endRecording = startRecording(5);
    const operation = vi.fn();

    const error = await withSupabaseFunctionDeployment(
      { appId: 5, supabaseProjectId: "project-id", sync },
      operation,
    ).catch((caught: unknown) => caught);

    expect(isSupabaseFunctionSyncDeferred(error)).toBe(true);
    expect(operation).not.toHaveBeenCalled();
    expect(appOperationCoordinator.isBusy(5, ["supabase-functions"])).toBe(
      false,
    );
    expect(mocks.deployAffected).not.toHaveBeenCalled();

    endRecording();

    await vi.waitFor(() =>
      expect(mocks.deployAffected).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 5,
          appPath: "/apps/demo",
          supabaseProjectId: "project-id",
          supabaseOrganizationSlug: null,
          sharedModulesChanged: true,
          changedSharedModulePaths: ["supabase/functions/_shared/cors.ts"],
          pendingFunctionDeploys: ["alpha"],
        }),
      ),
    );
    // The missing function is deleted remotely; the existing one is not.
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.supabase.com/v1/projects/project-id/functions/gone",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("redeploys every function when a whole-set deploy was deferred", async () => {
    const endRecording = startRecording(6);

    await expect(
      withSupabaseFunctionDeployment(
        {
          appId: 6,
          supabaseProjectId: "project-id",
          sync: { organizationSlug: null },
        },
        vi.fn(),
      ),
    ).rejects.toSatisfy(isSupabaseFunctionSyncDeferred);
    endRecording();

    await vi.waitFor(() =>
      expect(mocks.deployAll).toHaveBeenCalledWith(
        expect.objectContaining({ appId: 6, supabaseProjectId: "project-id" }),
      ),
    );
    expect(mocks.deployAffected).not.toHaveBeenCalled();
  });

  it("drops deferred work when the app's project changed during the recording", async () => {
    const endRecording = startRecording(7);
    mocks.findApp.mockResolvedValue({
      supabaseProjectId: "other-project",
      path: "/apps/demo",
    });

    await expect(
      withSupabaseFunctionDeployment(
        { appId: 7, supabaseProjectId: "project-id", sync },
        vi.fn(),
      ),
    ).rejects.toSatisfy(isSupabaseFunctionSyncDeferred);
    endRecording();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mocks.deployAffected).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("withSupabaseFunctionDeployment cancellation", () => {
  beforeEach(() => {
    mocks.findApp.mockResolvedValue({
      supabaseProjectId: "project-id",
      path: "/apps/demo",
    });
  });

  it("reports a cancelled deployment as a user cancellation", async () => {
    const abortController = new AbortController();

    const error = await withSupabaseFunctionDeployment(
      {
        appId: 8,
        supabaseProjectId: "project-id",
        signal: abortController.signal,
        sync: { organizationSlug: null, functionNames: ["alpha"] },
      },
      async () => {
        abortController.abort();
        abortController.signal.throwIfAborted();
      },
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: DyadErrorKind.UserCancelled });
  });
});
