import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apps } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { activeRecordings } from "@/ipc/services/recording_registry";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

const mocks = vi.hoisted(() => ({
  deployAllSupabaseFunctions: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn(() =>
      path.join(os.tmpdir(), "dyad-supabase-handler-user-data"),
    ),
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

vi.mock("@/paths/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/paths/paths")>()),
  getDyadAppPath: (appPath: string) => `/apps/${appPath}`,
}));

vi.mock("@/main/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/settings")>()),
  readSettings: mocks.readSettings,
  writeSettings: vi.fn(),
}));

vi.mock("@/supabase_admin/supabase_utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/supabase_admin/supabase_utils")>()),
  deployAllSupabaseFunctions: mocks.deployAllSupabaseFunctions,
}));

const { registerSupabaseHandlers } = await import("./supabase_handlers");

describe("Supabase handlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    activeRecordings.clear();
    harness = setupHandlerTestHarness();
    registerSupabaseHandlers();
  });

  afterEach(() => {
    activeRecordings.clear();
    harness?.dispose();
  });

  describe("app recording admission", () => {
    beforeEach(() => {
      activeRecordings.set(7, {
        appId: 7,
        stop: () => {},
        done: Promise.resolve({ envRestored: true }),
      });
    });

    it.each([
      [
        "associating a project",
        "supabase:set-app-project",
        { appId: 7, projectId: "project", organizationSlug: "org" },
      ],
      ["removing a project", "supabase:unset-app-project", { app: 7 }],
      [
        "switching to a publishable key",
        "supabase:switch-app-to-publishable-key",
        { appId: 7 },
      ],
    ])("refuses %s while recording", async (_label, channel, input) => {
      await expect(harness.invokeHandler(channel, input)).rejects.toMatchObject(
        {
          kind: DyadErrorKind.Precondition,
        },
      );
    });
  });

  describe("supabase:redeploy-all-functions", () => {
    beforeEach(() => {
      harness.db
        .insert(apps)
        .values({
          id: 7,
          name: "My App",
          path: "my-app",
          supabaseProjectId: "project-1",
          supabaseOrganizationSlug: "org-1",
        })
        .run();
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
      const event = {
        sender: {
          send: vi.fn(),
          isDestroyed: () => false,
          isCrashed: () => false,
        },
      };

      await expect(
        harness.invokeHandler(
          "supabase:redeploy-all-functions",
          { appId: 7, operationId: "redeploy-1" },
          event,
        ),
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
      harness.db
        .update(apps)
        .set({ supabaseProjectId: null })
        .where(eq(apps.id, 7))
        .run();

      await expect(
        harness.invokeHandler(
          "supabase:redeploy-all-functions",
          { appId: 7, operationId: "redeploy-2" },
          {
            sender: {
              send: vi.fn(),
              isDestroyed: () => false,
              isCrashed: () => false,
            },
          },
        ),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(mocks.deployAllSupabaseFunctions).not.toHaveBeenCalled();
    });
  });
});
