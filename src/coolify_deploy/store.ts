import { eq } from "drizzle-orm";
import { db } from "@/db";
import { coolifyAppConnections } from "@/db/schema";
import { CoolifyClient } from "@/ipc/utils/coolify_client";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  coolifyConnectionFromRow,
  coolifyConnectionRow,
  type CoolifyConnectionState,
} from "./connection";

/**
 * The two things both the handlers and the deploy pipeline need: a client for
 * the configured instance, and an app's connection row.
 *
 * Held here because both had their own copy, and a copy of "how a client is
 * built" or "what an absent row means" is a copy that can disagree with the
 * other half of the feature about what the user is connected to.
 */

/**
 * A client for the instance currently configured.
 *
 * The signal is optional because the handlers answer a single request while
 * the pipeline runs long enough to be cancelled partway.
 */
export function getClient(signal?: AbortSignal): CoolifyClient {
  const settings = readSettings();
  const token = settings.coolify?.accessToken?.value;
  const instanceUrl = settings.coolify?.instanceUrl;
  if (!token || !instanceUrl) {
    throw new DyadError(
      "Coolify is not connected. Add your instance URL and API token first.",
      DyadErrorKind.Validation,
    );
  }
  return new CoolifyClient({ instanceUrl, token, signal });
}

/** No row is no connection, which is what disconnecting leaves behind. */
export async function readConnectionState(
  appId: number,
): Promise<CoolifyConnectionState> {
  const row = await db.query.coolifyAppConnections.findFirst({
    where: eq(coolifyAppConnections.appId, appId),
  });
  return coolifyConnectionFromRow(row ?? null);
}

/**
 * Writes the state as a row, or removes the row when there should be none.
 *
 * The whole row goes every time, so no write can leave some fields describing
 * a connection that no longer exists.
 *
 * A row is keyed by the target it deploys to, and an app gets one at a time.
 * That rule lives here rather than in a unique index on app_id, so that
 * allowing several later needs no change to the schema.
 */
export async function writeConnectionState(
  appId: number,
  state: CoolifyConnectionState,
): Promise<void> {
  const row = coolifyConnectionRow(state);
  if (!row) {
    await db
      .delete(coolifyAppConnections)
      .where(eq(coolifyAppConnections.appId, appId));
    return;
  }
  // Replace rather than update: the row is rewritten whole anyway, and this
  // way moving an app to another target needs no separate cleanup. In one
  // transaction, so the app is never briefly connected to nothing.
  db.transaction((tx) => {
    tx.delete(coolifyAppConnections)
      .where(eq(coolifyAppConnections.appId, appId))
      .run();
    tx.insert(coolifyAppConnections)
      .values({ appId, ...row })
      .run();
  });
}
