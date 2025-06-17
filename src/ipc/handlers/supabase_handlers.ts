import log from "electron-log";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { apps } from "../../db/schema";
import { getSupabaseClient } from "../../supabase_admin/supabase_management_client";
import {
  createLoggedHandler,
  createTestOnlyLoggedHandler,
} from "./safe_handle";
import { handleSupabaseOAuthReturn } from "../../supabase_admin/supabase_return_handler";
import { safeSend } from "../utils/safe_sender";

const logger = log.scope("supabase_handlers");
const handle = createLoggedHandler(logger);
const testOnlyHandle = createTestOnlyLoggedHandler(logger);

export function registerSupabaseHandlers() {
  handle("supabase:list-projects", async () => {
    const supabase = await getSupabaseClient();
    return supabase.getProjects();
  });

  // Set app project - links a Dyad app to a Supabase project
  handle(
    "supabase:set-app-project",
    async (_, { project, app }: { project: string; app: number }) => {
      await db
        .update(apps)
        .set({ supabaseProjectId: project })
        .where(eq(apps.id, app));

      logger.info(`Associated app ${app} with Supabase project ${project}`);
    },
  );

  // Unset app project - removes the link between a Dyad app and a Supabase project
  handle("supabase:unset-app-project", async (_, { app }: { app: number }) => {
    await db
      .update(apps)
      .set({ supabaseProjectId: null })
      .where(eq(apps.id, app));

    logger.info(`Removed Supabase project association for app ${app}`);
  });

  testOnlyHandle(
    "supabase:fake-connect-and-set-project",
    async (
      event,
      { appId, fakeProjectId }: { appId: number; fakeProjectId: string },
    ) => {
      // Call handleSupabaseOAuthReturn with fake data
      handleSupabaseOAuthReturn({
        token: "fake-access-token",
        refreshToken: "fake-refresh-token",
        expiresIn: 3600, // 1 hour
      });
      logger.info(
        `Called handleSupabaseOAuthReturn with fake data for app ${appId} during testing.`,
      );

      // Set the supabase project for the currently selected app
      await db
        .update(apps)
        .set({
          supabaseProjectId: fakeProjectId,
        })
        .where(eq(apps.id, appId));
      logger.info(
        `Set fake Supabase project ${fakeProjectId} for app ${appId} during testing.`,
      );

      // Simulate the deep link event
      safeSend(event.sender, "deep-link-received", {
        type: "supabase-oauth-return",
        url: "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
      });
      logger.info(
        `Sent fake deep-link-received event for app ${appId} during testing.`,
      );
    },
  );
}
