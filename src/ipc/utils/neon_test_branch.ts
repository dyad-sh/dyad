import log from "electron-log";
import { eq, isNotNull } from "drizzle-orm";
import { EndpointType } from "@neondatabase/api-client";

import { db } from "../../db";
import { apps } from "../../db/schema";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { retryOnLocked } from "./retryOnLocked";
import { ensureNeonAuth, getOrCreateNeonAuthCookieSecret } from "./neon_utils";

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

  // Best-effort: if a prior session leaked a branch on this row, delete it
  // before we overwrite the column so we don't orphan it.
  if (appData.neonTestBranchId) {
    await deleteBranchBestEffort(projectId, appData.neonTestBranchId);
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

  // Persist the in-flight branch id immediately so a crash before teardown is
  // recoverable by the startup reconciliation sweep.
  await db
    .update(apps)
    .set({ neonTestBranchId: branch.id })
    .where(eq(apps.id, appData.id));

  // Provision Neon Auth on the throwaway branch best-effort. Auth-gated tests
  // need it; non-auth tests still run if this fails.
  let neonAuthBaseUrl: string | undefined;
  let cookieSecret: string | undefined;
  try {
    neonAuthBaseUrl = await ensureNeonAuth({
      projectId,
      branchId: branch.id,
    });
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
      await deleteTempTestBranch(appData);
    }
  } catch (error) {
    logger.error(`Failed to reconcile orphaned test branches: ${error}`);
  }
}
