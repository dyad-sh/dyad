import log from "electron-log";

import { createTestOnlyLoggedHandler } from "./safe_handle";
import { createTypedHandler } from "./base";
import { handleNeonOAuthReturn } from "../../neon_admin/neon_return_handler";
import {
  getNeonClient,
  getNeonErrorMessage,
  getNeonOrganizationId,
} from "../../neon_admin/neon_management_client";
import {
  executeNeonSql,
  getNeonTableSchema,
  getBranchRoleName,
  getConnectionUri,
} from "../../neon_admin/neon_context";
import { neonContracts, type NeonBranch } from "../types/neon";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import {
  EndpointType,
  NeonAuthSupportedAuthProvider,
} from "@neondatabase/api-client";
import { retryOnLocked } from "../utils/retryOnLocked";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  updateNeonEnvVars,
  removeNeonEnvVars,
} from "../utils/app_env_var_utils";

export const logger = log.scope("neon_handlers");

const testOnlyHandle = createTestOnlyLoggedHandler(logger);

type AppRow = typeof apps.$inferSelect;

/**
 * Fetches an app record and resolves the active Neon branch ID.
 * Throws if the app is not found, has no Neon project, or has no branch.
 */
export async function getAppWithNeonBranch(appId: number): Promise<{
  appData: AppRow;
  branchId: string;
}> {
  const app = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);

  if (app.length === 0) {
    throw new DyadError(
      `App with ID ${appId} not found`,
      DyadErrorKind.NotFound,
    );
  }

  const appData = app[0];
  if (!appData.neonProjectId) {
    throw new DyadError(
      `No Neon project found for app ${appId}`,
      DyadErrorKind.Precondition,
    );
  }

  const branchId =
    appData.neonActiveBranchId ?? appData.neonDevelopmentBranchId;
  if (!branchId) {
    throw new DyadError(
      `No active Neon branch found for app ${appId}`,
      DyadErrorKind.Precondition,
    );
  }

  return { appData, branchId };
}

/**
 * Checks if Neon Auth is enabled on the given branch, and enables it if not.
 * Returns the auth base URL from the API. Throws on failure.
 */
async function ensureNeonAuth({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}): Promise<string | undefined> {
  const neonClient = await getNeonClient();

  // Check if Neon Auth is already enabled on this branch
  try {
    const response = await neonClient.getNeonAuth(projectId, branchId);
    return response.data.base_url;
  } catch (error: any) {
    // 404 means auth not enabled — proceed to create
    if (error.response?.status !== 404) throw error;
  }

  // Enable Neon Auth on this branch
  try {
    const createResponse = await neonClient.createNeonAuth(
      projectId,
      branchId,
      {
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
      },
    );
    return createResponse.data.base_url;
  } catch (createError: any) {
    // 409 means the neon_auth schema already exists (inherited from parent branch).
    // Try fetching the auth config again since it may now be available.
    if (createError.response?.status === 409) {
      try {
        const retryResponse = await neonClient.getNeonAuth(projectId, branchId);
        return retryResponse.data.base_url;
      } catch (retryError: any) {
        // Auth schema exists but isn't formally enabled — log warning and return undefined
        const message =
          retryError instanceof Error ? retryError.message : String(retryError);
        logger.warn(
          `Neon Auth schema conflict (409) on branch ${branchId}, and retry fetch also failed: ${message}`,
        );
        return undefined;
      }
    }
    throw createError;
  }
}

/**
 * Auto-injects Neon environment variables into the app's .env.local.
 * Always writes DATABASE_URL/POSTGRES_URL. Returns a warning message
 * if Neon Auth activation fails.
 */
async function autoInjectNeonEnvVars({
  appId,
  projectId,
  branchId,
}: {
  appId: number;
  projectId: string;
  branchId: string;
}): Promise<string | undefined> {
  const appRecord = await db
    .select()
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);
  if (appRecord.length === 0) return;

  const connectionUri = await getConnectionUri({ projectId, branchId });
  // Attempt to ensure Neon Auth is active; capture any error as a warning
  let neonAuthBaseUrl: string | undefined;
  let warning: string | undefined;
  try {
    neonAuthBaseUrl = await ensureNeonAuth({ projectId, branchId });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    warning = `Failed to activate Neon Auth: ${message}`;
  }

  // Always write env vars (DATABASE_URL, POSTGRES_URL, and auth URL if available)
  await updateNeonEnvVars({
    appPath: appRecord[0].path,
    connectionUri,
    neonAuthBaseUrl,
  });

  return warning;
}

export function registerNeonHandlers() {
  // Do not use log handler because there's sensitive data in the response
  createTypedHandler(neonContracts.createProject, async (_, params) => {
    const { name, appId } = params;
    const neonClient = await getNeonClient();

    logger.info(`Creating Neon project: ${name} for app ${appId}`);

    // Guard: prevent connecting both Supabase and Neon on the same app
    const existingApp = await db
      .select({ supabaseProjectId: apps.supabaseProjectId })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);
    if (existingApp[0]?.supabaseProjectId) {
      throw new DyadError(
        "Cannot connect Neon: this app already has a Supabase project. Disconnect Supabase first.",
        DyadErrorKind.Precondition,
      );
    }

    try {
      // Get the organization ID
      const orgId = await getNeonOrganizationId();

      // Create project with retry on locked errors
      const response = await retryOnLocked(
        () =>
          neonClient.createProject({
            project: {
              name: name,
              org_id: orgId,
            },
          }),
        `Create project ${name} for app ${appId}`,
      );

      if (!response.data.project) {
        throw new DyadError(
          "Failed to create project: No project data returned.",
          DyadErrorKind.External,
        );
      }

      const project = response.data.project;
      const mainBranch = response.data.branch;

      // Enable Neon Auth on the main branch
      await ensureNeonAuth({
        projectId: project.id,
        branchId: mainBranch.id,
      });

      // Create development branch as a child of main (production)
      const developmentBranchResponse = await retryOnLocked(
        () =>
          neonClient.createProjectBranch(project.id, {
            endpoints: [{ type: EndpointType.ReadWrite }],
            branch: {
              name: "development",
              parent_id: mainBranch.id,
            },
          }),
        `Create development branch for project ${project.id}`,
      );

      if (
        !developmentBranchResponse.data.branch ||
        !developmentBranchResponse.data.connection_uris ||
        developmentBranchResponse.data.connection_uris.length === 0
      ) {
        throw new DyadError(
          "Failed to create development branch: No branch data returned.",
          DyadErrorKind.External,
        );
      }

      const developmentBranch = developmentBranchResponse.data.branch;

      // Enable Neon Auth on the development branch
      await ensureNeonAuth({
        projectId: project.id,
        branchId: developmentBranch.id,
      });

      // Create preview branch as a child of development
      const previewBranchResponse = await retryOnLocked(
        () =>
          neonClient.createProjectBranch(project.id, {
            endpoints: [{ type: EndpointType.ReadOnly }],
            branch: {
              name: "preview",
              parent_id: developmentBranch.id,
            },
          }),
        `Create preview branch for project ${project.id}`,
      );

      if (
        !previewBranchResponse.data.branch ||
        !previewBranchResponse.data.connection_uris ||
        previewBranchResponse.data.connection_uris.length === 0
      ) {
        throw new DyadError(
          "Failed to create preview branch: No branch data returned.",
          DyadErrorKind.External,
        );
      }

      const previewBranch = previewBranchResponse.data.branch;

      // Enable Neon Auth on the preview branch
      await ensureNeonAuth({
        projectId: project.id,
        branchId: previewBranch.id,
      });

      // Store project and branch info in the app's DB row
      await db
        .update(apps)
        .set({
          neonProjectId: project.id,
          neonDevelopmentBranchId: developmentBranch.id,
          neonPreviewBranchId: previewBranch.id,
          neonActiveBranchId: developmentBranch.id,
        })
        .where(eq(apps.id, appId));

      const connectionUri =
        developmentBranchResponse.data.connection_uris[0].connection_uri;

      // Auto-inject env vars into the app's .env.local
      const warning = await autoInjectNeonEnvVars({
        appId,
        projectId: project.id,
        branchId: developmentBranch.id,
      });

      logger.info(
        `Successfully created Neon project: ${project.id} with main branch: ${mainBranch.id} and development branch: ${developmentBranch.id} for app ${appId}`,
      );
      return {
        id: project.id,
        name: project.name,
        connectionString: connectionUri,
        branchId: developmentBranch.id,
        warning,
      };
    } catch (error: any) {
      const errorMessage = getNeonErrorMessage(error);
      const message = `Failed to create Neon project for app ${appId}: ${errorMessage}`;
      logger.error(message);
      throw new Error(message);
    }
  });

  createTypedHandler(neonContracts.getProject, async (_, params) => {
    const { appId } = params;
    logger.info(`Getting Neon project info for app ${appId}`);

    try {
      // Get the app from the database to find the neonProjectId and neonBranchId
      const app = await db
        .select()
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);

      if (app.length === 0) {
        throw new DyadError(
          `App with ID ${appId} not found`,
          DyadErrorKind.NotFound,
        );
      }

      const appData = app[0];
      if (!appData.neonProjectId) {
        throw new DyadError(
          `No Neon project found for app ${appId}`,
          DyadErrorKind.External,
        );
      }

      const neonClient = await getNeonClient();
      console.log("PROJECT ID", appData.neonProjectId);

      // Get project info
      const projectResponse = await neonClient.getProject(
        appData.neonProjectId,
      );

      if (!projectResponse.data.project) {
        throw new DyadError(
          "Failed to get project: No project data returned.",
          DyadErrorKind.External,
        );
      }

      const project = projectResponse.data.project;

      // Get list of branches
      const branchesResponse = await neonClient.listProjectBranches({
        projectId: appData.neonProjectId,
      });

      if (!branchesResponse.data.branches) {
        throw new DyadError(
          "Failed to get branches: No branch data returned.",
          DyadErrorKind.External,
        );
      }

      // Map branches to our format
      const branches: NeonBranch[] = branchesResponse.data.branches.map(
        (branch) => {
          let type: "production" | "development" | "snapshot" | "preview";

          if (branch.id === appData.neonDevelopmentBranchId) {
            type = "development";
          } else if (branch.id === appData.neonPreviewBranchId) {
            type = "preview";
          } else if (branch.default) {
            type = "production";
          } else {
            type = "snapshot";
          }

          // Find parent branch name if parent_id exists
          let parentBranchName: string | undefined;
          if (branch.parent_id) {
            const parentBranch = branchesResponse.data.branches?.find(
              (b) => b.id === branch.parent_id,
            );
            parentBranchName = parentBranch?.name;
          }

          return {
            type,
            branchId: branch.id,
            branchName: branch.name,
            lastUpdated: branch.updated_at,
            parentBranchId: branch.parent_id,
            parentBranchName,
          };
        },
      );

      logger.info(`Successfully retrieved Neon project info for app ${appId}`);

      return {
        projectId: project.id,
        projectName: project.name,
        orgId: project.org_id ?? "<unknown_org_id>",
        branches,
      };
    } catch (error) {
      logger.error(`Failed to get Neon project info for app ${appId}:`, error);
      throw error;
    }
  });

  // List all Neon projects for the authenticated user
  createTypedHandler(neonContracts.listProjects, async () => {
    logger.info("Listing Neon projects");

    try {
      const neonClient = await getNeonClient();
      const orgId = await getNeonOrganizationId();

      const response = await neonClient.listProjects({
        org_id: orgId,
        limit: 100,
      });

      if (!response.data.projects) {
        return { projects: [] };
      }

      if (response.data.projects.length >= 100) {
        logger.warn(
          "Neon project list may be truncated — returned 100 projects (the maximum). Some projects may not be shown.",
        );
      }

      return {
        projects: response.data.projects.map((p) => ({
          id: p.id,
          name: p.name,
          regionId: p.region_id,
          createdAt: p.created_at,
        })),
      };
    } catch (error: any) {
      const errorMessage = getNeonErrorMessage(error);
      logger.error(`Failed to list Neon projects: ${errorMessage}`);
      throw new Error(`Failed to list Neon projects: ${errorMessage}`);
    }
  });

  // Link an existing Neon project to a Dyad app
  createTypedHandler(neonContracts.setAppProject, async (_, params) => {
    const { appId, projectId } = params;
    logger.info(`Setting Neon project ${projectId} for app ${appId}`);

    // Guard: prevent connecting both Supabase and Neon on the same app
    const existingApp = await db
      .select({ supabaseProjectId: apps.supabaseProjectId })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);
    if (existingApp[0]?.supabaseProjectId) {
      throw new DyadError(
        "Cannot connect Neon: this app already has a Supabase project. Disconnect Supabase first.",
        DyadErrorKind.Precondition,
      );
    }

    try {
      const neonClient = await getNeonClient();

      // Get branches to find the development branch
      const branchesResponse = await neonClient.listProjectBranches({
        projectId,
      });

      if (!branchesResponse.data.branches) {
        throw new DyadError(
          "Failed to get branches for project",
          DyadErrorKind.External,
        );
      }

      const branches = branchesResponse.data.branches;

      // Find development branch by name first, then fall back to non-default/non-preview
      const defaultBranch = branches.find((b) => b.default);
      const dedicatedDevBranch =
        branches.find((b) => b.name === "development") ??
        branches.find((b) => !b.default && b.name !== "preview");

      const previewBranch = branches.find((b) => b.name === "preview");

      // Use the dedicated development branch if found, otherwise fall back to default
      // for the active branch only. neonDevelopmentBranchId should be null when
      // no dedicated development branch exists to prevent destructive operations
      // against the production/default branch.
      const activeBranchId =
        dedicatedDevBranch?.id ?? defaultBranch?.id ?? null;

      await db
        .update(apps)
        .set({
          neonProjectId: projectId,
          neonDevelopmentBranchId: dedicatedDevBranch?.id ?? null,
          neonPreviewBranchId: previewBranch?.id ?? null,
          neonActiveBranchId: activeBranchId,
        })
        .where(eq(apps.id, appId));

      // Auto-inject env vars into the app's .env.local
      let warning: string | undefined;
      if (activeBranchId) {
        warning = await autoInjectNeonEnvVars({
          appId,
          projectId,
          branchId: activeBranchId,
        });
      }

      logger.info(
        `Successfully linked Neon project ${projectId} to app ${appId}`,
      );
      return { success: true, warning };
    } catch (error: any) {
      if (error instanceof DyadError) throw error;
      const errorMessage = getNeonErrorMessage(error);
      logger.error(
        `Failed to set Neon project for app ${appId}: ${errorMessage}`,
      );
      throw new Error(
        `Failed to set Neon project for app ${appId}: ${errorMessage}`,
      );
    }
  });

  // Unlink a Neon project from a Dyad app
  createTypedHandler(neonContracts.unsetAppProject, async (_, params) => {
    const { appId } = params;
    logger.info(`Unsetting Neon project for app ${appId}`);

    try {
      // Fetch the app record to get its path before clearing Neon fields
      const appRecord = await db
        .select()
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);

      // Update DB first (easy to verify), then remove env vars.
      // If env removal fails, DB is correct and stale env vars are harmless.
      await db
        .update(apps)
        .set({
          neonProjectId: null,
          neonDevelopmentBranchId: null,
          neonPreviewBranchId: null,
          neonActiveBranchId: null,
        })
        .where(eq(apps.id, appId));

      if (appRecord.length > 0) {
        await removeNeonEnvVars({ appPath: appRecord[0].path });
      }

      logger.info(`Successfully unlinked Neon project from app ${appId}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`Failed to unset Neon project for app ${appId}:`, error);
      throw new Error(`Failed to unset Neon project for app ${appId}`);
    }
  });

  // Set the active branch for SQL execution
  createTypedHandler(neonContracts.setActiveBranch, async (_, params) => {
    const { appId, branchId } = params;
    logger.info(`Setting active Neon branch ${branchId} for app ${appId}`);

    try {
      const appRecord = await db
        .select()
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);

      if (appRecord.length === 0) {
        throw new DyadError(
          `App with ID ${appId} not found`,
          DyadErrorKind.NotFound,
        );
      }

      const appData = appRecord[0];

      if (!appData.neonProjectId) {
        throw new DyadError(
          `No Neon project found for app ${appId}`,
          DyadErrorKind.Precondition,
        );
      }

      // Validate that the branch belongs to this project
      const neonClient = await getNeonClient();
      await neonClient.getProjectBranch(appData.neonProjectId, branchId);

      // Update DB first, then inject env vars.
      // If env injection fails, DB is correct and a retry is safe.
      await db
        .update(apps)
        .set({ neonActiveBranchId: branchId })
        .where(eq(apps.id, appId));

      const warning = await autoInjectNeonEnvVars({
        appId,
        projectId: appData.neonProjectId,
        branchId,
      });

      logger.info(
        `Successfully set active branch ${branchId} for app ${appId}`,
      );
      return { success: true, warning };
    } catch (error: any) {
      if (error instanceof DyadError) throw error;
      logger.error(`Failed to set active branch for app ${appId}:`, error);
      throw new Error(`Failed to set active branch for app ${appId}`);
    }
  });

  // Execute SQL on a Neon database
  createTypedHandler(neonContracts.executeSql, async (_, params) => {
    const { appId, query } = params;
    logger.info(`Executing SQL for app ${appId}`);

    const { appData, branchId } = await getAppWithNeonBranch(appId);

    const result = await executeNeonSql({
      projectId: appData.neonProjectId!,
      branchId,
      query,
    });

    return { result };
  });

  // Get connection URI for a Neon project
  createTypedHandler(neonContracts.getConnectionUri, async (_, params) => {
    const { appId } = params;
    logger.info(`Getting connection URI for app ${appId}`);

    const { appData, branchId } = await getAppWithNeonBranch(appId);

    const neonClient = await getNeonClient();
    const roleName = await getBranchRoleName({
      projectId: appData.neonProjectId!,
      branchId,
    });
    const response = await neonClient.getConnectionUri({
      projectId: appData.neonProjectId!,
      branch_id: branchId,
      database_name: "neondb",
      role_name: roleName,
    });

    return { connectionUri: response.data.uri };
  });

  // Get table schema from a Neon database
  createTypedHandler(neonContracts.getTableSchema, async (_, params) => {
    const { appId, tableName } = params;
    logger.info(`Getting table schema for app ${appId}`);

    const { appData, branchId } = await getAppWithNeonBranch(appId);

    const schema = await getNeonTableSchema({
      projectId: appData.neonProjectId!,
      branchId,
      tableName,
    });

    return { schema };
  });

  // Get email and password config for the active branch
  createTypedHandler(
    neonContracts.getEmailPasswordConfig,
    async (_, params) => {
      const { appData, branchId } = await getAppWithNeonBranch(params.appId);
      const neonClient = await getNeonClient();

      try {
        const response = await neonClient.getNeonAuthEmailAndPasswordConfig(
          appData.neonProjectId!,
          branchId,
        );
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 404) {
          return {
            enabled: false,
            email_verification_method: "otp" as const,
            require_email_verification: false,
            auto_sign_in_after_verification: true,
            send_verification_email_on_sign_up: false,
            send_verification_email_on_sign_in: false,
            disable_sign_up: false,
          };
        }
        throw error;
      }
    },
  );

  // Update email verification setting for the active branch
  createTypedHandler(
    neonContracts.updateEmailVerification,
    async (_, params) => {
      const { appData, branchId } = await getAppWithNeonBranch(params.appId);
      const neonClient = await getNeonClient();

      const response = await neonClient.updateNeonAuthEmailAndPasswordConfig(
        appData.neonProjectId!,
        branchId,
        {
          require_email_verification: params.requireEmailVerification,
          ...(params.requireEmailVerification && {
            send_verification_email_on_sign_up: true,
          }),
        },
      );
      return response.data;
    },
  );

  testOnlyHandle("neon:fake-connect", async (event) => {
    // Call handleNeonOAuthReturn with fake data
    handleNeonOAuthReturn({
      token: "fake-neon-access-token",
      refreshToken: "fake-neon-refresh-token",
      expiresIn: 3600, // 1 hour
    });
    logger.info("Called handleNeonOAuthReturn with fake data during testing.");

    // Simulate the deep link event
    event.sender.send("deep-link-received", {
      type: "neon-oauth-return",
      url: "https://oauth.dyad.sh/api/integrations/neon/login",
    });
    logger.info("Sent fake neon deep-link-received event during testing.");
  });
}
