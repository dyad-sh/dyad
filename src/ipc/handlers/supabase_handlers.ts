import { ipcMain } from "electron";
import log from "electron-log";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { apps } from "../../db/schema";
import { getSupabaseClient } from "../../supabase_admin/supabase_management_client";

const logger = log.scope("supabase_handlers");

export function registerSupabaseHandlers() {
  // List all Supabase projects
  ipcMain.handle("supabase:list-projects", async () => {
    try {
      const supabase = await getSupabaseClient();
      // Call the API according to supabase-management-js structure
      const projects = await supabase.getProjects();
      return projects;
    } catch (error) {
      logger.error("Error listing Supabase projects:", error);
      throw error;
    }
  });

  // Set app project - links a Dyad app to a Supabase project
  ipcMain.handle(
    "supabase:set-app-project",
    async (_, { project, app }: { project: string; app: number }) => {
      try {
        // Here you could store the project-app association in your database
        // For example:
        await db
          .update(apps)
          .set({ supabaseProjectId: project })
          .where(eq(apps.id, app));

        logger.info(`Associated app ${app} with Supabase project ${project}`);
        return { success: true, appId: app, projectId: project };
      } catch (error) {
        logger.error("Error setting Supabase project for app:", error);
        throw error;
      }
    },
  );

  // Unset app project - removes the link between a Dyad app and a Supabase project
  ipcMain.handle(
    "supabase:unset-app-project",
    async (_, { app }: { app: number }) => {
      try {
        await db
          .update(apps)
          .set({ supabaseProjectId: null })
          .where(eq(apps.id, app));

        logger.info(`Removed Supabase project association for app ${app}`);
        return { success: true, appId: app };
      } catch (error) {
        logger.error("Error unsetting Supabase project for app:", error);
        throw error;
      }
    },
  );
}
