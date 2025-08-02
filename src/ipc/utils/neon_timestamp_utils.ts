import { db } from "../../db";
import { versions, apps } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";
import git from "isomorphic-git";
import { getDyadAppPath } from "../../paths/paths";
import { neon } from "@neondatabase/serverless";

import log from "electron-log";
import { getNeonClient } from "@/neon_admin/neon_management_client";

const logger = log.scope("neon_timestamp_utils");

/**
 * Retrieves the current timestamp from a Neon database
 */
async function getLastUpdatedTimestampFromNeon({
  neonConnectionUri,
}: {
  neonConnectionUri: string;
}): Promise<string> {
  try {
    const sql = neon(neonConnectionUri);

    const [{ current_timestamp }] = await sql`
      SELECT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z') AS current_timestamp
    `;

    return current_timestamp;
  } catch (error) {
    logger.error("Error retrieving timestamp from Neon:", error);
    throw new Error(`Failed to retrieve timestamp from Neon: ${error}`);
  }
}

/**
 * Stores a Neon database timestamp for the current git commit hash
 * and stores it in the versions table
 * @param appId - The app ID
 * @param neonConnectionUri - The Neon connection URI to get the timestamp from
 */
export async function storeDbTimestampAtCurrentVersion({
  appId,
}: {
  appId: number;
}): Promise<{ timestamp: string }> {
  try {
    logger.info(`Storing DB timestamp for current version - app ${appId}`);

    // 1. Get the app to find the path
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error(`App with ID ${appId} not found`);
    }

    if (!app.neonProjectId || !app.neonDevelopmentBranchId) {
      throw new Error(`App with ID ${appId} has no Neon project or branch`);
    }

    // 2. Get the current commit hash
    const appPath = getDyadAppPath(app.path);
    const currentCommitHash = await git.resolveRef({
      fs,
      dir: appPath,
      ref: "HEAD",
    });

    logger.info(`Current commit hash: ${currentCommitHash}`);

    const neonClient = await getNeonClient();
    const connectionUri = await neonClient.getConnectionUri({
      projectId: app.neonProjectId,
      branch_id: app.neonDevelopmentBranchId,
      database_name: "neondb",
      role_name: "neondb_owner",
    });

    // 3. Get the current timestamp from Neon
    const currentTimestamp = await getLastUpdatedTimestampFromNeon({
      neonConnectionUri: connectionUri.data.uri,
    });

    logger.info(`Current timestamp from Neon: ${currentTimestamp}`);

    // 4. Check if a version with this commit hash already exists
    const existingVersion = await db.query.versions.findFirst({
      where: and(
        eq(versions.appId, appId),
        eq(versions.commitHash, currentCommitHash),
      ),
    });

    if (existingVersion) {
      // Update existing version with the new timestamp
      await db
        .update(versions)
        .set({
          neonDbTimestamp: currentTimestamp,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(versions.appId, appId),
            eq(versions.commitHash, currentCommitHash),
          ),
        );
      logger.info(
        `Updated existing version record with timestamp ${currentTimestamp}`,
      );
    } else {
      // Create new version record
      await db.insert(versions).values({
        appId,
        commitHash: currentCommitHash,
        neonDbTimestamp: currentTimestamp,
      });
      logger.info(
        `Created new version record for commit ${currentCommitHash} with timestamp ${currentTimestamp}`,
      );
    }

    logger.info(
      `Successfully stored timestamp for commit ${currentCommitHash} in app ${appId}`,
    );

    return { timestamp: currentTimestamp };
  } catch (error) {
    logger.error("Error in storeDbTimestampAtCurrentVersion:", error);
    throw error;
  }
}
