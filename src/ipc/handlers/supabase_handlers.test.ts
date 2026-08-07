import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deployAllSupabaseFunctions: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("electron", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ipcMain: undefined,
}));

vi.mock("@/db", () => ({
  db: {
    query: { apps: { findFirst: mocks.findFirst } },
  },
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: (appPath: string) => `/apps/${appPath}`,
}));

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
  writeSettings: vi.fn(),
}));

vi.mock("@/supabase_admin/supabase_utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/supabase_admin/supabase_utils")>()),
  deployAllSupabaseFunctions: mocks.deployAllSupabaseFunctions,
}));

import { getRegisteredHandlerForTesting } from "./base";
import { registerSupabaseHandlers } from "./supabase_handlers";

registerSupabaseHandlers();

const redeployAllFunctions = getRegisteredHandlerForTesting(
  "supabase:redeploy-all-functions",
);

function createEvent() {
  return {
    sender: {
      send: vi.fn(),
      isDestroyed: () => false,
      isCrashed: () => false,
    },
  };
}

describe("supabase:redeploy-all-functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      id: 7,
      path: "my-app",
      supabaseProjectId: "project-1",
      supabaseOrganizationSlug: "org-1",
    });
    mocks.readSettings.mockReturnValue({ skipPruneEdgeFunctions: true });
    mocks.deployAllSupabaseFunctions.mockImplementation(
      async ({ onProgress, onSummary }) => {
        onProgress({
          phase: "deploying",
          total: 2,
          active: 1,
          queued: 0,
          completed: 1,
          succeeded: 1,
          failed: 0,
          functionName: "send-email",
        });
        onSummary({
          functionCount: 2,
          prunedFunctionNames: ["old-webhook"],
        });
        return ["Failed to bundle webhook"];
      },
    );
  });

  it("honors pruning settings and correlates progress to the invoking window", async () => {
    const event = createEvent();

    await expect(
      redeployAllFunctions(event as never, {
        appId: 7,
        operationId: "redeploy-1",
      }),
    ).resolves.toEqual({
      functionCount: 2,
      prunedFunctionNames: ["old-webhook"],
      errors: ["Failed to bundle webhook"],
    });

    expect(mocks.deployAllSupabaseFunctions).toHaveBeenCalledWith(
      expect.objectContaining({
        appPath: "/apps/my-app",
        supabaseProjectId: "project-1",
        supabaseOrganizationSlug: "org-1",
        skipPruneEdgeFunctions: true,
        pruneWhenNoLocalFunctions: true,
      }),
    );
    expect(event.sender.send).toHaveBeenCalledWith(
      "supabase:redeploy-progress",
      expect.objectContaining({
        appId: 7,
        operationId: "redeploy-1",
        completed: 1,
        total: 2,
      }),
    );
  });

  it("rejects an app without a connected Supabase project", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 7,
      path: "my-app",
      supabaseProjectId: null,
    });

    await expect(
      redeployAllFunctions(createEvent() as never, {
        appId: 7,
        operationId: "redeploy-2",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    expect(mocks.deployAllSupabaseFunctions).not.toHaveBeenCalled();
  });
});
