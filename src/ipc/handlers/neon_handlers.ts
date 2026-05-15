import fs from "node:fs/promises";
import { createTestOnlyLoggedHandler } from "./safe_handle";
import { createTypedHandler } from "./base";
import { handleNeonOAuthReturn } from "../../neon_admin/neon_return_handler";
import {
  getCachedEmailPasswordConfig,
  getNeonClient,
  getNeonErrorMessage,
  getNeonOrganizationId,
  invalidateEmailPasswordConfigCache,
} from "../../neon_admin/neon_management_client";
import { neonContracts, type NeonBranch } from "../types/neon";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { EndpointType } from "@neondatabase/api-client";
import { retryOnLocked } from "../utils/retryOnLocked";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  getEnvFilePath,
  readEnvFileIfExists,
  removeNeonEnvVars,
} from "../utils/app_env_var_utils";
import {
  logger,
  combineWarnings,
  buildNeonAuthActivationWarning,
  getAppWithNeonBranch,
  ensureNeonAuth,
  autoInjectNeonEnvVars,
  assertNoSupabaseProject,
  assertNoNeonProject,
} from "../utils/neon_utils";
import {
  ensureNitroIfVite,
  type EnsureNitroResult,
} from "../utils/nitro_setup";
import { getDyadAppPath } from "@/paths/paths";
import { getProductionBranchId } from "../utils/migration_utils";
import { getConnectionUri } from "../../neon_admin/neon_context";

const testOnlyHandle = createTestOnlyLoggedHandler(logger);

async function restoreEnvFileSnapshot({
  appPath,
  snapshot,
}: {
  appPath: string;
  snapshot: string | null | undefined;
}): Promise<void> {
  if (snapshot === undefined) {
    // Snapshot was never taken — don't touch the file.
    return;
  }
  const envFilePath = getEnvFilePath({ appPath });
  if (snapshot === null) {
    await fs.rm(envFilePath, { force: true });
    return;
  }

  await fs.writeFile(envFilePath, snapshot);
}

export function registerNeonHandlers() {
  // Do not use log handler because there's sensitive data in the response
  createTypedHandler(neonContracts.createProject, async (_, params) => {
    const { name, appId } = params;
    const neonClient = await getNeonClient();

    logger.info(`Creating Neon project: ${name} for app ${appId}`);

    await assertNoSupabaseProject(appId);
    await assertNoNeonProject(appId);

    // Fetch app path upfront for env-var injection later
    const appRecord = await db
      .select({ path: apps.path })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);
    if (appRecord.length === 0) {
      throw new DyadError(
        `App with ID ${appId} not found`,
        DyadErrorKind.NotFound,
      );
    }
    const appPath = appRecord[0].path;
    const resolvedAppPath = getDyadAppPath(appPath);

    // Vite apps need a Nitro server layer to safely host server-only Neon code
    // (DATABASE_URL, neon client, auth secrets). Add it before any Neon API
    // calls so a Nitro failure won't orphan a Neon project.
    const nitroSetup = await ensureNitroIfVite(resolvedAppPath);
    const nitroWarnings = nitroSetup.warningMessages;
    let nitroRolledBack = false;
    const rollbackNitroOnce = async () => {
      if (nitroRolledBack) return;
      nitroRolledBack = true;
      try {
        await nitroSetup.rollback();
      } catch (rollbackError) {
        logger.error(
          `Failed to roll back Nitro setup for app ${appId}: ${rollbackError}`,
        );
      }
    };

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

      if (!response.data.branch) {
        throw new DyadError(
          "Failed to create project: No branch data returned.",
          DyadErrorKind.External,
        );
      }

      const project = response.data.project;
      const mainBranch = response.data.branch;
      const authWarnings: string[] = [];

      // Snapshot env file before modification so we can restore on failure
      let envFileSnapshot: string | null | undefined = undefined;

      // Post-creation steps: if any fail, best-effort delete the orphan project
      try {
        envFileSnapshot = await readEnvFileIfExists({ appPath });
        // Enable Neon Auth on the main branch
        if (
          !(await ensureNeonAuth({
            projectId: project.id,
            branchId: mainBranch.id,
          }))
        ) {
          authWarnings.push(buildNeonAuthActivationWarning("production"));
        }

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
        if (
          !(await ensureNeonAuth({
            projectId: project.id,
            branchId: developmentBranch.id,
          }))
        ) {
          authWarnings.push(buildNeonAuthActivationWarning("development"));
        }

        // Create preview branch as a child of development
        const previewBranchResponse = await retryOnLocked(
          () =>
            neonClient.createProjectBranch(project.id, {
              endpoints: [{ type: EndpointType.ReadWrite }],
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
        if (
          !(await ensureNeonAuth({
            projectId: project.id,
            branchId: previewBranch.id,
          }))
        ) {
          authWarnings.push(buildNeonAuthActivationWarning("preview"));
        }

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
        const warning = combineWarnings(
          ...nitroWarnings,
          ...authWarnings,
          await autoInjectNeonEnvVars({
            appPath,
            projectId: project.id,
            branchId: developmentBranch.id,
          }),
        );

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
      } catch (postCreateError) {
        // Best-effort cleanup: delete the orphan Neon project
        logger.warn(
          `Post-creation step failed for project ${project.id}, attempting cleanup: ${postCreateError}`,
        );
        try {
          await neonClient.deleteProject(project.id);
          logger.info(
            `Successfully cleaned up orphan Neon project ${project.id}`,
          );
        } catch (deleteError) {
          logger.error(
            `Failed to clean up orphan Neon project ${project.id}: ${deleteError}`,
          );
        }
        // Clear stale Neon references from the app row so it doesn't
        // point at the now-deleted project.
        try {
          await db
            .update(apps)
            .set({
              neonProjectId: null,
              neonDevelopmentBranchId: null,
              neonPreviewBranchId: null,
              neonActiveBranchId: null,
            })
            .where(eq(apps.id, appId));
        } catch (dbCleanupError) {
          logger.error(
            `Failed to clear Neon fields from app ${appId} after project cleanup: ${dbCleanupError}`,
          );
        }
        // Restore env file to pre-modification state
        try {
          await restoreEnvFileSnapshot({
            appPath,
            snapshot: envFileSnapshot,
          });
        } catch (envCleanupError) {
          logger.error(
            `Failed to restore .env.local for app ${appId} after project cleanup: ${envCleanupError}`,
          );
        }
        // Roll back the Nitro server layer we added at the top of this
        // handler so a failed connect doesn't leave the app with
        // nitro.config.ts, server/, vite.config.ts edits, and AI_RULES
        // changes for a project that was never linked.
        await rollbackNitroOnce();
        throw postCreateError;
      }
    } catch (error: any) {
      // Catches errors from pre-postCreate steps (e.g. getNeonOrganizationId,
      // createProject). The postCreate inner catch already rolled back Nitro
      // for its failures; this handles everything else.
      await rollbackNitroOnce();
      if (error instanceof DyadError) throw error;
      const errorMessage = getNeonErrorMessage(error);
      const message = `Failed to create Neon project for app ${appId}: ${errorMessage}`;
      logger.error(message);
      throw new DyadError(message, DyadErrorKind.External);
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
      throw new DyadError(
        `Failed to list Neon projects: ${errorMessage}`,
        DyadErrorKind.External,
      );
    }
  });

  // Link an existing Neon project to a Dyad app
  createTypedHandler(neonContracts.setAppProject, async (_, params) => {
    const { appId, projectId } = params;
    logger.info(`Setting Neon project ${projectId} for app ${appId}`);

    await assertNoSupabaseProject(appId);
    await assertNoNeonProject(appId);

    // Fetch app path upfront for env-var injection later
    const appRecord = await db
      .select({ path: apps.path })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);
    if (appRecord.length === 0) {
      throw new DyadError(
        `App with ID ${appId} not found`,
        DyadErrorKind.NotFound,
      );
    }
    const appPath = appRecord[0].path;
    const resolvedAppPath = getDyadAppPath(appPath);

    const envFileSnapshot = await readEnvFileIfExists({ appPath });
    let nitroSetup: EnsureNitroResult | null = null;

    try {
      // Validate the Neon project exists and is accessible BEFORE installing
      // Nitro, so an auth/project-id failure doesn't leave the app with a
      // half-installed Nitro server layer.
      const neonClient = await getNeonClient();
      const branchesResponse = await neonClient.listProjectBranches({
        projectId,
      });

      // Vite apps need a Nitro server layer to safely host server-only Neon
      // code. Run this after Neon validation but before linking so a Nitro
      // failure leaves the app unlinked.
      nitroSetup = await ensureNitroIfVite(resolvedAppPath);

      if (!branchesResponse.data.branches) {
        throw new DyadError(
          "Failed to get branches for project",
          DyadErrorKind.External,
        );
      }

      const branches = branchesResponse.data.branches;

      // Find development branch by name first, then fall back to non-default/non-preview
      const defaultBranch = branches.find((b) => b.default);
      const dedicatedDevBranch = branches.find((b) => b.name === "development");

      const previewBranch = branches.find((b) => b.name === "preview");

      // Use the dedicated development branch if found, otherwise fall back to default
      // for the active branch only. neonDevelopmentBranchId should be null when
      // no dedicated development branch exists to prevent destructive operations
      // against the production/default branch.
      const activeBranchId =
        dedicatedDevBranch?.id ?? defaultBranch?.id ?? null;

      if (!activeBranchId) {
        throw new DyadError(
          "Linked Neon project has no writable branch. Create a development branch in Neon before connecting this app.",
          DyadErrorKind.Precondition,
        );
      }

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
      try {
        warning = await autoInjectNeonEnvVars({
          appPath,
          projectId,
          branchId: activeBranchId,
        });
      } catch (envError) {
        // Revert the DB update so the app doesn't end up half-linked
        logger.warn(
          `autoInjectNeonEnvVars failed for app ${appId}, reverting DB update: ${envError}`,
        );
        try {
          await db
            .update(apps)
            .set({
              neonProjectId: null,
              neonDevelopmentBranchId: null,
              neonPreviewBranchId: null,
              neonActiveBranchId: null,
            })
            .where(eq(apps.id, appId));
        } catch (revertError) {
          logger.error(
            `Failed to revert Neon fields from app ${appId}: ${revertError}`,
          );
        }
        try {
          await restoreEnvFileSnapshot({
            appPath,
            snapshot: envFileSnapshot,
          });
        } catch (restoreError) {
          logger.error(
            `Failed to restore .env.local for app ${appId}: ${restoreError}`,
          );
        }
        throw envError;
      }

      logger.info(
        `Successfully linked Neon project ${projectId} to app ${appId}`,
      );
      return {
        success: true,
        warning: combineWarnings(...nitroSetup.warningMessages, warning),
      };
    } catch (error: any) {
      // Roll back the Nitro server layer we added so a failed link doesn't
      // leave the app with nitro.config.ts, server/, vite.config.ts edits,
      // and AI_RULES changes for a project that was never linked.
      if (nitroSetup) {
        try {
          await nitroSetup.rollback();
        } catch (rollbackError) {
          logger.error(
            `Failed to roll back Nitro setup for app ${appId}: ${rollbackError}`,
          );
        }
      }
      if (error instanceof DyadError) throw error;
      const errorMessage = getNeonErrorMessage(error);
      logger.error(
        `Failed to set Neon project for app ${appId}: ${errorMessage}`,
      );
      throw new DyadError(
        `Failed to set Neon project for app ${appId}: ${errorMessage}`,
        DyadErrorKind.External,
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
      const errorMessage = getNeonErrorMessage(error);
      logger.error(
        `Failed to unset Neon project for app ${appId}: ${errorMessage}`,
      );
      throw new DyadError(
        `Failed to unset Neon project for app ${appId}: ${errorMessage}`,
        DyadErrorKind.External,
      );
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
      const envFileSnapshot = await readEnvFileIfExists({
        appPath: appData.path,
      });

      if (!appData.neonProjectId) {
        throw new DyadError(
          `No Neon project found for app ${appId}`,
          DyadErrorKind.Precondition,
        );
      }

      // Validate that the branch belongs to this project
      const neonClient = await getNeonClient();
      const branchResponse = await neonClient.getProjectBranch(
        appData.neonProjectId,
        branchId,
      );
      if (branchResponse.data.branch?.project_id !== appData.neonProjectId) {
        throw new DyadError(
          `Branch ${branchId} does not belong to Neon project ${appData.neonProjectId}`,
          DyadErrorKind.Precondition,
        );
      }

      if (branchId === appData.neonPreviewBranchId) {
        throw new DyadError(
          "Preview branches are used for historical rollback and cannot be selected as the active Neon branch.",
          DyadErrorKind.Precondition,
        );
      }

      // Update DB first, then inject env vars.
      // If env injection fails, revert the DB update so the app and env stay in sync.
      const previousActiveBranchId = appData.neonActiveBranchId;
      await db
        .update(apps)
        .set({ neonActiveBranchId: branchId })
        .where(eq(apps.id, appId));

      let warning: string | undefined;
      try {
        warning = await autoInjectNeonEnvVars({
          appPath: appData.path,
          projectId: appData.neonProjectId!,
          branchId,
        });
      } catch (envError) {
        logger.warn(
          `autoInjectNeonEnvVars failed for app ${appId}, reverting active branch: ${envError}`,
        );
        try {
          await db
            .update(apps)
            .set({ neonActiveBranchId: previousActiveBranchId })
            .where(eq(apps.id, appId));
        } catch (revertError) {
          logger.error(
            `Failed to revert active branch for app ${appId}: ${revertError}`,
          );
        }
        try {
          await restoreEnvFileSnapshot({
            appPath: appData.path,
            snapshot: envFileSnapshot,
          });
        } catch (restoreError) {
          logger.error(
            `Failed to restore .env.local for app ${appId}: ${restoreError}`,
          );
        }
        throw envError;
      }

      logger.info(
        `Successfully set active branch ${branchId} for app ${appId}`,
      );
      return { success: true, warning };
    } catch (error: any) {
      if (error instanceof DyadError) throw error;
      const errorMessage = getNeonErrorMessage(error);
      logger.error(
        `Failed to set active branch for app ${appId}: ${errorMessage}`,
      );
      throw new DyadError(
        `Failed to set active branch for app ${appId}: ${errorMessage}`,
        DyadErrorKind.External,
      );
    }
  });

  // Get email and password config for the active branch
  createTypedHandler(
    neonContracts.getEmailPasswordConfig,
    async (_, params) => {
      const { appData, branchId } = await getAppWithNeonBranch(params.appId);
      return getCachedEmailPasswordConfig(appData.neonProjectId!, branchId);
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
          send_verification_email_on_sign_up: params.requireEmailVerification,
        },
      );
      invalidateEmailPasswordConfigCache(appData.neonProjectId!, branchId);
      return response.data;
    },
  );

  // Do not use log handler because there's sensitive data in the response
  createTypedHandler(
    neonContracts.getBranchConnectionUri,
    async (_, params) => {
      const { appId, branchType } = params;

      const appRows = await db
        .select()
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);
      if (appRows.length === 0) {
        throw new DyadError(
          `App with ID ${appId} not found`,
          DyadErrorKind.NotFound,
        );
      }
      const appData = appRows[0];
      if (!appData.neonProjectId) {
        throw new DyadError(
          "This app is not connected to a Neon project.",
          DyadErrorKind.Precondition,
        );
      }

      let branchId: string;
      if (branchType === "production") {
        const result = await getProductionBranchId(appData.neonProjectId);
        branchId = result.branchId;
      } else {
        if (!appData.neonDevelopmentBranchId) {
          throw new DyadError(
            "This app has no development branch. Create one in Neon before requesting a development connection URI.",
            DyadErrorKind.Precondition,
          );
        }
        branchId = appData.neonDevelopmentBranchId;
      }

      const connectionUri = await getConnectionUri({
        projectId: appData.neonProjectId,
        branchId,
      });

      return { connectionUri };
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
