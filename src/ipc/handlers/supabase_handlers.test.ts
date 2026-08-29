import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { SUPABASE_PROJECT_CREATED_BUT_UNLINKED } from "@/ipc/types";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
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
  }),
);

const { registerSupabaseHandlers, unlinkedProjectsByApp } =
  await import("./supabase_handlers");

describe("Supabase handlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    activeRecordings.clear();
    // Process-lifetime state, so without this a stranded project recorded by
    // one test refuses the next test's create.
    unlinkedProjectsByApp.clear();
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
    // The project exists by now, and the renderer tells the user so. It matches
    // on this code rather than the kind, which is the catch-all every other
    // unclassified failure also carries.
    it("marks a create that could not be linked with a stable code", async () => {
      insertApp();
      vi.spyOn(harness.db, "update").mockImplementationOnce(() => {
        throw new Error("database is locked");
      });

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.Internal,
        code: SUPABASE_PROJECT_CREATED_BUT_UNLINKED,
        message: expect.stringContaining("proj-new"),
      });
      expect(readApp()).toMatchObject({ supabaseProjectId: null });
    });

    // The contract's invalidations are published only after a handler resolves,
    // and this path throws. Without an explicit publish, a peer window's
    // selector never lists the project the error tells the user to pick.
    it("tells other windows about the project it could not link", async () => {
      insertApp();
      const publish = vi.spyOn(queryInvalidationBus, "publish");
      vi.spyOn(harness.db, "update").mockImplementationOnce(() => {
        throw new Error("database is locked");
      });

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toThrow();

      expect(publish).toHaveBeenCalledWith(
        [{ family: "provider-status", provider: "supabase" }],
        expect.objectContaining({
          originHandledScopes: [
            { family: "provider-status", provider: "supabase" },
          ],
        }),
      );
    });

    // The "already connected" guard reads the app row, and on this path the
    // write to that row is exactly what failed. Without a separate record every
    // retry mints another project the user pays for and has no pointer to.
    it("refuses another create once one was left unlinked", async () => {
      insertApp();
      vi.spyOn(harness.db, "update").mockImplementationOnce(() => {
        throw new Error("database is locked");
      });
      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toThrow();
      expect(mocks.createSupabaseProject).toHaveBeenCalledTimes(1);

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.Precondition,
        message: expect.stringContaining("proj-new"),
      });
      // Refused before reaching Supabase, which is the whole point.
      expect(mocks.createSupabaseProject).toHaveBeenCalledTimes(1);
    });

    // Refusing for the life of the process would strand the app: a user who
    // reads the message and deletes that project in the dashboard would have
    // nothing left that clears it. The refusal consumes the record instead, so
    // it interrupts the reflexive retry once and then gets out of the way.
    it("stops refusing after it has said so once", async () => {
      insertApp();
      vi.spyOn(harness.db, "update").mockImplementationOnce(() => {
        throw new Error("database is locked");
      });
      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toThrow();

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).resolves.toMatchObject({ id: "proj-new" });
    });

    // Linking the app also releases it, whichever project the user picked.
    // `projectId` is nullable on that contract, so a call that leaves the app
    // unlinked must not count as having resolved the stranded project.
    it("keeps refusing when set-app-project wrote no project", async () => {
      insertApp();
      vi.spyOn(harness.db, "update").mockImplementationOnce(() => {
        throw new Error("database is locked");
      });
      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toThrow();

      await harness.invokeHandler("supabase:set-app-project", {
        appId: 7,
        projectId: null,
        organizationSlug: null,
      });

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(mocks.createSupabaseProject).toHaveBeenCalledTimes(1);
    });

    it("stops refusing once the app has been linked", async () => {
      insertApp();
      vi.spyOn(harness.db, "update").mockImplementationOnce(() => {
        throw new Error("database is locked");
      });
      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toThrow();

      await harness.invokeHandler("supabase:set-app-project", {
        appId: 7,
        projectId: "proj-new",
        organizationSlug: "org-1",
      });
      await harness.invokeHandler("supabase:unset-app-project", { app: 7 });

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).resolves.toMatchObject({ id: "proj-new" });
      expect(mocks.createSupabaseProject).toHaveBeenCalledTimes(2);
    });

    // A 2xx with no ref means Supabase probably made a project we cannot name.
    // Treating it as an ordinary failure would leave the form inviting a retry.
    it("treats a created project with no ref as unlinked too", async () => {
      insertApp();
      const noRef = new DyadError(
        "Supabase created a project but returned no project ref: {}",
        DyadErrorKind.External,
      ) as DyadError & { code: string };
      noRef.code = SUPABASE_PROJECT_CREATED_BUT_UNLINKED;
      mocks.createSupabaseProject.mockRejectedValueOnce(noRef);
      const publish = vi.spyOn(queryInvalidationBus, "publish");

      // The code is what closes the form in the renderer, and the raw body the
      // client reported is developer-facing, so it is logged and replaced.
      const thrown = await harness
        .invokeHandler("supabase:create-project", INPUT)
        .catch((error: unknown) => error);
      expect(thrown).toMatchObject({
        code: SUPABASE_PROJECT_CREATED_BUT_UNLINKED,
        message: expect.stringContaining("Check your Supabase dashboard"),
      });
      expect((thrown as Error).message).not.toContain("no project ref");
      expect(publish).toHaveBeenCalled();

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      expect(mocks.createSupabaseProject).toHaveBeenCalledTimes(1);
    });

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

    // The telemetry filter recognises a dropped connection by name and message
    // (`isGenericFetchFailedError`), so wrapping it would rename it and make
    // every create attempted offline a reported exception.
    it("leaves a dropped connection as it came, for the telemetry filter", async () => {
      insertApp();
      const offline = new TypeError("fetch failed");
      mocks.createSupabaseProject.mockRejectedValue(offline);

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({
        name: "TypeError",
        message: "fetch failed",
      });
    });

    // Everything else still gets the context the passthrough above cannot
    // carry, so an ordinary failure does not reach the user as a bare string.
    it("explains a failure the filter does not recognise", async () => {
      insertApp();
      mocks.createSupabaseProject.mockRejectedValue(
        new Error("socket hang up"),
      );

      await expect(
        harness.invokeHandler("supabase:create-project", INPUT),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.External,
        message: expect.stringContaining("Couldn't create the Supabase"),
      });
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
});
