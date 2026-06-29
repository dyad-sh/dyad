import { and, eq, isNull } from "drizzle-orm";
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
  const [updated] = await db
    .update(apps)
    .set({ appUuid })
    .where(and(eq(apps.id, app.id), isNull(apps.appUuid)))
    .returning({ appUuid: apps.appUuid });

  if (updated?.appUuid) {
    app.appUuid = updated.appUuid;
    return updated.appUuid;
  }

  const current = await db.query.apps.findFirst({
    columns: { appUuid: true },
    where: eq(apps.id, app.id),
  });
  if (current?.appUuid) {
    app.appUuid = current.appUuid;
    return current.appUuid;
  }

  throw new Error(`Could not ensure app UUID for app ${app.id}`);
}
