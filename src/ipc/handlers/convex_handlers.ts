import log from "electron-log";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { apps } from "../../db/schema";
import { createTypedHandler } from "./base";
import { convexContracts } from "../types/convex";

const logger = log.scope("convex_handlers");

export function registerConvexHandlers() {
  // Set app deployment - links a Dyad app to a Convex deployment
  createTypedHandler(convexContracts.setAppDeployment, async (_, params) => {
    const { deploymentUrl, appId } = params;
    await db
      .update(apps)
      .set({
        convexDeploymentUrl: deploymentUrl,
      })
      .where(eq(apps.id, appId));

    logger.info(
      `Associated app ${appId} with Convex deployment ${deploymentUrl}`,
    );
  });

  // Unset app deployment - removes the link between a Dyad app and a Convex deployment
  createTypedHandler(convexContracts.unsetAppDeployment, async (_, params) => {
    const { appId } = params;
    await db
      .update(apps)
      .set({
        convexDeploymentUrl: null,
      })
      .where(eq(apps.id, appId));

    logger.info(`Removed Convex deployment association for app ${appId}`);
  });
}
