import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { themesData, type Theme } from "../../shared/themes";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq, sql } from "drizzle-orm";

const logger = log.scope("themes_handlers");
const handle = createLoggedHandler(logger);

export function registerThemesHandlers() {
  handle("get-themes", async (): Promise<Theme[]> => {
    return themesData;
  });

  handle(
    "set-app-theme",
    async (
      _,
      params: { appId: number; themeId: string | null },
    ): Promise<void> => {
      const { appId, themeId } = params;
      // Use raw SQL to properly set NULL when themeId is null/undefined
      if (themeId === null || themeId === undefined || themeId === "none") {
        await db
          .update(apps)
          .set({ themeId: sql`NULL` })
          .where(eq(apps.id, appId));
        logger.log(`Set theme for app ${appId} to none`);
      } else {
        await db.update(apps).set({ themeId }).where(eq(apps.id, appId));
        logger.log(`Set theme for app ${appId} to ${themeId}`);
      }
    },
  );

  handle(
    "get-app-theme",
    async (_, params: { appId: number }): Promise<string | null> => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.appId),
        columns: { themeId: true },
      });
      return app?.themeId ?? null;
    },
  );
}
