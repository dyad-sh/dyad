import log from "electron-log";

import { createTestOnlyLoggedHandler } from "./safe_handle";
import { handleNeonOAuthReturn } from "../../neon_admin/neon_return_handler";
import {
  getNeonClient,
  getNeonOrganizationId,
} from "../../neon_admin/neon_management_client";
import {
  CreateNeonProjectParams,
  NeonProject,
  GetNeonProjectParams,
  GetNeonProjectResponse,
  NeonBranch,
} from "../ipc_types";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ipcMain } from "electron";
import { EndpointType } from "@neondatabase/api-client";

const logger = log.scope("neon_handlers");

const testOnlyHandle = createTestOnlyLoggedHandler(logger);

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelay: 1000, // 1 second
  maxDelay: 30_000, // 30 seconds
  jitterFactor: 0.1, // 10% jitter
};

/**
 * Retries an async operation with exponential backoff on locked errors (423)
 */
async function retryOnLocked<T>(
  operation: () => Promise<T>,
  context: string,
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Only retry on locked errors
      if (!isLockedError(error)) {
        throw error;
      }

      // Don't retry if we've exhausted all attempts
      if (attempt === RETRY_CONFIG.maxRetries) {
        logger.error(
          `${context}: Failed after ${RETRY_CONFIG.maxRetries + 1} attempts due to locked error`,
        );
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = RETRY_CONFIG.baseDelay * Math.pow(2, attempt);
      const jitter = baseDelay * RETRY_CONFIG.jitterFactor * Math.random();
      const delay = Math.min(baseDelay + jitter, RETRY_CONFIG.maxDelay);

      logger.warn(
        `${context}: Locked error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}), retrying in ${Math.round(delay)}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export function registerNeonHandlers() {
  // Do not use log handler because there's sensitive data in the response
  ipcMain.handle(
    "neon:create-project",
    async (
      _,
      { name, appId }: CreateNeonProjectParams,
    ): Promise<NeonProject> => {
      const neonClient = await getNeonClient();

      logger.info(`Creating Neon project: ${name} for app ${appId}`);

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
          throw new Error(
            "Failed to create project: No project data returned.",
          );
        }

        const project = response.data.project;

        // Create a development branch with retry on locked errors
        const branchResponse = await retryOnLocked(
          () =>
            neonClient.createProjectBranch(project.id, {
              endpoints: [{ type: EndpointType.ReadWrite }],
              branch: {
                name: "development",
              },
            }),
          `Create development branch for project ${project.id}`,
        );

        if (
          !branchResponse.data.branch ||
          !branchResponse.data.connection_uris
        ) {
          throw new Error(
            "Failed to create development branch: No branch data returned.",
          );
        }

        const developmentBranch = branchResponse.data.branch;

        // Store project and branch info in the app's DB row
        await db
          .update(apps)
          .set({
            neonProjectId: project.id,
            neonBranchId: developmentBranch.id,
          })
          .where(eq(apps.id, appId));

        logger.info(
          `Successfully created Neon project: ${project.id} and development branch: ${developmentBranch.id} for app ${appId}`,
        );
        return {
          id: project.id,
          name: project.name,
          connectionString:
            branchResponse.data.connection_uris[0].connection_uri,
          branchId: developmentBranch.id,
        };
      } catch (error: any) {
        const errorMessage = getNeonErrorMessage(error);
        const message = `Failed to create Neon project for app ${appId}: ${errorMessage}`;
        logger.error(message);
        throw new Error(message);
      }
    },
  );

  ipcMain.handle(
    "neon:get-project",
    async (
      _,
      { appId }: GetNeonProjectParams,
    ): Promise<GetNeonProjectResponse> => {
      logger.info(`Getting Neon project info for app ${appId}`);

      try {
        // Get the app from the database to find the neonProjectId and neonBranchId
        const app = await db
          .select()
          .from(apps)
          .where(eq(apps.id, appId))
          .limit(1);

        if (app.length === 0) {
          throw new Error(`App with ID ${appId} not found`);
        }

        const appData = app[0];
        if (!appData.neonProjectId) {
          throw new Error(`No Neon project found for app ${appId}`);
        }

        const neonClient = await getNeonClient();
        console.log("PROJECT ID", appData.neonProjectId);

        // Get project info
        const projectResponse = await neonClient.getProject(
          appData.neonProjectId,
        );

        if (!projectResponse.data.project) {
          throw new Error("Failed to get project: No project data returned.");
        }

        const project = projectResponse.data.project;

        // Get list of branches
        const branchesResponse = await neonClient.listProjectBranches({
          projectId: appData.neonProjectId,
        });

        if (!branchesResponse.data.branches) {
          throw new Error("Failed to get branches: No branch data returned.");
        }

        // Map branches to our format
        const branches: NeonBranch[] = branchesResponse.data.branches.map(
          (branch) => {
            let type: "production" | "development" | "snapshot";

            if (branch.default) {
              type = "production";
            } else if (branch.id === appData.neonBranchId) {
              type = "development";
            } else {
              type = "snapshot";
            }

            return {
              type,
              branchId: branch.id,
              branchName: branch.name,
              lastUpdated: branch.updated_at,
            };
          },
        );

        logger.info(
          `Successfully retrieved Neon project info for app ${appId}`,
        );

        return {
          projectId: project.id,
          projectName: project.name,
          orgId: project.org_id ?? "<unknown_org_id>",
          branches,
        };
      } catch (error) {
        logger.error(
          `Failed to get Neon project info for app ${appId}:`,
          error,
        );
        throw error;
      }
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

function getNeonErrorMessage(error: any): string {
  const detailedMessage = error.response?.data?.message ?? "";
  return error.message + " " + detailedMessage;
}

function isLockedError(error: any): boolean {
  return error.response?.status === 423;
}
