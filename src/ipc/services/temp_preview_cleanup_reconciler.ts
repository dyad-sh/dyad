import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import {
  clearTempPreviewAppDeletionMarker,
  deleteTempPreviewForApp,
  listPendingTempPreviewDeletionAppIds,
} from "./temp_preview_service";

const logger = log.scope("temp_preview_cleanup_reconciler");

/**
 * Retries preview revocation left behind by a crash or transient temp.md
 * failure during app deletion. A marker created before the database delete is
 * cleared when the app row still exists; otherwise the stored capability is
 * used to finish remote cleanup and is removed only after success.
 */
export async function reconcilePendingTempPreviewDeletions(): Promise<void> {
  let appIds: number[];
  try {
    appIds = await listPendingTempPreviewDeletionAppIds();
  } catch (error) {
    logger.error(
      "Failed to read pending temporary preview deletion markers",
      error,
    );
    return;
  }

  for (const appId of appIds) {
    try {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
        columns: { id: true },
      });
      if (app) {
        await clearTempPreviewAppDeletionMarker(appId);
        logger.info(
          `Cleared stale temporary preview deletion marker for live app ${appId}`,
        );
        continue;
      }

      await deleteTempPreviewForApp(appId);
      logger.info(
        `Reconciled temporary preview cleanup for deleted app ${appId}`,
      );
    } catch (error) {
      logger.warn(
        `Failed to reconcile temporary preview cleanup for app ${appId}; the durable marker and capability remain for retry.`,
        error,
      );
    }
  }
}
