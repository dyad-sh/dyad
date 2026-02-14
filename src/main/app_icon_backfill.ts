import { and, eq, isNull } from "drizzle-orm";
import log from "electron-log";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { createGeneratedIconDataForApp } from "@/lib/appIcons";

const logger = log.scope("app_icon_backfill");
const ICON_BACKFILL_BATCH_SIZE = 10;

let isBackfillRunning = false;
let hasBackfillCompleted = false;

export async function runAppIconBackfill(): Promise<void> {
  if (isBackfillRunning || hasBackfillCompleted) {
    return;
  }

  isBackfillRunning = true;
  try {
    while (true) {
      const missingIcons = await db.query.apps.findMany({
        where: and(isNull(apps.iconType), isNull(apps.iconData)),
        columns: {
          id: true,
          name: true,
        },
        limit: ICON_BACKFILL_BATCH_SIZE,
      });

      if (missingIcons.length === 0) {
        break;
      }

      for (const targetApp of missingIcons) {
        await db
          .update(apps)
          .set({
            iconType: "generated",
            iconData: createGeneratedIconDataForApp(
              targetApp.id,
              targetApp.name,
            ),
          })
          .where(and(eq(apps.id, targetApp.id), isNull(apps.iconType)));
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    hasBackfillCompleted = true;
    logger.info("Completed app icon backfill");
  } catch (error) {
    logger.error("Failed app icon backfill:", error);
  } finally {
    isBackfillRunning = false;
  }
}
