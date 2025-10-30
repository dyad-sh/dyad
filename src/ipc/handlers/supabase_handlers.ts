import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { apps } from "../../db/schema";
import {
  getSupabaseClient,
  listSupabaseBranches,
} from "../../supabase_admin/supabase_management_client";
import {
  createLoggedHandler,
  createTestOnlyLoggedHandler,
} from "./safe_handle";
import { handleSupabaseOAuthReturn } from "../../supabase_admin/supabase_return_handler";
import { safeSend } from "../utils/safe_sender";

import { SetSupabaseAppProjectParams, SupabaseBranch } from "../ipc_types";
import { getDyadAppPath } from "../../paths/paths";

const logger = log.scope("supabase_handlers");
const handle = createLoggedHandler(logger);
const testOnlyHandle = createTestOnlyLoggedHandler(logger);
const fsPromises = fs.promises;

const SHARED_README_TEMPLATE = [
  "# Supabase Shared Modules",
  "",
  "Store reusable utilities for Supabase Edge Functions in this directory. Each file should export logic that can be imported from individual functions within `supabase/functions`.",
  "",
  "Import helpers from functions using relative paths, for example:",
  "",
  "```ts",
  'import { exampleHelper } from "../shared/exampleHelper.ts";',
  "```",
  "",
  "Avoid importing client-side application code into shared modules. Everything in this directory must be compatible with the Deno runtime used by Supabase Edge Functions.",
  "",
].join("\n");

export function registerSupabaseHandlers() {
  handle("supabase:list-projects", async () => {
    const supabase = await getSupabaseClient();
    return supabase.getProjects();
  });

  // List branches for a Supabase project (database branches)
  handle(
    "supabase:list-branches",
    async (
      _,
      { projectId }: { projectId: string },
    ): Promise<Array<SupabaseBranch>> => {
      const branches = await listSupabaseBranches({
        supabaseProjectId: projectId,
      });
      return branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        isDefault: branch.is_default,
        projectRef: branch.project_ref,
        parentProjectRef: branch.parent_project_ref,
      }));
    },
  );

  // Set app project - links a Dyad app to a Supabase project
  handle(
    "supabase:set-app-project",
    async (
      _,
      { projectId, appId, parentProjectId }: SetSupabaseAppProjectParams,
    ) => {
      const appRecord = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });
      await db
        .update(apps)
        .set({
          supabaseProjectId: projectId,
          supabaseParentProjectId: parentProjectId,
        })
        .where(eq(apps.id, appId));

      logger.info(
        `Associated app ${appId} with Supabase project ${projectId} ${parentProjectId ? `and parent project ${parentProjectId}` : ""}`,
      );

      if (appRecord) {
        await ensureSupabaseSharedDirectory(appRecord.path);
      }
    },
  );

  // Unset app project - removes the link between a Dyad app and a Supabase project
  handle("supabase:unset-app-project", async (_, { app }: { app: number }) => {
    await db
      .update(apps)
      .set({ supabaseProjectId: null, supabaseParentProjectId: null })
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

      const appRecord = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });
      if (appRecord) {
        await ensureSupabaseSharedDirectory(appRecord.path);
      }

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

async function ensureSupabaseSharedDirectory(appPathValue: string) {
  const appDirectory = getDyadAppPath(appPathValue);
  const sharedDirectory = path.join(appDirectory, "supabase", "shared");

  try {
    await fsPromises.mkdir(sharedDirectory, { recursive: true });
  } catch (error) {
    logger.warn(
      `Failed to ensure Supabase shared directory at ${sharedDirectory}:`,
      error,
    );
    return;
  }

  const readmePath = path.join(sharedDirectory, "README.md");
  try {
    await fsPromises.access(readmePath);
  } catch {
    try {
      await fsPromises.writeFile(readmePath, SHARED_README_TEMPLATE, "utf8");
    } catch (writeError) {
      logger.warn(
        `Failed to write Supabase shared README at ${readmePath}:`,
        writeError,
      );
    }
  }
}
