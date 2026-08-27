import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apps } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { activeRecordings } from "@/ipc/services/recording_registry";
import { SupabaseManagementAPIError } from "@dyad-sh/supabase-management-js";
import { RateLimitError } from "@/ipc/utils/retryWithRateLimit";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

const mocks = vi.hoisted(() => ({
  deployAllSupabaseFunctions: vi.fn(),
  readSettings: vi.fn(),
  createSupabaseProject: vi.fn(),
  getSupabaseProjectStatus: vi.fn(),
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

vi.mock(
  "@/supabase_admin/supabase_management_client",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/supabase_admin/supabase_management_client")
    >()),
    createSupabaseProject: mocks.createSupabaseProject,
    getSupabaseProjectStatus: mocks.getSupabaseProjectStatus,
  }),
);

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

  describe("supabase:create-project", () => {
    const CREATED = {
      id: "proj-new",
      name: "My App",
      region: "us-east-1",
      organizationSlug: "org-1",
      status: "COMING_UP",
    };
    const INPUT = {
      appId: 7,
      name: "My App",
      organizationSlug: "org-1",
      region: "us-east-1",
    };

    const insertApp = (values: Record<string, unknown> = {}) => {
      harness.db
        .insert(apps)
        .values({ id: 7, name: "My App", path: "my-app", ...values })
        .run();
    };

    const readApp = () =>
      harness.db.select().from(apps).where(eq(apps.id, 7)).get();

    beforeEach(() => {
      mocks.createSupabaseProject.mockResolvedValue(CREATED);
    });

    it("creates the project and links the app to it in one call", async () => {
      insertApp();

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).resolves.toMatchObject({ id: "proj-new" });

      expect(mocks.createSupabaseProject).toHaveBeenCalledWith({
        name: "My App",
        organizationSlug: "org-1",
        region: "us-east-1",
      });
      expect(readApp()).toMatchObject({
        supabaseProjectId: "proj-new",
        supabaseOrganizationSlug: "org-1",
        supabaseParentProjectId: null,
      });
    });

    // The renderer's disabled-button guard reads a React Query pending flag
    // that lags a render, so a fast double-click really can reach the handler
    // twice. It costs nothing extra to stop it: `provider` makes the second
    // wait, and by the time it runs the app already carries a project.
    it("makes a double-submit refuse rather than create a second project", async () => {
      insertApp();
      let release: (value: typeof CREATED) => void = () => {};
      mocks.createSupabaseProject.mockReturnValue(
        new Promise<typeof CREATED>((resolve) => {
          release = resolve;
        }),
      );

      const first = harness.invokeHandler("supabase:create-project", INPUT);
      const second = harness.invokeHandler("supabase:create-project", INPUT);
      release(CREATED);

      await expect(first).resolves.toMatchObject({ id: "proj-new" });
      await expect(second).rejects.toMatchObject({
        kind: DyadErrorKind.Precondition,
      });
      // The point of the test: exactly one project reached Supabase, so there
      // is no orphan for the user to clean up.
      expect(mocks.createSupabaseProject).toHaveBeenCalledTimes(1);
      expect(readApp()).toMatchObject({ supabaseProjectId: "proj-new" });
    });

    it("refuses when the app already has a Supabase project", async () => {
      insertApp({
        supabaseProjectId: "proj-existing",
        supabaseOrganizationSlug: "org-1",
      });

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(mocks.createSupabaseProject).not.toHaveBeenCalled();
      expect(readApp()).toMatchObject({ supabaseProjectId: "proj-existing" });
    });

    it("refuses when the app is on Neon, before creating anything", async () => {
      insertApp({ neonProjectId: "neon-1" });

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(mocks.createSupabaseProject).not.toHaveBeenCalled();
    });

    it("refuses while the app is recording", async () => {
      insertApp();
      activeRecordings.set(7, {
        appId: 7,
        stop: () => {},
        done: Promise.resolve({ envRestored: true }),
      });

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(mocks.createSupabaseProject).not.toHaveBeenCalled();
    });

    // An exhausted project quota is the likeliest failure here. It is the
    // user's to fix, so it must not be reported as an upstream exception, and
    // Supabase's own explanation has to survive to the message.
    it("classifies a rejected create as user-fixable and keeps Supabase's reason", async () => {
      insertApp();
      mocks.createSupabaseProject.mockRejectedValue(
        new SupabaseManagementAPIError(
          "Failed to create project: Forbidden (403): free tier project limit reached",
          { status: 403 } as Response,
        ),
      );

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.Precondition,
        message: expect.stringContaining("free tier project limit reached"),
      });
      expect(readApp()).toMatchObject({ supabaseProjectId: null });
    });

    it("reports a Supabase outage as an upstream failure", async () => {
      insertApp();
      mocks.createSupabaseProject.mockRejectedValue(
        new SupabaseManagementAPIError("Failed to create project: 503", {
          status: 503,
        } as Response),
      );

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({ kind: DyadErrorKind.External });
    });

    // A 429 is exhausted by fetchWithRetry and rethrown as a RateLimitError,
    // not a SupabaseManagementAPIError, so classifying on the latter's status
    // alone would never see it and would report a quota failure to PostHog.
    it("classifies an exhausted rate limit as rate limited, not upstream", async () => {
      insertApp();
      mocks.createSupabaseProject.mockRejectedValue(
        new RateLimitError("Rate limited (429): Too Many Requests", {
          status: 429,
        } as Response),
      );

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({ kind: DyadErrorKind.RateLimited });
    });
  });

  describe("supabase:get-project-status", () => {
    const STATUS_INPUT = { projectId: "proj-1", organizationSlug: "org-1" };

    // This runs on a poll for every Supabase-connected app, so an unclassified
    // failure is not a one-off: a project deleted from the Supabase dashboard
    // would report a product exception on every mount and every tick.
    it.each([
      ["a deleted project", 404, DyadErrorKind.NotFound],
      ["an org the token cannot see", 403, DyadErrorKind.Auth],
      ["a revoked token", 401, DyadErrorKind.Auth],
    ])(
      "classifies %s rather than reporting it",
      async (_label, status, kind) => {
        mocks.getSupabaseProjectStatus.mockRejectedValue(
          new SupabaseManagementAPIError(`Failed to get project: ${status}`, {
            status,
          } as Response),
        );

        await expect(
          harness.invokeHandler("supabase:get-project-status", STATUS_INPUT),
        ).rejects.toMatchObject({ kind });
      },
    );
  });
});
