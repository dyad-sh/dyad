import log from "electron-log";
import { eq } from "drizzle-orm";
import { NeonAuthSupportedAuthProvider } from "@neondatabase/api-client";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { getConnectionUri } from "../../neon_admin/neon_context";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  generateCookieSecret,
  readEnvVarsOrEmpty,
  updateNeonEnvVars,
} from "../utils/app_env_var_utils";
import { detectFrameworkType } from "./framework_utils";
import { getDyadAppPath } from "@/paths/paths";

export type NeonBranchType = "production" | "development";

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

function getNeonAuthCookieSecretColumn(branchType: NeonBranchType) {
  return branchType === "production"
    ? "neonProductionAuthCookieSecret"
    : "neonDevelopmentAuthCookieSecret";
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
 * Resolves the Neon Auth cookie secret for a given app + branch type.
 * The DB is the source of truth (one column per branch). When the column
 * is null, falls back to adopting an existing .env.local value if the
 * queried branch is currently active (back-compat for users upgrading
 * from the old regenerate-on-switch behavior), otherwise generates a
 * fresh secret. The resolved value is persisted into the column, so the
 * column is monotonic per branch.
 */
export async function getOrCreateNeonAuthCookieSecret({
  appData,
  branchType,
}: {
  appData: AppRow;
  branchType: NeonBranchType;
}): Promise<string> {
  const column = getNeonAuthCookieSecretColumn(branchType);

  const persisted = appData[column];
  if (persisted) return persisted;

  let adopted: string | undefined;
  if (isBranchActive(appData, branchType)) {
    const envVars = await readEnvVarsOrEmpty({ appPath: appData.path });
    adopted = envVars.find((v) => v.key === "NEON_AUTH_COOKIE_SECRET")?.value;
  }

  const secret = adopted ?? generateCookieSecret();

  await db
    .update(apps)
    .set({ [column]: secret })
    .where(eq(apps.id, appData.id));

  return secret;
}

/**
 * Before switching branches, persist the active branch's actual .env.local
 * cookie secret into DB. The env file is the current runtime source of truth
 * for the outgoing branch, including apps created before per-branch secret
 * columns existed or rows that were already populated by an older buggy build.
 */
export async function syncActiveNeonAuthCookieSecretFromEnv({
  appData,
  branchType,
}: {
  appData: AppRow;
  branchType: NeonBranchType;
}): Promise<string | undefined> {
  if (!isBranchActive(appData, branchType)) return undefined;

  const envVars = await readEnvVarsOrEmpty({ appPath: appData.path });
  const secret = envVars.find(
    (v) => v.key === "NEON_AUTH_COOKIE_SECRET",
  )?.value;
  if (!secret) return undefined;

  const column = getNeonAuthCookieSecretColumn(branchType);
  if (appData[column] === secret) return secret;

  await db
    .update(apps)
    .set({ [column]: secret })
    .where(eq(apps.id, appData.id));

  return secret;
}

function isBranchActive(appData: AppRow, branchType: NeonBranchType): boolean {
  // Legacy rows may not have neonActiveBranchId populated. In those cases the
  // development branch is still the effective active branch throughout Neon code.
  const activeId =
    appData.neonActiveBranchId ?? appData.neonDevelopmentBranchId;
  if (!activeId) return false;
  if (branchType === "development") {
    return appData.neonDevelopmentBranchId === activeId;
  }
  // production = active is neither the dev branch nor the preview branch
  if (activeId === appData.neonDevelopmentBranchId) return false;
  if (activeId === appData.neonPreviewBranchId) return false;
  return true;
}

/**
 * Auto-injects Neon environment variables into the app's .env.local.
 * Always writes DATABASE_URL/POSTGRES_URL. Returns a warning message
 * if Neon Auth activation fails.
 */
export async function autoInjectNeonEnvVars({
  appId,
  appPath,
  projectId,
  branchId,
  branchType,
}: {
  appId: number;
  appPath: string;
  projectId: string;
  branchId: string;
  branchType: NeonBranchType;
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

  // Resolve per-branch cookie secret from DB (or generate / adopt once).
  // Re-SELECT so we see any updates the caller made (e.g. setActiveBranch
  // flipping neonActiveBranchId, or this same helper having just persisted
  // a secret in a prior call within the request).
  let cookieSecret: string | undefined;
  if (neonAuthBaseUrl) {
    const rows = await db
      .select()
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);
    if (rows.length === 0) {
      throw new DyadError(
        `App with ID ${appId} not found`,
        DyadErrorKind.NotFound,
      );
    }
    cookieSecret = await getOrCreateNeonAuthCookieSecret({
      appData: rows[0],
      branchType,
    });
  }

  // Always write env vars (DATABASE_URL, POSTGRES_URL, and auth URL if available).
  // When auth activation failed transiently, preserve existing auth vars so a
  // previously working setup isn't wiped by a temporary Neon API failure.
  await updateNeonEnvVars({
    appPath,
    connectionUri,
    neonAuthBaseUrl,
    frameworkType: detectFrameworkType(getDyadAppPath(appPath)),
    cookieSecret,
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

/**
 * Resolves the production (default) branch ID for a Neon project.
 * Lives here (not migration_utils) so it can be shared by env-var resolution
 * without a circular import.
 */
export async function getProductionBranchId(
  projectId: string,
): Promise<{ branchId: string; updatedAt: string }> {
  const neonClient = await getNeonClient();
  const response = await neonClient.listProjectBranches({ projectId });

  if (!response.data.branches) {
    throw new DyadError(
      "Failed to list branches: No branch data returned.",
      DyadErrorKind.External,
    );
  }

  const prodBranch = response.data.branches.find((b) => b.default);
  if (!prodBranch) {
    throw new DyadError(
      "No production (default) branch found for this Neon project.",
      DyadErrorKind.Precondition,
    );
  }

  return { branchId: prodBranch.id, updatedAt: prodBranch.updated_at };
}

/**
 * The branch the unified database section is set to deploy/sync against.
 * Null (e.g. the user never opened the section, or before first deploy) is
 * treated as production.
 */
export function getSelectedDeployBranchType(appData: AppRow): NeonBranchType {
  return appData.selectedDatabaseBranchType === "development"
    ? "development"
    : "production";
}

export interface ResolvedNeonBranchEnvVars {
  databaseUrl: string;
  neonAuthBaseUrl?: string;
  neonAuthCookieSecret?: string;
  branchId: string;
  isNextJs: boolean;
}

/**
 * Resolves the Neon env vars (connection URI + auth) for an app's branch.
 * Shared by the `getBranchEnvVars` IPC handler (which renders them in the UI)
 * and the Vercel sync (which pushes them). Tolerant of Neon Auth being
 * inactive on the branch — returns only `databaseUrl` in that case.
 *
 * `branchId` and `isNextJs` are returned so callers (e.g. trusted-domain sync)
 * can reuse the resolved branch and framework without re-resolving.
 */
export async function resolveNeonBranchEnvVars({
  appData,
  branchType,
}: {
  appData: AppRow;
  branchType: NeonBranchType;
}): Promise<ResolvedNeonBranchEnvVars> {
  if (!appData.neonProjectId) {
    throw new DyadError(
      "This app is not connected to a Neon project.",
      DyadErrorKind.Precondition,
    );
  }
  const projectId = appData.neonProjectId;

  let branchId: string;
  if (branchType === "production") {
    branchId = (await getProductionBranchId(projectId)).branchId;
  } else {
    if (!appData.neonDevelopmentBranchId) {
      throw new DyadError(
        "This app has no development branch. Create one in Neon before requesting a development connection URI.",
        DyadErrorKind.Precondition,
      );
    }
    branchId = appData.neonDevelopmentBranchId;
  }

  const databaseUrl = await getConnectionUri({ projectId, branchId });

  // Provision-on-view: ensure Neon Auth is active and, for Next.js apps, that a
  // per-branch cookie secret exists. Tolerant of failure so a transient Neon
  // outage still yields DATABASE_URL.
  let neonAuthBaseUrl: string | undefined;
  try {
    neonAuthBaseUrl = await ensureNeonAuth({ projectId, branchId });
  } catch {
    neonAuthBaseUrl = undefined;
  }

  const isNextJs =
    detectFrameworkType(getDyadAppPath(appData.path)) === "nextjs";

  let neonAuthCookieSecret: string | undefined;
  if (neonAuthBaseUrl && isNextJs) {
    neonAuthCookieSecret = await getOrCreateNeonAuthCookieSecret({
      appData,
      branchType,
    });
  }

  return {
    databaseUrl,
    neonAuthBaseUrl,
    neonAuthCookieSecret,
    branchId,
    isNextJs,
  };
}
