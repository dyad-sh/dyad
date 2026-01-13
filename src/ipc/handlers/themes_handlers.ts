import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { themesData, type Theme } from "../../shared/themes";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import type { SetAppThemeParams, GetAppThemeParams } from "../ipc_types";

const logger = log.scope("themes_handlers");
const handle = createLoggedHandler(logger);

export function registerThemesHandlers() {
  handle("get-themes", async (): Promise<Theme[]> => {
    return themesData;
  });

  handle(
    "set-app-theme",
    async (_, params: SetAppThemeParams): Promise<void> => {
      const { appId, themeId } = params;
      // Use raw SQL to properly set NULL when themeId is null (representing "no theme")
      if (!themeId) {
        await db
          .update(apps)
          .set({ themeId: sql`NULL` })
          .where(eq(apps.id, appId));
      } else {
        await db.update(apps).set({ themeId }).where(eq(apps.id, appId));
      }
    },
  );

  handle(
    "get-app-theme",
    async (_, params: GetAppThemeParams): Promise<string | null> => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.appId),
        columns: { themeId: true },
      });
      return app?.themeId ?? null;
    },
  );
}
