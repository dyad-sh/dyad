import log from "electron-log";
import { eq, isNotNull } from "drizzle-orm";
import { EndpointType } from "@neondatabase/api-client";

import { db } from "../../db";
import { apps } from "../../db/schema";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { getConnectionUri } from "../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readEnvVarsOrEmpty, updateNeonEnvVars } from "./app_env_var_utils";
import { detectFrameworkType } from "./framework_utils";
import { retryOnLocked } from "./retryOnLocked";
import { ensureNeonAuth, getOrCreateNeonAuthCookieSecret } from "./neon_utils";
import { getDyadAppPath } from "@/paths/paths";

const logger = log.scope("neon_test_branch");

type AppRow = typeof apps.$inferSelect;

/** Connection details for an isolated, throwaway Neon test branch. */
export interface TempTestBranch {
  /** The ephemeral branch's id (also persisted on the app row while live). */
  branchId: string;
  /** Connection string pointing at the throwaway branch. */
  databaseUrl: string;
  /** Neon Auth base URL for the branch, when auth could be activated. */
  neonAuthBaseUrl?: string;
  /** Per-branch Neon Auth cookie secret, when available. */
  cookieSecret?: string;
}

/**
 * Resolve the parent branch a test branch should be cut from. We prefer the
 * active branch the user is currently working on so the throwaway branch
 * inherits their realistic schema + data via Neon's instant copy-on-write.
 * This mirrors the canonical `active ?? development` resolution used elsewhere;
 * the preview branch (historical rollback snapshots) is only a last resort.
 */
function resolveParentBranchId(appData: AppRow): string | null {
  return (
    appData.neonActiveBranchId ??
    appData.neonDevelopmentBranchId ??
    appData.neonPreviewBranchId ??
    null
  );
}

/**
 * Whether the app actually uses Neon Auth. Newer rows persist a cookie secret
 * on a branch the first time Neon Auth is provisioned for it (see
 * getOrCreateNeonAuthCookieSecret). Upgraded rows may only have NEON_AUTH_*
 * markers in .env.local, so check those before deciding the test branch can
 * safely skip auth provisioning.
 */
async function appUsesNeonAuth(appData: AppRow): Promise<boolean> {
  if (
    appData.neonDevelopmentAuthCookieSecret ||
    appData.neonProductionAuthCookieSecret
  ) {
    return true;
  }

  try {
    const appPath = getDyadAppPath(appData.path);
    const envVars = await readEnvVarsOrEmpty({ appPath });
    return envVars.some(
      (envVar) =>
        envVar.key === "NEON_AUTH_BASE_URL" ||
        envVar.key === "NEON_AUTH_COOKIE_SECRET",
    );
  } catch (error) {
    logger.warn(
      `Couldn't inspect .env.local for Neon Auth markers on app ${appData.id}: ${error}`,
    );
    return true;
  }
}

function resolveAuthBranchType(
  appData: AppRow,
  branchId: string,
): "development" | "production" {
  return branchId === appData.neonDevelopmentBranchId
    ? "development"
    : "production";
}

/**
 * Create a throwaway copy-on-write Neon branch for an isolated test run.
 *
 * The branch is cut from the app's active branch (or the development/preview
 * branch as a fallback) so it inherits the current schema and data instantly.
 * Neon Auth + a per-branch cookie secret are provisioned best-effort so
 * auth-gated tests can run. The branch id is persisted on the app row
 * (`neonTestBranchId`) so a crash mid-run can be reconciled on next launch.
 *
 * Throws `DyadError` if the app has no Neon project or no parent branch.
 */
export async function createTempTestBranch(
  appData: AppRow,
): Promise<TempTestBranch> {
  const projectId = appData.neonProjectId;
  if (!projectId) {
    throw new DyadError(
      `App ${appData.id} is not connected to a Neon project.`,
      DyadErrorKind.Precondition,
    );
  }

  const parentBranchId = resolveParentBranchId(appData);
  if (!parentBranchId) {
    throw new DyadError(
      `App ${appData.id} has no Neon branch to base a test branch on.`,
      DyadErrorKind.Precondition,
    );
  }

  // If a prior session leaked a branch on this row, delete it before we
  // overwrite the column so we don't orphan it. If that cleanup fails we must
  // NOT proceed: overwriting the column would orphan the prior branch forever
  // (the startup reconciliation sweep relies on the column to find it), while
  // leaving the column untouched would make the branch we're about to create
  // untracked and unrecoverable on a crash. Dead-end instead and let startup
  // reconciliation retry the prior branch on the next launch.
  if (appData.neonTestBranchId) {
    const priorCleanupOk = await deleteBranchBestEffort(
      projectId,
      appData.neonTestBranchId,
    );
    if (!priorCleanupOk) {
      throw new DyadError(
        `Couldn't clean up the previous Neon test branch for app ${appData.id}. Skipping this run to avoid leaking a branch; it will be retried on the next launch.`,
        DyadErrorKind.External,
      );
    }
  }

  const neonClient = await getNeonClient();
  const branchName = `dyad-test-${appData.id}-${Date.now()}`;

  const response = await retryOnLocked(
    () =>
      neonClient.createProjectBranch(projectId, {
        endpoints: [{ type: EndpointType.ReadWrite }],
        branch: {
          name: branchName,
          parent_id: parentBranchId,
        },
      }),
    `Create test branch for app ${appData.id}`,
  );

  const branch = response.data.branch;
  const connectionUri = response.data.connection_uris?.[0]?.connection_uri;
  if (!branch || !connectionUri) {
    throw new DyadError(
      "Neon did not return a connection string for the test branch.",
      DyadErrorKind.External,
    );
  }

  // Persist the in-flight branch id so a crash before teardown is recoverable
  // by the startup reconciliation sweep. If this write fails (e.g. a transient
  // SQLite lock), neither teardown nor reconciliation can find the branch to
  // delete it, so remove the branch we just created before rethrowing rather
  // than leaking it.
  try {
    await db
      .update(apps)
      .set({ neonTestBranchId: branch.id })
      .where(eq(apps.id, appData.id));
  } catch (error) {
    await deleteBranchBestEffort(projectId, branch.id);
    throw error;
  }

  // Provision Neon Auth on the throwaway branch best-effort. Auth-gated tests
  // need it; non-auth tests still run if this fails.
  //
  // Skip provisioning entirely when the app never set up Neon Auth (no cookie
  // secret persisted on either branch, and no NEON_AUTH_* markers in env).
  // This avoids 1-3 extra Neon API calls per test run for non-auth apps - the
  // main driver of "too many requests" when running several tests back-to-back.
  let neonAuthBaseUrl: string | undefined;
  let cookieSecret: string | undefined;
  if (await appUsesNeonAuth(appData)) {
    try {
      // Wrap in retryOnLocked so getNeonAuth/createNeonAuth back off on a
      // locked branch (423) or rate limit (429) instead of failing the run.
      neonAuthBaseUrl = await retryOnLocked(
        () => ensureNeonAuth({ projectId, branchId: branch.id }),
        `Ensure Neon Auth for test branch ${branch.id}`,
      );
      if (neonAuthBaseUrl) {
        // The test branch mirrors the development branch's auth config.
        cookieSecret = await getOrCreateNeonAuthCookieSecret({
          appData,
          branchType: "development",
        });
      }
    } catch (error) {
      logger.warn(
        `Neon Auth could not be activated on test branch ${branch.id} for app ${appData.id}: ${error}`,
      );
    }

    // The app relies on Neon Auth but we couldn't provision it on the throwaway
    // branch. Proceeding would point the app's database at the isolated test
    // branch while its auth still targets the REAL auth branch (updateNeonEnvVars
    // preserves the existing NEON_AUTH_* vars when we pass no test auth URL) —
    // sign-up/login in the test would then hit real auth data. Dead-end instead:
    // delete the branch we just created and clear the column (it points at this
    // now-deleted branch), then throw so the caller restores and never runs.
    if (!neonAuthBaseUrl) {
      const deleted = await deleteBranchBestEffort(projectId, branch.id);
      // Clear the column when the delete succeeded so reconciliation doesn't
      // later try to re-delete a branch that's already gone. If the delete
      // failed, leave the column set so startup reconciliation retries it.
      if (deleted) {
        await db
          .update(apps)
          .set({ neonTestBranchId: null })
          .where(eq(apps.id, appData.id));
      }
      throw new DyadError(
        "Couldn't set up isolated Neon Auth for the test branch.",
        DyadErrorKind.External,
      );
    }
  }

  logger.info(
    `Created test branch ${branch.id} (parent ${parentBranchId}) for app ${appData.id}`,
  );

  return {
    branchId: branch.id,
    databaseUrl: connectionUri,
    neonAuthBaseUrl,
    cookieSecret,
  };
}

/**
 * Tear down the test branch for an app: best-effort delete on Neon and clear
 * the persisted `neonTestBranchId`. Safe to call when no branch is set.
 */
export async function deleteTempTestBranch(appData: AppRow): Promise<void> {
  const branchId = appData.neonTestBranchId;
  const projectId = appData.neonProjectId;
  if (!branchId || !projectId) {
    return;
  }
  // Only forget the branch once Neon confirms it's gone. Clearing the column on
  // a failed delete would orphan the branch in the user's account forever, since
  // the startup reconciliation sweep relies on this id to find it again.
  const deleted = await deleteBranchBestEffort(projectId, branchId);
  if (deleted) {
    await db
      .update(apps)
      .set({ neonTestBranchId: null })
      .where(eq(apps.id, appData.id));
  }
}

async function deleteBranchBestEffort(
  projectId: string,
  branchId: string,
): Promise<boolean> {
  try {
    const neonClient = await getNeonClient();
    await retryOnLocked(
      () => neonClient.deleteProjectBranch(projectId, branchId),
      `Delete test branch ${branchId}`,
    );
    logger.info(`Deleted test branch ${branchId} for project ${projectId}`);
    return true;
  } catch (error) {
    logger.warn(
      `Failed to delete test branch ${branchId} for project ${projectId} (will be retried on next launch if still tracked): ${error}`,
    );
    return false;
  }
}

async function restoreRealBranchEnvVars(appData: AppRow): Promise<boolean> {
  const projectId = appData.neonProjectId;
  const branchId = resolveParentBranchId(appData);
  if (!projectId || !branchId) {
    logger.warn(
      `Cannot restore .env.local for app ${appData.id} before deleting test branch: missing Neon project or real branch.`,
    );
    return false;
  }

  try {
    const appPath = getDyadAppPath(appData.path);
    const frameworkType = detectFrameworkType(appPath);
    const connectionUri = await retryOnLocked(
      () => getConnectionUri({ projectId, branchId }),
      `Restore Neon env for app ${appData.id}`,
    );

    let neonAuthBaseUrl: string | undefined;
    let cookieSecret: string | undefined;
    if (await appUsesNeonAuth(appData)) {
      neonAuthBaseUrl = await retryOnLocked(
        () => ensureNeonAuth({ projectId, branchId }),
        `Restore Neon Auth env for app ${appData.id}`,
      );
      if (!neonAuthBaseUrl) {
        throw new Error(
          "Neon Auth could not be resolved for the app's real branch.",
        );
      }
      if (frameworkType === "nextjs") {
        cookieSecret = await getOrCreateNeonAuthCookieSecret({
          appData,
          branchType: resolveAuthBranchType(appData, branchId),
        });
      }
    }

    await updateNeonEnvVars({
      appPath,
      connectionUri,
      neonAuthBaseUrl,
      frameworkType,
      cookieSecret,
      preserveExistingAuth: false,
    });
    return true;
  } catch (error) {
    logger.warn(
      `Failed to restore .env.local for app ${appData.id} before deleting test branch ${appData.neonTestBranchId}; leaving the branch tracked for retry: ${error}`,
    );
    return false;
  }
}

/**
 * Startup reconciliation: any app row still carrying a `neonTestBranchId` means
 * a previous session crashed mid-run and leaked a copy-on-write branch. Delete
 * the orphans best-effort and clear the column. Never throws — a failure here
 * must not block app startup.
 */
export async function reconcileOrphanTestBranches(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(apps)
      .where(isNotNull(apps.neonTestBranchId));
    if (rows.length === 0) {
      return;
    }
    logger.info(
      `Reconciling ${rows.length} orphaned Neon test branch(es) from a previous session`,
    );
    for (const appData of rows) {
      const restored = await restoreRealBranchEnvVars(appData);
      if (!restored) {
        continue;
      }
      await deleteTempTestBranch(appData);
    }
  } catch (error) {
    logger.error(`Failed to reconcile orphaned test branches: ${error}`);
  }
}
