import { eq } from "drizzle-orm";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/**
 * The app row, or a NotFound error.
 *
 * Handlers used to inline `if (!app) throw "App is not linked to a GitHub
 * repo."`, which diagnosed a missing row as an unlinked one. Whether an app
 * is linked is `requireAppGitRemote`'s question; this one only answers
 * whether the app exists.
 */
export async function findAppOrThrow(appId: number) {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  return app;
}
