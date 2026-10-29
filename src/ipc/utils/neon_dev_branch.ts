import fs from "node:fs/promises";

import type {
  Api,
  Branch,
  NeonAuthOauthProvider,
} from "@neondatabase/api-client";
import {
  EndpointType,
  NeonAuthSupportedAuthProvider,
} from "@neondatabase/api-client";
import { eq, inArray } from "drizzle-orm";
import log from "electron-log";

import { db } from "../../db";
import { apps, versions } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  getNeonClient,
  getNeonErrorMessage,
  invalidateEmailPasswordConfigCache,
  isBranchLimitError,
} from "../../neon_admin/neon_management_client";
import { getConnectionUri } from "../../neon_admin/neon_context";
import { retryOnLocked } from "./retryOnLocked";
import {
  copyBranchData,
  exportBranchDataAsSql,
  findMigrationBlockers,
  listForeignKeys,
  prepareSchemaOnlyBranchForNeonAuth,
} from "./neon_branch_data";
import { autoInjectNeonEnvVars, ensureNeonAuth } from "./neon_utils";
import { getEnvFilePath, readEnvFileIfExists } from "./app_env_var_utils";
import { sendTelemetryEvent } from "./telemetry";

const logger = log.scope("neon_dev_branch");

/*
 * Why the development branch must be a root branch (dyad-sh/dyad#4943).
 *
 * Reverting restores the development branch in place to an earlier timestamp,
 * and Neon keeps the pre-restore state as a backup branch. Verified against the
 * live Neon API:
 *
 * - Child branch (how Dyad used to create development, under `main`): the
 *   restored branch becomes a child of the backup, and the branch's existing
 *   children (preview, test branches) move under the backup too. Neon refuses
 *   to delete a branch with children (422), so every revert leaks a backup and
 *   the chain grows until the project hits its branch limit.
 * - Root branch: the backup becomes an independent root branch, children stay
 *   on the restored branch, and the restored branch keeps its full history for
 *   later restores. For a few seconds after the restore, though, the restored
 *   branch is still a child of the backup until Neon detaches it in the
 *   background, so the backup can only be deleted after that.
 *
 * Root branches with data can only be made as schema-only branches plus a data
 * copy. Existing child development branches are migrated when the user
 * chooses to, from a banner above the preview: the copy has side effects
 * (earlier versions lose their database restore points, Neon Auth gets new
 * signing keys) that a revert should not spring on them.
 */

// Branches Dyad creates, recognisable by name.
const BACKUP_BRANCH_PATTERN = /^preserve_[0-9a-f]+-\d+$/;
const TEST_BRANCH_PATTERN = /^dyad-test-\d+-\d+$/;
/** A migration's temporary copy of the data to keep. */
const MIGRATION_SOURCE_PATTERN = /^dyad-restore-source-\d+$/;
/** A migration's new development branch, until it takes over the name. */
const MIGRATING_PATTERN = /^dyad-migrating-\d+$/;
/** An old development branch a migration replaced. */
const REPLACED_PATTERN = /-replaced-\d+$/;

/** How long to wait for Neon to detach a restored root branch. Tests shorten it. */
export const detachWait = { pollIntervalMs: 1_000, timeoutMs: 120_000 };

export function backupBranchName(commitHash: string): string {
  return `preserve_${commitHash}-${Date.now()}`;
}

async function listBranches(
  neonClient: Api<unknown>,
  projectId: string,
): Promise<Branch[]> {
  const response = await retryOnLocked(
    () => neonClient.listProjectBranches({ projectId }),
    `List branches for project ${projectId}`,
  );
  return response.data.branches ?? [];
}

function childrenOf(branches: Branch[], branchId: string): Branch[] {
  return branches.filter((b) => b.parent_id === branchId);
}

async function deleteBranch(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  label: string,
): Promise<boolean> {
  try {
    await retryOnLocked(
      () => neonClient.deleteProjectBranch(projectId, branchId),
      `Delete ${label} ${branchId}`,
    );
    return true;
  } catch (error) {
    logger.warn(
      `Failed to delete ${label} ${branchId}: ${getNeonErrorMessage(error)}`,
    );
    return false;
  }
}

/**
 * Creates a schema-only root branch. It has the source's schema but no data
 * and no parent, so restores of it leave deletable backups.
 */
export async function createRootBranch({
  projectId,
  sourceBranchId,
  name,
  sourceTimestamp,
}: {
  projectId: string;
  sourceBranchId: string;
  name: string;
  sourceTimestamp?: string;
}): Promise<{ branch: Branch; connectionUri: string }> {
  const neonClient = await getNeonClient();
  const response = await retryOnLocked(
    () =>
      neonClient.createProjectBranch(projectId, {
        endpoints: [{ type: EndpointType.ReadWrite }],
        branch: {
          name,
          parent_id: sourceBranchId,
          init_source: "schema-only",
          ...(sourceTimestamp ? { parent_timestamp: sourceTimestamp } : {}),
        },
      }),
    `Create root branch ${name} for project ${projectId}`,
  );
  const branch = response.data.branch;
  const connectionUri = response.data.connection_uris?.[0]?.connection_uri;
  if (!branch || !connectionUri) {
    if (branch) {
      await deleteBranch(neonClient, projectId, branch.id, "root branch");
    }
    throw new DyadError(
      `Failed to create branch ${name}: no branch data returned.`,
      DyadErrorKind.External,
    );
  }
  return { branch, connectionUri };
}

/**
 * Waits for Neon to detach a just-restored root branch from its backup (see
 * the comment at the top of this file).
 */
async function waitForRootBranchDetached(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<boolean> {
  const deadline = Date.now() + detachWait.timeoutMs;
  for (;;) {
    const { data } = await retryOnLocked(
      () => neonClient.getProjectBranch(projectId, branchId),
      `Get branch ${branchId}`,
    );
    if (!data.branch.parent_id) return true;
    if (Date.now() >= deadline) {
      logger.warn(
        `Branch ${branchId} is still attached to its backup after ${detachWait.timeoutMs}ms; leaving the backup for the next revert to delete`,
      );
      return false;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, detachWait.pollIntervalMs),
    );
  }
}

/**
 * Deletes branches a restore or migration left behind: backups, replaced
 * development branches, and a migration's temporary branches. Only branches
 * without children go, so the sweep works up a leftover chain leaf by leaf and
 * never touches anything a branch still depends on. Best-effort.
 */
async function sweepLeftoverBranches(
  neonClient: Api<unknown>,
  projectId: string,
): Promise<void> {
  // Names alone can't tell a leftover from a branch an app still uses: a
  // migration interrupted after renaming the old development branch leaves
  // the app on `*-replaced-*`.
  const inUse = await branchesInUse(projectId);
  const failed = new Set<string>();
  for (;;) {
    const branches = await listBranches(neonClient, projectId);
    const leftovers = branches.filter(
      (b) =>
        !failed.has(b.id) &&
        !inUse.has(b.id) &&
        childrenOf(branches, b.id).length === 0 &&
        (BACKUP_BRANCH_PATTERN.test(b.name) ||
          REPLACED_PATTERN.test(b.name) ||
          MIGRATION_SOURCE_PATTERN.test(b.name) ||
          MIGRATING_PATTERN.test(b.name)),
    );
    if (leftovers.length === 0) return;
    for (const branch of leftovers) {
      if (
        !(await deleteBranch(
          neonClient,
          projectId,
          branch.id,
          "leftover branch",
        ))
      ) {
        failed.add(branch.id);
      }
    }
  }
}

/** Branches any Dyad app in the project uses; a sweep never deletes them. */
async function branchesInUse(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      development: apps.neonDevelopmentBranchId,
      preview: apps.neonPreviewBranchId,
      active: apps.neonActiveBranchId,
    })
    .from(apps)
    .where(eq(apps.neonProjectId, projectId));
  return new Set(
    rows
      .flatMap((r) => [r.development, r.preview, r.active])
      .filter((id): id is string => !!id),
  );
}

/** How a retry dealt with a migration that was interrupted (crash or quit). */
export type MigrationRepair = "none" | "rolled-back" | "rolled-forward";

/** The endpoint an app's .env.local database URL points at, if any. */
async function envEndpointId(appPath: string): Promise<string | null> {
  const env = (await readEnvFileIfExists({ appPath })) ?? "";
  const url = env.match(/^(?:DATABASE_URL|POSTGRES_URL)=["']?([^"'\s]+)/m)?.[1];
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

async function branchEndpointIds(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<Set<string>> {
  const { data } = await retryOnLocked(
    () => neonClient.listProjectBranchEndpoints(projectId, branchId),
    `List endpoints of branch ${branchId}`,
  );
  return new Set(data.endpoints.map((e) => e.id));
}

const CLOCK_SKEW_MS = 60 * 60_000;

/**
 * Whether `branch` is the new development branch of the migration that
 * renamed the old one at `stamp`: a schema-only root branch no app uses,
 * created during that migration. Anything else is left alone.
 *
 * `stamp` comes from the local clock and the creation time from Neon's, so
 * the window allows for a computer clock that runs fast. It ends a day later
 * because the branch is only created after the backup, which can take a
 * while for a large database.
 */
function isUnfinishedMigrationBranch(
  branch: Branch,
  stamp: number,
  inUse: Set<string>,
): boolean {
  const createdAt = Date.parse(branch.created_at);
  return (
    !branch.parent_id &&
    branch.init_source === "parent-schema" &&
    !inUse.has(branch.id) &&
    createdAt >= stamp - CLOCK_SKEW_MS &&
    createdAt <= stamp + 24 * 60 * 60_000
  );
}

/**
 * Finishes or undoes a migration interrupted (a crash or quit, so its
 * rollback never ran) between renaming the old development branch to
 * `*-replaced-<stamp>` and switching the apps. The apps' rows still point at
 * the old branch; which way to go depends on where their .env.local points:
 *
 * - None at the new branch: nothing has written to it since the copy. Delete
 *   it and give the old branch its name back; the migration then runs anew.
 * - All at the new branch: the apps have been writing to it, and it holds the
 *   complete copy (it only takes the development name once the copy is
 *   verified). Finish the migration with it.
 * - Some at each: data went to both. Refuse rather than lose either.
 *
 * Each step leaves a state a later attempt recognises, so a crash during the
 * repair is handled too.
 */
async function repairInterruptedMigration({
  neonClient,
  projectId,
  developmentBranchId,
  previewBranchId,
  appIds,
}: {
  neonClient: Api<unknown>;
  projectId: string;
  developmentBranchId: string;
  previewBranchId: string | null;
  appIds: number[];
}): Promise<
  | { kind: "none" | "rolled-back" }
  | {
      kind: "rolled-forward";
      developmentBranchId: string;
      previewBranchId: string | null;
      branchesDeleted: number;
      branchesNotDeleted: number;
      cleanupFailed: boolean;
    }
> {
  const branches = await listBranches(neonClient, projectId);
  const development = branches.find((b) => b.id === developmentBranchId);
  const match = development?.name.match(/^(.*)-replaced-(\d+)$/);
  if (!development || !match) return { kind: "none" };
  const [, originalName, stampText] = match;
  const stamp = Number(stampText);
  logger.warn(
    `Found an interrupted migration of development branch ${developmentBranchId} in Neon project ${projectId}`,
  );

  const inUse = await branchesInUse(projectId);
  // Before the rename the new branch is dyad-migrating-<stamp>; after it,
  // it holds the development name.
  const holder = branches.find(
    (b) => b.name === originalName && b.id !== developmentBranchId,
  );
  if (holder && !isUnfinishedMigrationBranch(holder, stamp, inUse)) {
    throw new MigrationRefusedError(
      `Can't migrate the development database: the branch "${originalName}" isn't the one an interrupted migration created, so the old development branch can't get its name back. Rename or delete it in the Neon console, then try again.`,
      "interrupted-migration",
    );
  }
  const unfinished =
    holder ??
    branches.find(
      (b) =>
        b.name === `dyad-migrating-${stamp}` &&
        isUnfinishedMigrationBranch(b, stamp, inUse),
    );

  const switching = await db
    .select()
    .from(apps)
    .where(inArray(apps.id, appIds));
  const developmentApps = switching.filter((app) =>
    developmentIsActive(app, developmentBranchId, previewBranchId),
  );
  const unfinishedEndpoints = unfinished
    ? await branchEndpointIds(neonClient, projectId, unfinished.id)
    : new Set<string>();
  const onUnfinished: typeof developmentApps = [];
  for (const app of developmentApps) {
    const endpoint = await envEndpointId(app.path);
    if (endpoint && unfinishedEndpoints.has(endpoint)) onUnfinished.push(app);
  }

  if (onUnfinished.length === 0) {
    if (unfinished) {
      const deleted = await deleteBranch(
        neonClient,
        projectId,
        unfinished.id,
        "unfinished development branch",
      );
      if (!deleted) {
        throw new DyadError(
          `Could not delete the unfinished development branch left by an interrupted migration. Try again.`,
          DyadErrorKind.External,
        );
      }
    }
    await retryOnLocked(
      () =>
        neonClient.updateProjectBranch(projectId, developmentBranchId, {
          branch: { name: originalName },
        }),
      `Restore development branch name ${developmentBranchId}`,
    );
    logger.info(
      `Rolled back the interrupted migration of development branch ${developmentBranchId}`,
    );
    return { kind: "rolled-back" };
  }

  if (onUnfinished.length < developmentApps.length || !holder) {
    throw new MigrationRefusedError(
      `Can't migrate the development database: an interrupted migration left ${onUnfinished.map((a) => a.name).join(", ")} on the new branch and other apps on the old one, so both may have new data. Contact support to merge them.`,
      "interrupted-migration",
    );
  }

  // Roll forward. Rewriting .env.local first is idempotent for these apps,
  // and refreshes Neon Auth's URL in case the crash cut that write short.
  for (const app of onUnfinished) {
    const warning = await autoInjectNeonEnvVars({
      appId: app.id,
      appPath: app.path,
      projectId,
      branchId: holder.id,
      branchType: "development",
    });
    if (warning) {
      throw new DyadError(
        `Could not point ${app.name} at the new development branch: ${warning}`,
        DyadErrorKind.External,
      );
    }
  }
  switchAppsToBranch({
    appIds,
    oldDevelopmentId: developmentBranchId,
    previewBranchId,
    newDevelopmentId: holder.id,
  });
  const plan = planLegacyMigration({
    branches,
    developmentBranchId,
    previewBranchId,
  });
  const removable = "blockedBy" in plan ? new Set<string>() : plan.removable;
  const oldPreview = previewBranchId
    ? branches.find((b) => b.id === previewBranchId)
    : undefined;
  const finished = await finishMigration({
    neonClient,
    projectId,
    appIds,
    label: `app${appIds.length > 1 ? "s" : ""} ${appIds.join(", ")}`,
    newDevelopment: holder,
    oldPreview,
    replacePreview: !!oldPreview && removable.has(oldPreview.id),
    previewBranchId,
    removable,
    stamp,
  });
  logger.info(
    `Finished the interrupted migration of development branch ${developmentBranchId} on branch ${holder.id}`,
  );
  return {
    kind: "rolled-forward",
    developmentBranchId: holder.id,
    ...finished,
  };
}

/**
 * Whether the development branch uses the root layout. Right after a restore,
 * a root branch is briefly a child of its backup (see the top of this file);
 * an old-layout branch's parent is never a root backup.
 */
function isRootLayout(development: Branch, branches: Branch[]): boolean {
  if (!development.parent_id) return true;
  const parent = branches.find((b) => b.id === development.parent_id);
  return (
    !!parent && !parent.parent_id && BACKUP_BRANCH_PATTERN.test(parent.name)
  );
}

interface LegacyMigrationPlan {
  /** Branches the migration may delete once the app uses the new branch. */
  removable: Set<string>;
}

/**
 * Plans moving a child development branch to a root branch: the old tree is
 * the development branch, the backups above it, and everything under those.
 * Returns `blockedBy` when that tree holds branches Dyad did not create: they
 * would keep the old tree alive, and deleting them is not Dyad's call.
 */
function planLegacyMigration({
  branches,
  developmentBranchId,
  previewBranchId,
}: {
  branches: Branch[];
  developmentBranchId: string;
  previewBranchId: string | null;
}): LegacyMigrationPlan | { blockedBy: string[] } {
  const byId = new Map(branches.map((b) => [b.id, b]));
  const backupChain: Branch[] = [];
  let parentId = byId.get(developmentBranchId)?.parent_id;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || !BACKUP_BRANCH_PATTERN.test(parent.name)) break;
    backupChain.push(parent);
    parentId = parent.parent_id;
  }

  const removable = new Set<string>([developmentBranchId]);
  for (const backup of backupChain) removable.add(backup.id);
  const blockedBy: string[] = [];
  const pending = [...removable];
  while (pending.length > 0) {
    const id = pending.pop()!;
    for (const child of childrenOf(branches, id)) {
      if (removable.has(child.id)) continue;
      if (
        child.id === previewBranchId ||
        BACKUP_BRANCH_PATTERN.test(child.name) ||
        TEST_BRANCH_PATTERN.test(child.name) ||
        MIGRATION_SOURCE_PATTERN.test(child.name)
      ) {
        removable.add(child.id);
        pending.push(child.id);
      } else {
        blockedBy.push(child.name);
      }
    }
  }
  return blockedBy.length > 0 ? { blockedBy } : { removable };
}

async function branchHasNeonAuth(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
): Promise<boolean> {
  try {
    await retryOnLocked(
      () => neonClient.getNeonAuth(projectId, branchId),
      `Get Neon Auth for branch ${branchId}`,
    );
    return true;
  } catch (error: any) {
    if (error?.response?.status === 404) return false;
    throw error;
  }
}

/**
 * Deletes `ids` children-first; a failed delete keeps its ancestors. Removes
 * deleted branches from `ids`. Returns how many it deleted and the names of
 * the existing branches it left: those it failed to delete and their kept
 * ancestors. Ids of branches that no longer exist count as neither.
 */
async function deleteBranchTree(
  neonClient: Api<unknown>,
  projectId: string,
  ids: Set<string>,
): Promise<{ deleted: number; left: string[] }> {
  const remaining = new Set(ids);
  const failed: string[] = [];
  const branches = await listBranches(neonClient, projectId);
  const live = branches.filter((b) => remaining.has(b.id));
  for (;;) {
    const leaves = live.filter(
      (b) =>
        remaining.has(b.id) &&
        !branches.some((c) => c.parent_id === b.id && remaining.has(c.id)),
    );
    if (leaves.length === 0) break;
    for (const leaf of leaves) {
      remaining.delete(leaf.id);
      if (await deleteBranch(neonClient, projectId, leaf.id, "old branch")) {
        ids.delete(leaf.id);
      } else {
        failed.push(leaf.name);
        // Keep its ancestors: they still have a child.
        let parentId = leaf.parent_id;
        while (parentId && remaining.delete(parentId)) {
          parentId = branches.find((b) => b.id === parentId)?.parent_id;
        }
      }
    }
  }
  return {
    deleted: live.length - live.filter((b) => ids.has(b.id)).length,
    left: live.filter((b) => ids.has(b.id)).map((b) => b.name),
  };
}

/**
 * Copies the Neon Auth settings a fresh provisioning resets: email and
 * password options, trusted domains, and OAuth providers. Returns what it
 * could not copy, for the user to set up again.
 */
async function copyNeonAuthSettings(
  neonClient: Api<unknown>,
  projectId: string,
  fromBranchId: string,
  toBranchId: string,
): Promise<string[]> {
  const notCopied: string[] = [];
  const attempt = async (label: string, copy: () => Promise<unknown>) => {
    try {
      await copy();
    } catch (error) {
      logger.warn(
        `Failed to copy ${label} to Neon branch ${toBranchId}: ${getNeonErrorMessage(error)}`,
      );
      notCopied.push(label);
    }
  };

  await attempt("email and password settings", async () => {
    const { data } = await retryOnLocked(
      () =>
        neonClient.getNeonAuthEmailAndPasswordConfig(projectId, fromBranchId),
      `Get Neon Auth email settings for ${fromBranchId}`,
    );
    await retryOnLocked(
      () =>
        neonClient.updateNeonAuthEmailAndPasswordConfig(
          projectId,
          toBranchId,
          data,
        ),
      `Copy Neon Auth email settings to ${toBranchId}`,
    );
    invalidateEmailPasswordConfigCache(projectId, toBranchId);
  });

  let oldDomains: string[] = [];
  let newDomains: string[] = [];
  await attempt("trusted domains", async () => {
    [oldDomains, newDomains] = await Promise.all(
      [fromBranchId, toBranchId].map(async (branchId) =>
        (
          (
            await retryOnLocked(
              () =>
                neonClient.listBranchNeonAuthTrustedDomains(
                  projectId,
                  branchId,
                ),
              `List Neon Auth trusted domains for ${branchId}`,
            )
          ).data.domains ?? []
        ).map((d) => d.domain),
      ),
    );
  });
  for (const domain of oldDomains.filter((d) => !newDomains.includes(d))) {
    await attempt(`trusted domain ${domain}`, () =>
      retryOnLocked(
        () =>
          neonClient.addBranchNeonAuthTrustedDomain(projectId, toBranchId, {
            domain,
            auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
          }),
        `Add Neon Auth trusted domain to ${toBranchId}`,
      ).catch((error) => {
        if (error?.response?.status !== 409) throw error;
      }),
    );
  }

  let oldProviders: NeonAuthOauthProvider[] = [];
  let newProviders: NeonAuthOauthProvider[] = [];
  await attempt("sign-in providers", async () => {
    [oldProviders, newProviders] = await Promise.all(
      [fromBranchId, toBranchId].map(
        async (branchId) =>
          (
            await retryOnLocked(
              () =>
                neonClient.listBranchNeonAuthOauthProviders(
                  projectId,
                  branchId,
                ),
              `List Neon Auth sign-in providers for ${branchId}`,
            )
          ).data.providers ?? [],
      ),
    );
  });
  for (const provider of oldProviders) {
    const existing = newProviders.find((p) => p.id === provider.id);
    if (
      existing &&
      existing.type === provider.type &&
      existing.client_id === provider.client_id
    ) {
      continue;
    }
    await attempt(`${provider.id} sign-in`, async () => {
      // Neon may not return a custom provider's secret.
      if (provider.client_id && !provider.client_secret) {
        throw new Error("client secret not returned");
      }
      const credentials = {
        client_id: provider.client_id,
        client_secret: provider.client_secret,
      };
      await retryOnLocked(
        () =>
          existing
            ? neonClient.updateBranchNeonAuthOauthProvider(
                projectId,
                toBranchId,
                provider.id,
                credentials,
              )
            : neonClient.addBranchNeonAuthOauthProvider(projectId, toBranchId, {
                id: provider.id,
                ...credentials,
              }),
        `Copy Neon Auth ${provider.id} sign-in to ${toBranchId}`,
      );
    });
  }
  return notCopied;
}

/** Whether the app runs against the development (or preview) branch. */
function developmentIsActive(
  app: { neonActiveBranchId: string | null },
  developmentBranchId: string,
  previewBranchId: string | null,
): boolean {
  const activeId = app.neonActiveBranchId ?? developmentBranchId;
  return activeId === developmentBranchId || activeId === previewBranchId;
}

async function restoreEnvFile(
  appPath: string,
  snapshot: string | null,
): Promise<void> {
  const envFilePath = getEnvFilePath({ appPath });
  if (snapshot === null) {
    await fs.rm(envFilePath, { force: true });
  } else {
    await fs.writeFile(envFilePath, snapshot);
  }
}

/**
 * Points every app on the old development branch at the new one. One
 * transaction: if it fails, every app stays on the old branch, which the
 * caller then restores.
 */
function switchAppsToBranch({
  appIds,
  oldDevelopmentId,
  previewBranchId,
  newDevelopmentId,
}: {
  appIds: number[];
  oldDevelopmentId: string;
  previewBranchId: string | null;
  newDevelopmentId: string;
}): { appId: number; path: string; developmentWasActive: boolean }[] {
  return db.transaction((tx) =>
    appIds.flatMap((appId) => {
      const app = tx.select().from(apps).where(eq(apps.id, appId)).get();
      if (!app) return [];
      const developmentWasActive = developmentIsActive(
        app,
        oldDevelopmentId,
        previewBranchId,
      );
      tx.update(apps)
        .set({
          neonDevelopmentBranchId: newDevelopmentId,
          ...(developmentWasActive
            ? { neonActiveBranchId: newDevelopmentId }
            : {}),
        })
        .where(eq(apps.id, appId))
        .run();
      // The new branch's history starts now, so earlier versions' timestamps
      // point into the deleted tree.
      tx.update(versions)
        .set({ neonDbTimestamp: null })
        .where(eq(versions.appId, appId))
        .run();
      return [{ appId, path: app.path, developmentWasActive }];
    }),
  );
}

/**
 * Replaces a child development branch with a root branch holding its data at
 * `timestamp`, points every app using it (`appIds`) at the new branch, and
 * deletes the old branch tree.
 *
 * Everything up to and including switching the apps (their `.env.local`
 * files, then their rows) is undone on failure.
 */
async function migrateToRootDevelopmentBranch({
  appIds,
  projectId,
  oldDevelopment,
  previewBranchId,
  branches,
  plan,
  timestamp,
  backupFilePath,
  onStep,
}: {
  backupFilePath: string;
  appIds: number[];
  projectId: string;
  oldDevelopment: Branch;
  previewBranchId: string | null;
  branches: Branch[];
  plan: LegacyMigrationPlan;
  timestamp: string;
  onStep: (step: MigrationStep) => void;
}): Promise<{
  developmentBranchId: string;
  previewBranchId: string | null;
  notCopied: string[];
  tables: number;
  rows: number;
  branchesDeleted: number;
  branchesNotDeleted: number;
  cleanupFailed: boolean;
}> {
  onStep("source");
  const neonClient = await getNeonClient();
  const stamp = Date.now();
  const label = `app${appIds.length > 1 ? "s" : ""} ${appIds.join(", ")}`;
  const oldPreview = previewBranchId
    ? branches.find((b) => b.id === previewBranchId)
    : undefined;
  // A preview branch outside the old tree (possible in a linked project)
  // survives the migration, so it is kept rather than replaced.
  const replacePreview = !!oldPreview && plan.removable.has(oldPreview.id);

  // Test branches a crashed run left under the preview branch would keep it
  // from serving as the source below; they are deleted with the tree anyway.
  let previewHasChildren = false;
  let branchesDeleted = 0;
  if (oldPreview && replacePreview) {
    const leftovers = new Set(
      childrenOf(branches, oldPreview.id).map((b) => b.id),
    );
    if (leftovers.size > 0) {
      // Removes what it deletes from `leftovers`.
      const { deleted } = await deleteBranchTree(
        neonClient,
        projectId,
        leftovers,
      );
      branchesDeleted += deleted;
    }
    previewHasChildren = leftovers.size > 0;
  }

  // The data to keep is the development branch at `timestamp`. The preview
  // branch already exists for exactly this, so reuse it instead of spending
  // another branch from the project's limit. Restoring it makes it a child of
  // the old development branch, so only a preview that is deleted with the
  // old tree can serve.
  let sourceBranchId: string;
  let temporarySourceId: string | null = null;
  if (oldPreview && replacePreview && !previewHasChildren) {
    await retryOnLocked(
      () =>
        neonClient.restoreProjectBranch(projectId, oldPreview.id, {
          source_branch_id: oldDevelopment.id,
          source_timestamp: timestamp,
        }),
      `Restore preview branch ${oldPreview.id} as migration source`,
    );
    sourceBranchId = oldPreview.id;
  } else {
    const response = await retryOnLocked(
      () =>
        neonClient.createProjectBranch(projectId, {
          endpoints: [{ type: EndpointType.ReadWrite }],
          branch: {
            name: `dyad-restore-source-${stamp}`,
            parent_id: oldDevelopment.id,
            parent_timestamp: timestamp,
          },
        }),
      `Create migration source branch for ${label}`,
    );
    sourceBranchId = response.data.branch.id;
    temporarySourceId = sourceBranchId;
  }

  const sourceUri = await getConnectionUri({
    projectId,
    branchId: sourceBranchId,
  });
  const migratingName = `dyad-migrating-${stamp}`;
  const developmentName = oldDevelopment.name;
  let newDevelopment: Branch | null = null;
  let renamedOld = false;
  let renamedNew = false;
  let notCopied: string[] = [];
  let copiedTables = 0;
  let copiedRows = 0;
  const envSnapshots = new Map<string, string | null>();
  try {
    onStep("backup");
    // Neon cannot recover the old branches once deleted, so the user keeps a
    // copy of the data. No copy, no migration.
    const backup = await exportBranchDataAsSql({
      sourceUri,
      filePath: backupFilePath,
      title: `Dyad backup of the "${developmentName}" Neon branch, saved before migrating it.`,
    });
    logger.info(
      `Saved ${backup.rows} rows in ${backup.tables} tables to ${backupFilePath} for ${label}`,
    );

    onStep("create-branch");
    const created = await createRootBranch({
      projectId,
      sourceBranchId: oldDevelopment.id,
      name: migratingName,
      sourceTimestamp: timestamp,
    });
    newDevelopment = created.branch;

    onStep("neon-auth");
    const hasAuth = await branchHasNeonAuth(
      neonClient,
      projectId,
      oldDevelopment.id,
    );
    // Capture foreign keys before dropping the copied neon_auth schema
    // cascades away any that reference it.
    const foreignKeys = await listForeignKeys(created.connectionUri);
    if (hasAuth) {
      await prepareSchemaOnlyBranchForNeonAuth(created.connectionUri);
      await ensureNeonAuth({ projectId, branchId: newDevelopment.id });
      notCopied = await copyNeonAuthSettings(
        neonClient,
        projectId,
        oldDevelopment.id,
        newDevelopment.id,
      );
    }
    onStep("copy");
    const copied = await copyBranchData({
      sourceUri,
      targetUri: created.connectionUri,
      extraForeignKeys: foreignKeys,
    });
    copiedTables = copied.tables;
    copiedRows = copied.rows;
    logger.info(
      `Copied ${copied.rows} rows in ${copied.tables} tables to new development branch ${newDevelopment.id} for ${label}`,
    );

    onStep("rename");
    // Branch names are unique, so free the old name before taking it.
    await retryOnLocked(
      () =>
        neonClient.updateProjectBranch(projectId, oldDevelopment.id, {
          branch: { name: `${developmentName}-replaced-${stamp}` },
        }),
      `Rename old development branch ${oldDevelopment.id}`,
    );
    renamedOld = true;
    const newDevelopmentId = newDevelopment.id;
    await retryOnLocked(
      () =>
        neonClient.updateProjectBranch(projectId, newDevelopmentId, {
          branch: { name: developmentName },
        }),
      `Rename new development branch ${newDevelopmentId}`,
    );
    renamedNew = true;

    onStep("env");
    // Point each app's .env.local at the new branch before its row: once the
    // old tree is deleted, an app left on the old connection string (or the
    // old Neon Auth URL) could not reach its database.
    const switching = await db
      .select()
      .from(apps)
      .where(inArray(apps.id, appIds));
    for (const app of switching) {
      if (!developmentIsActive(app, oldDevelopment.id, previewBranchId)) {
        continue;
      }
      envSnapshots.set(
        app.path,
        (await readEnvFileIfExists({ appPath: app.path })) ?? null,
      );
      const warning = await autoInjectNeonEnvVars({
        appId: app.id,
        appPath: app.path,
        projectId,
        branchId: newDevelopmentId,
        branchType: "development",
      });
      if (warning) {
        throw new DyadError(
          `Could not point ${app.name} at the new development branch: ${warning}`,
          DyadErrorKind.External,
        );
      }
    }
    onStep("switch");
    switchAppsToBranch({
      appIds,
      oldDevelopmentId: oldDevelopment.id,
      previewBranchId,
      newDevelopmentId,
    });
  } catch (error) {
    for (const [appPath, snapshot] of envSnapshots) {
      await restoreEnvFile(appPath, snapshot).catch((restoreError) =>
        logger.error(
          `Failed to restore .env.local for ${appPath}: ${restoreError}`,
        ),
      );
    }
    // The new branch goes first: it may hold the development name. If it
    // can't be deleted, it gives the name back and a later sweep deletes it.
    if (newDevelopment) {
      const newDevelopmentId = newDevelopment.id;
      const deleted = await deleteBranch(
        neonClient,
        projectId,
        newDevelopmentId,
        "unfinished development branch",
      );
      if (!deleted && renamedNew) {
        await retryOnLocked(
          () =>
            neonClient.updateProjectBranch(projectId, newDevelopmentId, {
              branch: { name: migratingName },
            }),
          `Rename unfinished development branch ${newDevelopmentId}`,
        ).catch((renameError) =>
          logger.error(
            `Failed to rename unfinished development branch ${newDevelopmentId}: ${getNeonErrorMessage(renameError)}`,
          ),
        );
      }
    }
    if (renamedOld) {
      await retryOnLocked(
        () =>
          neonClient.updateProjectBranch(projectId, oldDevelopment.id, {
            branch: { name: developmentName },
          }),
        `Restore old development branch name ${oldDevelopment.id}`,
      ).catch((renameError) =>
        logger.error(
          `Failed to restore the name of development branch ${oldDevelopment.id}: ${getNeonErrorMessage(renameError)}`,
        ),
      );
    }
    if (temporarySourceId) {
      await deleteBranch(
        neonClient,
        projectId,
        temporarySourceId,
        "migration source branch",
      );
    }
    throw error;
  }

  // The apps now use the new branch.
  if (temporarySourceId) plan.removable.add(temporarySourceId);
  const finished = await finishMigration({
    neonClient,
    projectId,
    appIds,
    label,
    newDevelopment,
    oldPreview,
    replacePreview,
    previewBranchId,
    removable: plan.removable,
    stamp,
  });
  return {
    developmentBranchId: newDevelopment.id,
    previewBranchId: finished.previewBranchId,
    notCopied,
    tables: copiedTables,
    rows: copiedRows,
    branchesDeleted: branchesDeleted + finished.branchesDeleted,
    branchesNotDeleted: finished.branchesNotDeleted,
    cleanupFailed: finished.cleanupFailed,
  };
}

/**
 * After the apps are switched to the new development branch: deletes the old
 * branch tree (`removable`) and recreates the preview branch under the new
 * branch. Best-effort: failing it must not report the migration as failed;
 * whatever it leaves behind is swept after a later restore.
 */
async function finishMigration({
  neonClient,
  projectId,
  appIds,
  label,
  newDevelopment,
  oldPreview,
  replacePreview,
  previewBranchId,
  removable,
  stamp,
}: {
  neonClient: Api<unknown>;
  projectId: string;
  appIds: number[];
  label: string;
  newDevelopment: Branch;
  oldPreview: Branch | undefined;
  replacePreview: boolean;
  previewBranchId: string | null;
  removable: Set<string>;
  stamp: number;
}): Promise<{
  previewBranchId: string | null;
  branchesDeleted: number;
  branchesNotDeleted: number;
  cleanupFailed: boolean;
}> {
  let branchesDeleted = 0;
  let branchesNotDeleted = 0;
  let cleanupFailed = false;
  try {
    const { deleted, left } = await deleteBranchTree(
      neonClient,
      projectId,
      removable,
    );
    branchesDeleted = deleted;
    branchesNotDeleted = left.length;
    logger.info(
      `Deleted ${deleted} old branches after moving ${label} to root development branch ${newDevelopment.id}`,
    );
    if (left.length > 0) {
      logger.warn(
        `Moved ${label} to root development branch ${newDevelopment.id}, but could not delete old branches: ${left.join(", ")}`,
      );
    }
  } catch (error) {
    // Nothing is known about what was left; a later sweep retries.
    cleanupFailed = true;
    logger.warn(
      `Failed to delete the old development branches of ${label}: ${getNeonErrorMessage(error)}`,
    );
  }

  // The old preview branch went with the old tree; recreate it under the new
  // development branch, under its old name once that is free.
  let newPreviewId = previewBranchId;
  if (oldPreview && replacePreview) {
    newPreviewId = null;
    try {
      const nameTaken = (await listBranches(neonClient, projectId)).some(
        (b) => b.name === oldPreview.name,
      );
      const response = await retryOnLocked(
        () =>
          neonClient.createProjectBranch(projectId, {
            endpoints: [{ type: EndpointType.ReadWrite }],
            branch: {
              name: nameTaken ? `${oldPreview.name}-${stamp}` : oldPreview.name,
              parent_id: newDevelopment.id,
            },
          }),
        `Create preview branch for ${label}`,
      );
      const previewId = response.data.branch.id;
      newPreviewId = previewId;
      await ensureNeonAuth({ projectId, branchId: previewId }).catch((error) =>
        logger.warn(
          `Failed to enable Neon Auth on new preview branch ${previewId}: ${getNeonErrorMessage(error)}`,
        ),
      );
    } catch (error) {
      // Version previews then fall back to the development database.
      logger.error(
        `Failed to create a preview branch for ${label}: ${getNeonErrorMessage(error)}`,
      );
    }
    try {
      await db
        .update(apps)
        .set({ neonPreviewBranchId: newPreviewId })
        .where(inArray(apps.id, appIds));
    } catch (error) {
      logger.error(
        `Failed to record the new preview branch for ${label}: ${error}`,
      );
    }
  }
  return {
    previewBranchId: newPreviewId,
    branchesDeleted,
    branchesNotDeleted,
    cleanupFailed,
  };
}

/** Why a migration was refused before it changed anything. */
export type MigrationRefusalReason =
  | "foreign-branches"
  | "unsupported-objects"
  | "deploys-with-development"
  | "version-preview"
  | "apps-changed"
  | "branch-limit"
  | "interrupted-migration";

/**
 * A migration refused, before changing anything, because of the project or
 * apps it would act on rather than a fault.
 */
export class MigrationRefusedError extends DyadError {
  constructor(
    message: string,
    readonly reason: MigrationRefusalReason,
    kind: DyadErrorKind = DyadErrorKind.Precondition,
  ) {
    super(message, kind);
  }
}

/** The migration step in progress, to attribute a failure. */
export type MigrationStep =
  | "source"
  | "backup"
  | "create-branch"
  | "neon-auth"
  | "copy"
  | "rename"
  | "env"
  | "switch";

/** What a migration did, for its caller's telemetry. */
export interface MigrationStats {
  tables: number;
  rows: number;
  leakedBackups: number;
  /** Old branches deleted after the switch (backups, old development...). */
  branchesDeleted: number;
  /**
   * Old branches left behind: those that could not be deleted and their
   * ancestors. A later sweep retries.
   */
  branchesNotDeleted: number;
  /** The cleanup stopped before it could tell; the counts are incomplete. */
  cleanupFailed: boolean;
  /** How an earlier, interrupted attempt was dealt with. */
  repair: MigrationRepair;
}

/**
 * The Neon project is at its plan's branch limit, largely with backups that
 * older Dyad versions leaked. Moving off them needs one free branch, and none
 * can be deleted: each leaked backup has a child.
 */
export class LeakedBackupsAtBranchLimitError extends DyadError {
  constructor(during: "restore" | "migrate") {
    const cause =
      "your Neon project is at its plan's branch limit, mostly with backup " +
      "branches that earlier versions of Dyad left behind after database restores.";
    const fix =
      "upgrade this Neon project to a paid plan, then migrate the development " +
      "database from the banner above the preview. Dyad deletes the old backups, " +
      "so you can switch back to the Free plan afterwards.";
    super(
      during === "restore"
        ? `Restored your code to this version, but the database could not be restored: ${cause} To fix this, ${fix} Your current database was left unchanged.`
        : `Could not migrate the development database: ${cause} To fix this, ${fix}`,
      DyadErrorKind.Precondition,
    );
  }
}

/**
 * Backups older Dyad versions leaked above this development branch: the
 * chain of `preserve_*` branches between it and its first other ancestor.
 */
function countLeakedBackups(
  branches: Branch[],
  developmentBranchId: string,
): number {
  let count = 0;
  let parentId = branches.find((b) => b.id === developmentBranchId)?.parent_id;
  while (parentId) {
    const parent = branches.find((b) => b.id === parentId);
    if (!parent || !BACKUP_BRANCH_PATTERN.test(parent.name)) break;
    count += 1;
    parentId = parent.parent_id;
  }
  return count;
}

function leakedBackupsAtBranchLimit(
  branches: Branch[],
  developmentBranchId: string,
  error: unknown,
  during: "restore" | "migrate",
): LeakedBackupsAtBranchLimitError | null {
  const leakedBackups = countLeakedBackups(branches, developmentBranchId);
  if (!isBranchLimitError(error) || leakedBackups === 0) return null;
  sendTelemetryEvent("neon:leaked-backups-at-branch-limit", {
    leakedBackups,
    branchCount: branches.length,
    during,
  });
  return new LeakedBackupsAtBranchLimitError(during);
}

async function findDevelopmentBranch(
  neonClient: Api<unknown>,
  projectId: string,
  developmentBranchId: string,
): Promise<{ branches: Branch[]; development: Branch }> {
  const branches = await listBranches(neonClient, projectId);
  const development = branches.find((b) => b.id === developmentBranchId);
  if (!development) {
    throw new DyadError(
      `Development branch ${developmentBranchId} not found in Neon project ${projectId}`,
      DyadErrorKind.NotFound,
    );
  }
  return { branches, development };
}

export type DevelopmentBranchStatus =
  | { layout: "root" }
  | {
      layout: "legacy";
      /** False when the old tree holds branches Dyad did not create. */
      migratable: boolean;
      leakedBackups: number;
      branchCount: number;
    };

/**
 * Whether the app's development branch still uses the child-branch layout
 * that leaks a backup on every database restore (see the top of this file).
 */
export async function getDevelopmentBranchStatus({
  projectId,
  developmentBranchId,
  previewBranchId,
}: {
  projectId: string;
  developmentBranchId: string;
  previewBranchId: string | null;
}): Promise<DevelopmentBranchStatus> {
  const neonClient = await getNeonClient();
  const { branches, development } = await findDevelopmentBranch(
    neonClient,
    projectId,
    developmentBranchId,
  );
  if (isRootLayout(development, branches)) return { layout: "root" };
  const plan = planLegacyMigration({
    branches,
    developmentBranchId,
    previewBranchId,
  });
  return {
    layout: "legacy",
    migratable: !("blockedBy" in plan),
    leakedBackups: countLeakedBackups(branches, developmentBranchId),
    branchCount: branches.length,
  };
}

/**
 * Moves a child development branch, as it is at `timestamp`, to a root
 * branch and deletes the old tree with its leaked backups. The caller stops
 * the app first so nothing is written after `timestamp`.
 */
export async function migrateDevelopmentBranch({
  appIds,
  projectId,
  developmentBranchId,
  previewBranchId,
  timestamp,
  backupFilePath,
  onStep = () => {},
}: {
  /** Where to save a copy of the data before anything changes. */
  backupFilePath: string;
  /** Called as the migration reaches each step, to attribute a failure. */
  onStep?: (step: MigrationStep) => void;
  /** Every app using this development branch; all are moved. */
  appIds: number[];
  projectId: string;
  developmentBranchId: string;
  previewBranchId: string | null;
  timestamp: string;
}): Promise<{
  developmentBranchId: string;
  previewBranchId: string | null;
  /** Neon Auth settings that could not be carried over. */
  notCopied: string[];
  /** Whether this call saved a backup to `backupFilePath`. */
  backupSaved: boolean;
  stats: MigrationStats;
}> {
  const neonClient = await getNeonClient();
  const repair = await repairInterruptedMigration({
    neonClient,
    projectId,
    developmentBranchId,
    previewBranchId,
    appIds,
  });
  if (repair.kind === "rolled-forward") {
    // The interrupted attempt already copied the data and took a backup.
    return {
      developmentBranchId: repair.developmentBranchId,
      previewBranchId: repair.previewBranchId,
      notCopied: [],
      backupSaved: false,
      stats: {
        tables: 0,
        rows: 0,
        leakedBackups: 0,
        branchesDeleted: repair.branchesDeleted,
        branchesNotDeleted: repair.branchesNotDeleted,
        cleanupFailed: repair.cleanupFailed,
        repair: repair.kind,
      },
    };
  }
  // Branches an earlier, interrupted attempt left behind take up room.
  await sweepLeftoverBranches(neonClient, projectId).catch((error) =>
    logger.warn(
      `Failed to clean up leftover branches in Neon project ${projectId}: ${getNeonErrorMessage(error)}`,
    ),
  );
  const { branches, development } = await findDevelopmentBranch(
    neonClient,
    projectId,
    developmentBranchId,
  );
  if (isRootLayout(development, branches)) {
    return {
      developmentBranchId,
      previewBranchId,
      notCopied: [],
      backupSaved: false,
      stats: {
        tables: 0,
        rows: 0,
        leakedBackups: 0,
        branchesDeleted: 0,
        branchesNotDeleted: 0,
        cleanupFailed: false,
        repair: repair.kind,
      },
    };
  }
  const leakedBackups = countLeakedBackups(branches, developmentBranchId);
  const plan = planLegacyMigration({
    branches,
    developmentBranchId,
    previewBranchId,
  });
  if ("blockedBy" in plan) {
    throw new MigrationRefusedError(
      `Can't migrate the development database: its Neon branches include ones Dyad did not create (${plan.blockedBy.join(", ")}).`,
      "foreign-branches",
    );
  }
  const blockers = await findMigrationBlockers(
    await getConnectionUri({ projectId, branchId: developmentBranchId }),
    {
      neonAuth: await branchHasNeonAuth(
        neonClient,
        projectId,
        developmentBranchId,
      ),
    },
  );
  if (blockers.length > 0) {
    throw new MigrationRefusedError(
      `Can't migrate the development database: the copy would lose ${blockers.join(", ")}.`,
      "unsupported-objects",
    );
  }
  try {
    const {
      tables,
      rows,
      branchesDeleted,
      branchesNotDeleted,
      cleanupFailed,
      ...migrated
    } = await migrateToRootDevelopmentBranch({
      appIds,
      projectId,
      oldDevelopment: development,
      previewBranchId,
      branches,
      plan,
      timestamp,
      backupFilePath,
      onStep,
    });
    return {
      ...migrated,
      backupSaved: true,
      stats: {
        tables,
        rows,
        leakedBackups,
        branchesDeleted,
        branchesNotDeleted,
        cleanupFailed,
        repair: repair.kind,
      },
    };
  } catch (error) {
    throw (
      leakedBackupsAtBranchLimit(
        branches,
        developmentBranchId,
        error,
        "migrate",
      ) ?? error
    );
  }
}

/**
 * A restored root branch's backup, for `waitForRestoreDetach` and
 * `deleteRestoreBackup` to delete.
 */
export interface RestoreBackupCleanup {
  projectId: string;
  developmentBranchId: string;
  backupName: string;
}

/**
 * Restores the app's development branch to `timestamp`. A child branch (the
 * old layout) is restored in place and its backup is kept, because Neon
 * cannot delete it; the preview banner offers moving such apps to a root
 * branch. A root branch's backup can be deleted, but only once Neon detaches
 * the restored branch from it, which can take a while: the returned cleanup
 * is for the caller to run after it releases its claims. Throws `LeakedBackupsAtBranchLimitError` when leaked backups have
 * filled the project.
 */
export async function restoreDevelopmentBranch({
  appId,
  projectId,
  developmentBranchId,
  timestamp,
  backupName,
}: {
  appId: number;
  projectId: string;
  developmentBranchId: string;
  timestamp: string;
  backupName: string;
}): Promise<{ cleanup: RestoreBackupCleanup | null }> {
  const neonClient = await getNeonClient();
  const { branches, development } = await findDevelopmentBranch(
    neonClient,
    projectId,
    developmentBranchId,
  );
  const rootLayout = isRootLayout(development, branches);
  try {
    await retryOnLocked(
      () =>
        neonClient.restoreProjectBranch(projectId, developmentBranchId, {
          source_branch_id: developmentBranchId,
          source_timestamp: timestamp,
          preserve_under_name: backupName,
        }),
      `Restore development branch ${developmentBranchId} for app ${appId}`,
    );
  } catch (error) {
    throw (
      leakedBackupsAtBranchLimit(
        branches,
        developmentBranchId,
        error,
        "restore",
      ) ?? error
    );
  }
  return {
    cleanup: rootLayout ? { projectId, developmentBranchId, backupName } : null,
  };
}

/**
 * Waits until Neon detaches a restored branch from its backup, so the backup
 * can be deleted. Only reads, so callers need no claim for it. Never throws:
 * false means give up and leave the backup for a later sweep.
 */
export async function waitForRestoreDetach({
  projectId,
  developmentBranchId,
}: RestoreBackupCleanup): Promise<"detached" | "timed-out" | "error"> {
  try {
    return (await waitForRootBranchDetached(
      await getNeonClient(),
      projectId,
      developmentBranchId,
    ))
      ? "detached"
      : "timed-out";
  } catch (error) {
    logger.warn(
      `Could not check whether development branch ${developmentBranchId} is detached from its backup; the next restore cleans up: ${getNeonErrorMessage(error)}`,
    );
    return "error";
  }
}

/**
 * Deletes a detached restore's backup, then sweeps anything earlier restores
 * or migrations left behind. The caller holds the app's provider claim: the
 * sweep must not run during a migration, whose unfinished branch looks like a
 * leftover. Best-effort: never throws.
 */
export async function deleteRestoreBackup({
  projectId,
  developmentBranchId,
  backupName,
}: RestoreBackupCleanup): Promise<{ backupDeleted: boolean }> {
  try {
    const neonClient = await getNeonClient();
    const backup = (await listBranches(neonClient, projectId)).find(
      (b) => b.name === backupName,
    );
    const backupDeleted =
      !backup ||
      (await deleteBranch(neonClient, projectId, backup.id, "backup branch"));
    await sweepLeftoverBranches(neonClient, projectId);
    return { backupDeleted };
  } catch (error) {
    logger.warn(
      `Could not clean up after restoring development branch ${developmentBranchId}; the next restore retries: ${getNeonErrorMessage(error)}`,
    );
    return { backupDeleted: false };
  }
}
