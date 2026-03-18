import { db } from "../../db";
import { versions } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentCommitHash } from "./git_utils";

import log from "electron-log";

const logger = log.scope("supabase_undo_sql_utils");

/**
 * Stores undo-SQL for the current git commit hash on the version record.
 * If a version record already exists for this commit (e.g. from Neon timestamp),
 * it updates it. Otherwise, it creates a new one.
 */
export async function storeUndoSqlAtCurrentVersion({
  appId,
  appPath,
  undoSql,
}: {
  appId: number;
  appPath: string;
  undoSql: string;
}): Promise<void> {
  try {
    const currentCommitHash = await getCurrentCommitHash({ path: appPath });
    logger.info(
      `[DEBUG-ROLLBACK] storeUndoSql called: appId=${appId}, commitHash=${currentCommitHash}, undoSql=${undoSql.slice(0, 200)}`,
    );

    const existingVersion = await db.query.versions.findFirst({
      where: and(
        eq(versions.appId, appId),
        eq(versions.commitHash, currentCommitHash),
      ),
    });

    logger.info(
      `[DEBUG-ROLLBACK] Existing version record found: ${!!existingVersion}, id=${existingVersion?.id}`,
    );

    if (existingVersion) {
      // Append to existing undo-SQL if there is already some stored
      const combinedUndoSql = existingVersion.supabaseUndoSql
        ? existingVersion.supabaseUndoSql + "\n" + undoSql
        : undoSql;

      await db
        .update(versions)
        .set({
          supabaseUndoSql: combinedUndoSql,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(versions.appId, appId),
            eq(versions.commitHash, currentCommitHash),
          ),
        );
      logger.info(
        `[DEBUG-ROLLBACK] Updated version record with undo-SQL for commit ${currentCommitHash}`,
      );
    } else {
      await db.insert(versions).values({
        appId,
        commitHash: currentCommitHash,
        supabaseUndoSql: undoSql,
      });
      logger.info(
        `[DEBUG-ROLLBACK] Created NEW version record with undo-SQL for commit ${currentCommitHash}`,
      );
    }
  } catch (error) {
    logger.error(
      "[DEBUG-ROLLBACK] Error in storeUndoSqlAtCurrentVersion:",
      error,
    );
    throw error;
  }
}
