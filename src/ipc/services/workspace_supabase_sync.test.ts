// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseFunctionSyncDeferredError } from "@/supabase_admin/supabase_recording_deferred_sync";

const mocks = vi.hoisted(() => ({
  findApp: vi.fn(),
  reconcile: vi.fn(),
  send: vi.fn(),
  skipPrune: false,
}));

vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: mocks.findApp } } },
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({ skipPruneEdgeFunctions: mocks.skipPrune }),
}));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: (value: string) => value }));
vi.mock("@/supabase_admin/supabase_function_reconcile", () => ({
  reconcileSupabaseFunctions: mocks.reconcile,
}));
vi.mock("@/window_infrastructure/main/window_registry", () => ({
  windowRegistry: {
    routePresentation: () => "window-1",
    endpointForSession: () => ({ send: mocks.send }),
  },
}));

import {
  findSupabaseFunctionChanges,
  resyncSupabaseFunctionsFromApp,
  waitForSupabaseFunctionResyncs,
} from "./workspace_supabase_sync";

describe("findSupabaseFunctionChanges", () => {
  it("finds the functions and shared modules among changed files", () => {
    expect(
      findSupabaseFunctionChanges([
        "src/App.tsx",
        "supabase/functions/hello/index.ts",
        "supabase/functions/hello/lib/util.ts",
        "supabase\\functions\\bye\\index.ts",
        "supabase/functions/_shared/cors.ts",
        "supabase/functions/_internal/x.ts",
        "supabase/config.toml",
      ]),
    ).toEqual({
      functionNames: ["bye", "hello"],
      sharedModulePaths: ["supabase/functions/_shared/cors.ts"],
    });
    expect(findSupabaseFunctionChanges(["src/App.tsx"])).toBeNull();
  });
});

describe("resyncSupabaseFunctionsFromApp", () => {
  const changes = {
    functionNames: ["hello"],
    sharedModulePaths: ["supabase/functions/_shared/cors.ts"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.skipPrune = false;
    mocks.findApp.mockResolvedValue({
      path: "/apps/demo",
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: "org",
    });
    mocks.reconcile.mockResolvedValue([]);
  });

  it("redeploys from the app's main folder without pruning other functions", async () => {
    mocks.skipPrune = true;
    resyncSupabaseFunctionsFromApp({ appId: 4, changes, reason: "merged" });
    await waitForSupabaseFunctionResyncs();

    expect(mocks.reconcile).toHaveBeenCalledWith({
      appId: 4,
      appPath: "/apps/demo",
      supabaseProjectId: "project-id",
      organizationSlug: "org",
      skipPruneEdgeFunctions: true,
      // Other chats' worktrees may have deployed functions the folder lacks.
      pruneDanglingFunctions: false,
      functionNames: ["hello"],
      sharedModulesChanged: true,
      sharedModulePaths: ["supabase/functions/_shared/cors.ts"],
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does nothing for an app without a Supabase project", async () => {
    mocks.findApp.mockResolvedValue({
      path: "/apps/demo",
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
    });
    resyncSupabaseFunctionsFromApp({ appId: 4, changes, reason: "merged" });
    await waitForSupabaseFunctionResyncs();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("tells the user when the redeploy fails", async () => {
    mocks.reconcile.mockResolvedValue(["hello: bundle failed"]);
    resyncSupabaseFunctionsFromApp({
      appId: 4,
      changes,
      reason: "worktree-deleted",
    });
    await waitForSupabaseFunctionResyncs();

    expect(mocks.send).toHaveBeenCalledWith("toast:error", {
      message: expect.stringMatching(
        /deleted worktree had changed.*hello: bundle failed.*Redeploy edge functions/,
      ),
      persist: true,
      toastId: "supabase-worktree-resync-4",
    });
  });

  it("stays quiet when a recording defers the redeploy", async () => {
    mocks.reconcile.mockRejectedValue(new SupabaseFunctionSyncDeferredError());
    resyncSupabaseFunctionsFromApp({ appId: 4, changes, reason: "merged" });
    await waitForSupabaseFunctionResyncs();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
