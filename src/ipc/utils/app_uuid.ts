import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../db";
import { apps } from "../../db/schema";

type AppWithUuid = {
  id: number;
  appUuid: string | null;
};

export async function ensureAppUuid<T extends AppWithUuid>(
  app: T,
): Promise<string> {
  if (app.appUuid) {
    return app.appUuid;
  }

  const appUuid = uuidv4();
  await db.update(apps).set({ appUuid }).where(eq(apps.id, app.id));
  app.appUuid = appUuid;
  return appUuid;
}
