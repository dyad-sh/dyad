import log from "electron-log";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { apps } from "../../db/schema";
import {
  getSupabaseClientForOrganization,
  listSupabaseBranches,
  getSupabaseProjectLogs,
  getOrganizationDetails,
  getOrganizationMembers,
  classifyManagementApiError,
  type SupabaseProjectLog,
} from "../../supabase_admin/supabase_management_client";
import { extractFunctionName } from "../../supabase_admin/supabase_utils";
import { deployAllSupabaseFunctions } from "../../supabase_admin/supabase_utils";
import {
  detectLegacyAppKey,
  switchAppToPublishableKey,
} from "../../supabase_admin/supabase_app_key";
import { getDyadAppPath } from "../../paths/paths";
import { createTypedHandler } from "./base";
import { createAppOperationHandler } from "../utils/app_mutation_lock";
import {
  appOperationCoordinator,
  readAppResource,
} from "../services/app_operation_coordinator";
import { createTestOnlyLoggedHandler } from "./safe_handle";
import { readSettings, writeSettings } from "../../main/settings";
import { supabaseContracts } from "../types/supabase";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { assertNoNeonProject } from "../utils/neon_utils";
import { runOAuthReturnExchange } from "./connection_flow_handlers";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { safeSend } from "../utils/safe_sender";

const logger = log.scope("supabase_handlers");
const testOnlyHandle = createTestOnlyLoggedHandler(logger);

export function registerSupabaseHandlers() {
  // List all connected Supabase organizations with details
  createTypedHandler(supabaseContracts.listOrganizations, async () => {
    const settings = readSettings();
    const organizations = settings.supabase?.organizations ?? {};

    const results: Array<{
      organizationSlug: string;
      name?: string;
      ownerEmail?: string;
    }> = [];

    for (const organizationSlug of Object.keys(organizations)) {
      try {
        // Fetch organization details and members in parallel
        const [details, members] = await Promise.all([
          getOrganizationDetails(organizationSlug),
          getOrganizationMembers(organizationSlug),
        ]);

        // Find the owner from members
        const owner = members.find((m) => m.role === "Owner");

        results.push({
          organizationSlug,
          name: details.name,
          ownerEmail: owner?.email,
        });
      } catch (error) {
        // If we can't fetch details, still include the org with just the ID
        logger.error(
          `Failed to fetch details for organization ${organizationSlug}:`,
          error,
        );
        results.push({ organizationSlug });
      }
    }

    return results;
  });

  // Delete a Supabase organization connection
  createTypedHandler(
    supabaseContracts.deleteOrganization,
    async (_, params) => {
      const { organizationSlug } = params;
      const settings = readSettings();
      const organizations = { ...settings.supabase?.organizations };

      if (!organizations[organizationSlug]) {
        throw new DyadError(
          `Supabase organization ${organizationSlug} not found`,
          DyadErrorKind.NotFound,
        );
      }

      delete organizations[organizationSlug];

      writeSettings({
        supabase: {
          ...settings.supabase,
          organizations,
        },
      });

      logger.info(`Deleted Supabase organization ${organizationSlug}`);
    },
  );

  // List all projects from all connected organizations
  createTypedHandler(supabaseContracts.listAllProjects, async () => {
    const settings = readSettings();
    const organizations = settings.supabase?.organizations ?? {};
    if (IS_TEST_BUILD) {
      return Object.keys(organizations).map((organizationSlug) => ({
        id: "fake-project-id",
        name: "Fake Supabase Project",
        region: "us-east-1",
        organizationSlug,
      }));
    }

    const allProjects: Array<{
      id: string;
      name: string;
      region: string;
      organizationSlug: string;
    }> = [];

    for (const organizationSlug of Object.keys(organizations)) {
      try {
        const client = await getSupabaseClientForOrganization(organizationSlug);
        const projects = await client.getProjects();

        if (projects) {
          for (const project of projects) {
            allProjects.push({
              id: project.id,
              name: project.name,
              region: project.region,
              organizationSlug:
                // The supabase management API typedef is out of date and there's
                // actually an organization_slug field.
                // Just in case it's not there, we fallback to organization_id
                // which in practice is the same value as the slug.
                (project as any).organization_slug || project.organization_id,
            });
          }
        }
      } catch (error) {
        logger.error(
          `Failed to fetch projects for organization ${organizationSlug}:`,
          error,
        );
        // Continue with other organizations even if one fails
      }
    }

    return allProjects;
  });

  // List branches for a Supabase project (database branches)
  createTypedHandler(supabaseContracts.listBranches, async (_, params) => {
    const { projectId, organizationSlug } = params;
    const branches = await listSupabaseBranches({
      supabaseProjectId: projectId,
      organizationSlug: organizationSlug ?? null,
    });
    return branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      isDefault: branch.is_default,
      projectRef: branch.project_ref,
      parentProjectRef: branch.parent_project_ref,
    }));
  });

  // Get edge function logs for a Supabase project
  createTypedHandler(supabaseContracts.getEdgeLogs, async (_, params) => {
    const { projectId, timestampStart, appId, organizationSlug } = params;
    const response = await getSupabaseProjectLogs(
      projectId,
      timestampStart,
      organizationSlug ?? undefined,
    );

    if (response.error) {
      const errorMsg =
        typeof response.error === "string"
          ? response.error
          : JSON.stringify(response.error);
      throw new DyadError(
        `Failed to fetch logs: ${errorMsg}`,
        DyadErrorKind.External,
      );
    }

    const rawLogs = response.result || [];

    // Transform to ConsoleEntry format
    return rawLogs.map((logEntry: SupabaseProjectLog) => {
      const metadata = logEntry.metadata?.[0] || {};
      const level = metadata.level || "info";
      const eventMessage = logEntry.event_message || "";
      const functionName = extractFunctionName(eventMessage);

      return {
        level: (level === "error"
          ? "error"
          : level === "warn"
            ? "warn"
            : "info") as "info" | "warn" | "error",
        type: "edge-function" as const,
        message: eventMessage,
        timestamp: logEntry.timestamp / 1000, // Convert from microseconds to milliseconds
        sourceName: functionName,
        appId,
      };
    });
  });

  // Set app project - links a Dyad app to a Supabase project.
  // Provider ownership serializes this with the key switch, which reads this
  // association and writes the matching key into the app's source. Repointing
  // mid-switch would leave the client holding the previous project's key.
  createTypedHandler(
    supabaseContracts.setAppProject,
    createAppOperationHandler(
      "set-supabase-project",
      ["provider"],
      async (_, params) => {
        const { projectId, appId, parentProjectId, organizationSlug } = params;
        await assertNoNeonProject(appId);
        await db
          .update(apps)
          .set({
            supabaseProjectId: projectId,
            supabaseParentProjectId: parentProjectId,
            supabaseOrganizationSlug: organizationSlug,
          })
          .where(eq(apps.id, appId));

        logger.info(
          `Associated app ${appId} with Supabase project ${projectId} (organization: ${organizationSlug})${parentProjectId ? ` and parent project ${parentProjectId}` : ""}`,
        );
      },
      // A recording holds `provider` for its whole session, so this would sit
      // in Settings with a spinner and no explanation until the user ends the
      // recording or the 30-minute cap expires.
      "connect a Supabase project",
    ),
  );

  // Unset app project - removes the link between a Dyad app and a Supabase
  // project. This legacy contract spells the app id `app`, so it declares the
  // provider operation directly rather than using createAppOperationHandler.
  createTypedHandler(supabaseContracts.unsetAppProject, async (_, params) => {
    const { app } = params;
    await appOperationCoordinator.run(
      {
        appId: app,
        operation: "unset-supabase-project",
        resources: ["provider"],
        // Same reason as the connect above: a recording holds `provider` for
        // its whole session, so this would queue invisibly behind it.
        refuseWhenRecording: "disconnect this app's Supabase project",
      },
      async () => {
        await db
          .update(apps)
          .set({
            supabaseProjectId: null,
            supabaseParentProjectId: null,
            supabaseOrganizationSlug: null,
          })
          .where(eq(apps.id, app));

        logger.info(`Removed Supabase project association for app ${app}`);
      },
    );
  });

  // Does this app still authenticate with the project's legacy anon key?
  createTypedHandler(
    supabaseContracts.detectLegacyAppKey,
    async (_, { appId }) => {
      const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
      // An app with no Supabase project has nothing to check. Reporting
      // "no legacy key" beats throwing: the caller only wants to know whether
      // to offer the switch.
      if (!app?.supabaseProjectId) {
        return { hasLegacyKey: false };
      }
      const legacy = await detectLegacyAppKey({
        appPath: getDyadAppPath(app.path),
        projectId: app.supabaseProjectId,
        organizationSlug: app.supabaseOrganizationSlug,
      });
      return { hasLegacyKey: !!legacy };
    },
  );

  // Swap an app's generated client off the legacy anon key it was created with.
  // This is a read-modify-write of the app's source, so it owns both provider
  // state and the repository alongside a stable app-path read.
  createTypedHandler(
    supabaseContracts.switchAppToPublishableKey,
    createAppOperationHandler(
      "switch-supabase-publishable-key",
      [readAppResource("app-path"), "provider", "repository"],
      async (_, { appId }) => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });
        if (!app) {
          throw new DyadError(
            `App ${appId} not found.`,
            DyadErrorKind.NotFound,
          );
        }
        if (!app.supabaseProjectId) {
          throw new DyadError(
            `App ${appId} is not connected to a Supabase project.`,
            DyadErrorKind.Precondition,
          );
        }
        try {
          const outcome = await switchAppToPublishableKey({
            appPath: getDyadAppPath(app.path),
            projectId: app.supabaseProjectId,
            organizationSlug: app.supabaseOrganizationSlug,
          });
          return { outcome };
        } catch (error) {
          // The switch re-checks the key against the Management API, so a revoked
          // org token surfaces here. Classify it before it crosses IPC, or the
          // renderer sees an auth problem as an unclassified product exception.
          const classified = classifyManagementApiError(
            error,
            "update this app's API key",
          );
          if (isDyadError(classified)) {
            throw classified;
          }
          // Everything classifyManagementApiError doesn't recognise — a Supabase
          // 5xx, a `fetch failed` TypeError, an fs error the rewrite couldn't
          // classify — would otherwise reach the renderer as a bare Error with no
          // kind to branch on, and be reported as an unclassified product
          // exception (`rules/dyad-errors.md`).
          throw new DyadError(
            `Couldn't update this app's Supabase API key: ${classified instanceof Error ? classified.message : classified}`,
            DyadErrorKind.External,
          );
        }
      },
      // Both `provider` and `repository` are a recording's for its whole
      // session, so this would sit in Settings with a spinner and no
      // explanation until the session ends or the 30-minute cap expires.
      "switch this app's Supabase API key",
    ),
  );

  createTypedHandler(
    supabaseContracts.redeployAllFunctions,
    createAppOperationHandler(
      "redeploy-all-supabase-functions",
      [readAppResource("app-path"), "provider", readAppResource("repository")],
      async (event, { appId, operationId }) => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });
        if (!app) {
          throw new DyadError(
            `App ${appId} not found.`,
            DyadErrorKind.NotFound,
          );
        }
        if (!app.supabaseProjectId) {
          throw new DyadError(
            `App ${appId} is not connected to a Supabase project.`,
            DyadErrorKind.Precondition,
          );
        }

        let functionCount = 0;
        const settings = readSettings();
        const errors = await deployAllSupabaseFunctions({
          appPath: getDyadAppPath(app.path),
          supabaseProjectId: app.supabaseProjectId,
          supabaseOrganizationSlug: app.supabaseOrganizationSlug ?? null,
          skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? false,
          pruneWhenNoLocalFunctions: true,
          onProgress: (progress) => {
            functionCount = progress.total;
            safeSend(event.sender, "supabase:redeploy-progress", {
              ...progress,
              appId,
              operationId,
            });
          },
        });

        return { functionCount, errors };
      },
    ),
  );

  testOnlyHandle(
    "supabase:fake-connect-and-set-project",
    async (
      event,
      { appId, fakeProjectId }: { appId: number; fakeProjectId: string },
    ) => {
      const fakeOrgId = "fake-org-id";

      // Directly store fake credentials in the organizations map
      // We don't call handleSupabaseOAuthReturn because it attempts a real API call
      // which fails with fake tokens, causing credentials to be stored in legacy format
      // Run the write through the connection flow machine so an active flow
      // (started by the connector's Connect click) advances just like a real
      // dyad://supabase-oauth-return deep link would.
      const outcome = await runOAuthReturnExchange("supabase", () => {
        const settings = readSettings();
        const existingOrgs = settings.supabase?.organizations ?? {};
        writeSettings({
          supabase: {
            ...settings.supabase,
            organizations: {
              ...existingOrgs,
              [fakeOrgId]: {
                accessToken: {
                  value: "fake-access-token",
                },
                refreshToken: {
                  value: "fake-refresh-token",
                },
                expiresIn: 3600,
                tokenTimestamp: Math.floor(Date.now() / 1000),
              },
            },
          },
        });
      });
      if (!outcome.ok && !outcome.claimed) {
        throw outcome.error;
      }
      logger.info(
        `Stored fake Supabase credentials for organization ${fakeOrgId} for app ${appId} during testing.`,
      );

      // Set the supabase project for the currently selected app
      await db
        .update(apps)
        .set({
          supabaseProjectId: fakeProjectId,
          supabaseOrganizationSlug: fakeOrgId,
        })
        .where(eq(apps.id, appId));
      logger.info(
        `Set fake Supabase project ${fakeProjectId} for app ${appId} during testing.`,
      );
    },
  );
}
