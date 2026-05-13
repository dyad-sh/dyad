import log from "electron-log";
import { eq } from "drizzle-orm";
import { NeonAuthSupportedAuthProvider } from "@neondatabase/api-client";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { getConnectionUri } from "../../neon_admin/neon_context";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { updateNeonEnvVars } from "../utils/app_env_var_utils";

export const logger = log.scope("neon_utils");

type AppRow = typeof apps.$inferSelect;

export function combineWarnings(
  ...warnings: Array<string | undefined>
): string | undefined {
  const filteredWarnings = warnings.filter((warning): warning is string =>
    Boolean(warning),
  );

  return filteredWarnings.length > 0 ? filteredWarnings.join(" ") : undefined;
}

export function buildNeonAuthActivationWarning(branchName: string): string {
  return `Neon Auth could not be fully activated for the ${branchName} branch.`;
}

/**
 * Fetches an app record and resolves the active Neon branch ID.
 * Throws if the app is not found, has no Neon project, or has no branch.
 */
export async function getAppWithNeonBranch(appId: number): Promise<{
  appData: AppRow;
  branchId: string;
}> {
  const app = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);

  if (app.length === 0) {
    throw new DyadError(
      `App with ID ${appId} not found`,
      DyadErrorKind.NotFound,
    );
  }

  const appData = app[0];
  if (!appData.neonProjectId) {
    throw new DyadError(
      `No Neon project found for app ${appId}`,
      DyadErrorKind.Precondition,
    );
  }

  const branchId =
    appData.neonActiveBranchId ?? appData.neonDevelopmentBranchId;
  if (!branchId) {
    throw new DyadError(
      `No active Neon branch found for app ${appId}`,
      DyadErrorKind.Precondition,
    );
  }

  return { appData, branchId };
}

/**
 * Checks if Neon Auth is enabled on the given branch, and enables it if not.
 * Returns the auth base URL from the API. Throws on failure.
 */
export async function ensureNeonAuth({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}): Promise<string | undefined> {
  const neonClient = await getNeonClient();

  // Check if Neon Auth is already enabled on this branch
  try {
    const response = await neonClient.getNeonAuth(projectId, branchId);
    return response.data.base_url;
  } catch (error: any) {
    // 404 means auth not enabled — proceed to create
    if (error.response?.status !== 404) throw error;
  }

  // Enable Neon Auth on this branch
  try {
    const createResponse = await neonClient.createNeonAuth(
      projectId,
      branchId,
      {
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
      },
    );
    return createResponse.data.base_url;
  } catch (createError: any) {
    // 409 means the neon_auth schema already exists (inherited from parent branch).
    // Try fetching the auth config again since it may now be available.
    if (createError.response?.status === 409) {
      try {
        const retryResponse = await neonClient.getNeonAuth(projectId, branchId);
        return retryResponse.data.base_url;
      } catch (retryError: any) {
        // Auth schema exists but isn't formally enabled — log warning and return undefined
        const message =
          retryError instanceof Error ? retryError.message : String(retryError);
        logger.warn(
          `Neon Auth schema conflict (409) on branch ${branchId}, and retry fetch also failed: ${message}`,
        );
        return undefined;
      }
    }
    throw createError;
  }
}

/**
 * Auto-injects Neon environment variables into the app's .env.local.
 * Always writes DATABASE_URL/POSTGRES_URL. Returns a warning message
 * if Neon Auth activation fails.
 */
export async function autoInjectNeonEnvVars({
  appPath,
  projectId,
  branchId,
}: {
  appPath: string;
  projectId: string;
  branchId: string;
}): Promise<string | undefined> {
  const connectionUri = await getConnectionUri({ projectId, branchId });
  // Attempt to ensure Neon Auth is active; capture any error as a warning
  let neonAuthBaseUrl: string | undefined;
  let warning: string | undefined;
  try {
    neonAuthBaseUrl = await ensureNeonAuth({ projectId, branchId });
    if (!neonAuthBaseUrl) {
      warning =
        "Neon Auth could not be fully activated for the active branch. DATABASE_URL was updated, but NEON_AUTH_BASE_URL was not added to .env.local.";
    }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    warning = `Failed to activate Neon Auth: ${message}`;
  }

  // Always write env vars (DATABASE_URL, POSTGRES_URL, and auth URL if available).
  // When auth activation failed transiently, preserve existing auth vars so a
  // previously working setup isn't wiped by a temporary Neon API failure.
  await updateNeonEnvVars({
    appPath,
    connectionUri,
    neonAuthBaseUrl,
    preserveExistingAuth: !neonAuthBaseUrl,
  });

  return warning;
}

/**
 * Guard: prevent connecting both Supabase and Neon on the same app.
 * Throws if the app already has a Supabase project linked.
 */
export async function assertNoSupabaseProject(appId: number): Promise<void> {
  const existingApp = await db
    .select({ supabaseProjectId: apps.supabaseProjectId })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);
  if (existingApp[0]?.supabaseProjectId) {
    throw new DyadError(
      "Cannot connect Neon: this app already has a Supabase project. Disconnect Supabase first.",
      DyadErrorKind.Precondition,
    );
  }
}

/**
 * Guard: prevent connecting both Neon and Supabase on the same app.
 * Throws if the app already has a Neon project linked.
 */
export async function assertNoNeonProject(appId: number): Promise<void> {
  const existingApp = await db
    .select({ neonProjectId: apps.neonProjectId })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);
  if (existingApp[0]?.neonProjectId) {
    throw new DyadError(
      "This app already has a Neon project linked. Disconnect it first.",
      DyadErrorKind.Precondition,
    );
  }
}
