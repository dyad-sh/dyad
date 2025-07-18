import log from "electron-log";

import { createTestOnlyLoggedHandler } from "./safe_handle";
import { handleNeonOAuthReturn } from "../../neon_admin/neon_return_handler";
import {
  getNeonClient,
  getNeonOrganizationId,
} from "../../neon_admin/neon_management_client";
import { CreateNeonProjectParams, NeonProject } from "../ipc_types";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ipcMain } from "electron";

const logger = log.scope("neon_handlers");

const testOnlyHandle = createTestOnlyLoggedHandler(logger);

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

        // Handle both real client and mock client
        const response = await (neonClient as any).createProject({
          project: {
            name: name,
            org_id: orgId,
          },
        });

        if (!response.data.project) {
          throw new Error(
            "Failed to create project: No project data returned.",
          );
        }

        const project = response.data.project;

        // Store project info in the app's DB row
        await db
          .update(apps)
          .set({
            neonProjectId: project.id,
          })
          .where(eq(apps.id, appId));

        logger.info(
          `Successfully created Neon project: ${project.id} for app ${appId}`,
        );
        return {
          id: project.id,
          name: project.name,
          connectionString: response.data.connection_uris[0].connection_uri,
        };
      } catch (error) {
        logger.error(`Failed to create Neon project for app ${appId}:`, error);
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
      url: "https://neon-oauth.dyad.sh/api/connect-neon/login",
    });
    logger.info("Sent fake neon deep-link-received event during testing.");
  });
}
