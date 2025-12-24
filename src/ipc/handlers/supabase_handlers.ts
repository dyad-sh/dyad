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
  type SupabaseProjectLog,
} from "../../supabase_admin/supabase_management_client";
import { extractFunctionName } from "../../supabase_admin/supabase_utils";
import {
  createLoggedHandler,
  createTestOnlyLoggedHandler,
} from "./safe_handle";
import { safeSend } from "../utils/safe_sender";
import { readSettings, writeSettings } from "../../main/settings";

import {
  SetSupabaseAppProjectParams,
  SupabaseBranch,
  SupabaseOrganizationInfo,
  SupabaseProject,
  DeleteSupabaseOrganizationParams,
} from "../ipc_types";
import type { ConsoleEntry } from "../../atoms/appAtoms";

const logger = log.scope("supabase_handlers");
const handle = createLoggedHandler(logger);
const testOnlyHandle = createTestOnlyLoggedHandler(logger);

export function registerSupabaseHandlers() {
  // List all connected Supabase organizations with details
  handle(
    "supabase:list-organizations",
    async (): Promise<SupabaseOrganizationInfo[]> => {
      const settings = readSettings();
      const organizations = settings.supabase?.organizations ?? {};

      const results: SupabaseOrganizationInfo[] = [];

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
    },
  );

  // Delete a Supabase organization connection
  handle(
    "supabase:delete-organization",
    async (_, { organizationSlug }: DeleteSupabaseOrganizationParams) => {
      const settings = readSettings();
      const organizations = { ...settings.supabase?.organizations };

      if (!organizations[organizationSlug]) {
        throw new Error(`Supabase organization ${organizationSlug} not found`);
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
  handle("supabase:list-all-projects", async (): Promise<SupabaseProject[]> => {
    const settings = readSettings();
    const organizations = settings.supabase?.organizations ?? {};
    const allProjects: SupabaseProject[] = [];

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
  handle(
    "supabase:list-branches",
    async (
      _,
      {
        projectId,
        organizationSlug,
      }: { projectId: string; organizationSlug?: string },
    ): Promise<Array<SupabaseBranch>> => {
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
    },
  );

  // Get edge function logs for a Supabase project
  handle(
    "supabase:get-edge-logs",
    async (
      _,
      {
        projectId,
        timestampStart,
        appId,
        organizationSlug,
      }: {
        projectId: string;
        timestampStart?: number;
        appId: number;
        organizationSlug: string | null;
      },
    ): Promise<Array<ConsoleEntry>> => {
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
        throw new Error(`Failed to fetch logs: ${errorMsg}`);
      }

      const rawLogs = response.result || [];

      // Transform to ConsoleEntry format
      return rawLogs.map((log: SupabaseProjectLog) => {
        const metadata = log.metadata?.[0] || {};
        const level = metadata.level || "info";
        const eventMessage = log.event_message || "";
        const functionName = extractFunctionName(eventMessage);

        return {
          level:
            level === "error" ? "error" : level === "warn" ? "warn" : "info",
          type: "edge-function" as const,
          message: eventMessage,
          timestamp: log.timestamp / 1000, // Convert from microseconds to milliseconds
          sourceName: functionName,
          appId,
        };
      });
    },
  );

  // Set app project - links a Dyad app to a Supabase project
  handle(
    "supabase:set-app-project",
    async (
      _,
      {
        projectId,
        appId,
        parentProjectId,
        organizationSlug,
      }: SetSupabaseAppProjectParams,
    ) => {
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
  );

  // Unset app project - removes the link between a Dyad app and a Supabase project
  handle("supabase:unset-app-project", async (_, { app }: { app: number }) => {
    await db
      .update(apps)
      .set({
        supabaseProjectId: null,
        supabaseParentProjectId: null,
        supabaseOrganizationSlug: null,
      })
      .where(eq(apps.id, app));

    logger.info(`Removed Supabase project association for app ${app}`);
  });

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

      // Simulate the deep link event
      safeSend(event.sender, "deep-link-received", {
        type: "supabase-oauth-return",
        url: "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
      });
      logger.info(
        `Sent fake deep-link-received event for app ${appId} during testing.`,
      );
    },
  );
}
