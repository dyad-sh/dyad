import crypto from "node:crypto";
import log from "electron-log";
import { eq, isNotNull } from "drizzle-orm";

import { db } from "../../db";
import { apps } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import {
  fetchWithRetry,
  retryWithRateLimit,
} from "@/ipc/utils/retryWithRateLimit";
import { withLock } from "@/ipc/utils/lock_utils";
import {
  executeSupabaseSql,
  getSupabaseClientForOrganization,
} from "../../supabase_admin/supabase_management_client";

const logger = log.scope("supabase_test_user");

type AppRow = typeof apps.$inferSelect;

/** Credentials for an isolated, throwaway Supabase auth user. */
export interface TempTestUser {
  /** The auth user's id (also persisted on the app row while live). */
  userId: string;
  /** Login email, of the form `dyad-test+<appId>-<ts>@dyad.test`. */
  email: string;
  /** Generated login password (handed to the test runner, never persisted). */
  password: string;
  /** The project's public URL (`https://<ref>.supabase.co`). */
  projectUrl: string;
}

/** Result of inspecting Row-Level Security on the project's public tables. */
export interface RlsCheckResult {
  /** Public tables that do NOT have RLS enabled (the test user could touch real data here). */
  tablesWithoutRls: string[];
  /** Set when RLS couldn't be verified (query/parse failure) — treated as "unknown". */
  unverified?: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Conservative identifier guard for table/column names we interpolate into SQL.
const SAFE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Common columns that scope a row to its owning auth user. Used for best-effort
// cleanup of rows the test user created in tables that don't cascade.
const OWNER_COLUMNS = ["user_id", "owner_id", "created_by", "author_id", "uid"];

function projectUrlFor(ref: string): string {
  return `https://${ref}.supabase.co`;
}

/**
 * Fetch a project's `service_role` (secret) key. Used ONLY by the main process
 * for test-user setup/teardown — it must NEVER be injected into the app under
 * test (which runs with the anon/publishable key).
 */
async function getServiceRoleKey({
  projectId,
  organizationSlug,
}: {
  projectId: string;
  organizationSlug: string;
}): Promise<string> {
  const supabase = await getSupabaseClientForOrganization(organizationSlug);
  const keys = await retryWithRateLimit(
    () => supabase.getProjectApiKeys(projectId),
    `Get API keys for ${projectId}`,
  );
  if (!keys) {
    throw new DyadError(
      `No API keys found for Supabase project ${projectId}.`,
      DyadErrorKind.NotFound,
    );
  }
  const secret = keys.find(
    (key) =>
      (key as any)["type"] === "secret" ||
      (key as any)["name"] === "service_role",
  );
  if (!secret?.api_key) {
    throw new DyadError(
      `No service_role key found for Supabase project ${projectId}. An isolated test user can't be created without it.`,
      DyadErrorKind.NotFound,
    );
  }
  return secret.api_key;
}

/** Authorization headers for the project's Auth Admin REST API. */
function adminHeaders(serviceRole: string): Record<string, string> {
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
  };
}

/**
 * Create a throwaway, confirmed auth user inside the app's real Supabase
 * project for an isolated test run. Tests authenticate as this user and, under
 * Row-Level Security, only ever touch their own rows. The user id is persisted
 * on the app row (`supabaseTestUserId`) so a crash mid-run can be reconciled on
 * next launch.
 *
 * Throws `DyadError` if the app isn't connected to a Supabase project/org.
 */
export async function createTempTestUser(
  appData: AppRow,
): Promise<TempTestUser> {
  const projectId = appData.supabaseProjectId;
  const organizationSlug = appData.supabaseOrganizationSlug;
  if (!projectId) {
    throw new DyadError(
      `App ${appData.id} is not connected to a Supabase project.`,
      DyadErrorKind.Precondition,
    );
  }
  if (!organizationSlug) {
    throw new DyadError(
      `App ${appData.id} is not connected to a Supabase organization.`,
      DyadErrorKind.Precondition,
    );
  }

  const projectUrl = projectUrlFor(projectId);
  const email = `dyad-test+${appData.id}-${Date.now()}@dyad.test`;
  const password = crypto.randomBytes(24).toString("base64url");

  if (IS_TEST_BUILD) {
    // Don't hit the network in Dyad's own E2E build (fake Supabase project).
    const userId = "00000000-0000-4000-8000-000000000000";
    await persistTestUserId(appData.id, userId);
    return { userId, email, password, projectUrl };
  }

  // Best-effort: if a prior session leaked a user on this row, delete it before
  // we overwrite the column so we don't orphan it. Remember whether that
  // cleanup actually succeeded — if it didn't, we must NOT overwrite the column
  // below (that would drop the prior user id and orphan it forever, since the
  // startup reconciliation sweep relies on the column to find it again).
  let priorCleanupOk = true;
  if (appData.supabaseTestUserId) {
    priorCleanupOk = await deleteUserBestEffort({
      projectUrl,
      projectId,
      organizationSlug,
      userId: appData.supabaseTestUserId,
    });
    if (!priorCleanupOk) {
      throw new DyadError(
        `Couldn't clean up the previous Supabase test user for app ${appData.id}. Skipping this run to avoid leaking a test user; it will be retried on the next launch.`,
        DyadErrorKind.External,
      );
    }
  }

  const serviceRole = await getServiceRoleKey({ projectId, organizationSlug });
  // fetchWithRetry (not a bare fetch in retryWithRateLimit): fetch resolves on
  // a 429 rather than throwing, so only the throwing wrapper actually retries
  // when back-to-back runs hit the Auth Admin rate limit.
  const response = await fetchWithRetry(
    `${projectUrl}/auth/v1/admin/users`,
    {
      method: "POST",
      headers: adminHeaders(serviceRole),
      body: JSON.stringify({
        email,
        password,
        // Confirm immediately so the user can sign in without an email round
        // trip. Inserting into auth tables directly produces a user that
        // can't log in — the Admin API avoids that.
        email_confirm: true,
        app_metadata: { dyad_test: true, dyad_app_id: appData.id },
      }),
    },
    `Create test user for app ${appData.id}`,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DyadError(
      `Supabase rejected the test-user creation (${response.status}). ${detail}`,
      DyadErrorKind.External,
    );
  }
  const created = (await response.json()) as { id?: string };
  if (!created?.id) {
    throw new DyadError(
      "Supabase did not return an id for the test user.",
      DyadErrorKind.External,
    );
  }

  // Persist the in-flight user id immediately so a crash before teardown is
  // recoverable by the startup reconciliation sweep. If persisting fails, the
  // reconciliation sweep will never know about this user, so compensate by
  // deleting it now — otherwise we'd leak an untracked auth user in the real
  // project.
  //
  // Prior-user cleanup failures dead-end above. That keeps this new user
  // trackable: every created user is persisted before the run can proceed.
  if (priorCleanupOk) {
    try {
      await persistTestUserId(appData.id, created.id);
    } catch (error) {
      await deleteUserBestEffort({
        projectUrl,
        projectId,
        organizationSlug,
        userId: created.id,
      });
      throw error;
    }
  }

  logger.info(`Created test user ${created.id} for app ${appData.id}`);
  return { userId: created.id, email, password, projectUrl };
}

/**
 * Tear down the test user for an app: clean up the rows it created, delete the
 * user on Supabase, and clear the persisted `supabaseTestUserId`. Safe to call
 * when no user is set.
 */
export async function deleteTempTestUser(appData: AppRow): Promise<void> {
  const userId = appData.supabaseTestUserId;
  const projectId = appData.supabaseProjectId;
  const organizationSlug = appData.supabaseOrganizationSlug;
  if (!userId || !projectId || !organizationSlug) {
    return;
  }
  if (IS_TEST_BUILD) {
    await db
      .update(apps)
      .set({ supabaseTestUserId: null })
      .where(eq(apps.id, appData.id));
    return;
  }

  // Sweep the user's rows FIRST so a `restrict`/`no action` FK to auth.users
  // doesn't block the user delete below.
  await cleanUpRowsOwnedBy({ projectId, organizationSlug, userId });

  // Only forget the user once Supabase confirms it's gone. Clearing the column
  // on a failed delete would orphan the user, since the startup reconciliation
  // sweep relies on this id to find it again.
  const projectUrl = projectUrlFor(projectId);
  const deleted = await deleteUserBestEffort({
    projectUrl,
    projectId,
    organizationSlug,
    userId,
  });
  if (deleted) {
    await db
      .update(apps)
      .set({ supabaseTestUserId: null })
      .where(eq(apps.id, appData.id));
  }
}

/**
 * Startup reconciliation: any app row still carrying a `supabaseTestUserId`
 * means a previous session crashed mid-run and leaked a test user. Delete the
 * orphans best-effort and clear the column. Never throws — a failure here must
 * not block app startup.
 */
export async function reconcileOrphanTestUsers(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(apps)
      .where(isNotNull(apps.supabaseTestUserId));
    if (rows.length === 0) {
      return;
    }
    logger.info(
      `Reconciling ${rows.length} orphaned Supabase test user(s) from a previous session`,
    );
    for (const appData of rows) {
      try {
        // Serialize against a user-initiated test run on the same app so this
        // sweep can't race the run's teardown on the shared supabaseTestUserId
        // column. The run path acquires the same per-app lock.
        await withLock(appData.id, () => deleteTempTestUser(appData));
      } catch (error) {
        logger.warn(
          `Failed to reconcile orphaned test user for app ${appData.id}: ${error}`,
        );
      }
    }
  } catch (error) {
    logger.error(`Failed to reconcile orphaned test users: ${error}`);
  }
}

/**
 * Inspect whether every public table has Row-Level Security enabled. Isolation
 * relies on RLS to scope the test user to its own rows; tables without it are
 * surfaced to the user as a warning (we proceed, but real data in those tables
 * is reachable). On a query/parse failure we report `unverified` rather than
 * silently claiming everything is safe.
 */
export async function checkRls({
  projectId,
  organizationSlug,
}: {
  projectId: string;
  organizationSlug: string;
}): Promise<RlsCheckResult> {
  if (IS_TEST_BUILD) {
    return { tablesWithoutRls: [] };
  }
  const query = `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';`;
  try {
    const raw = await executeSupabaseSql({
      supabaseProjectId: projectId,
      query,
      organizationSlug,
    });
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) {
      return { tablesWithoutRls: [], unverified: true };
    }
    const tablesWithoutRls = rows
      .filter((row) => row && row.rls_enabled === false)
      .map((row) => String(row.table_name));
    return { tablesWithoutRls };
  } catch (error) {
    logger.warn(
      `Could not verify Row-Level Security for ${projectId}: ${error}`,
    );
    return { tablesWithoutRls: [], unverified: true };
  }
}

/**
 * Best-effort scoped cleanup: delete rows the test user created in public
 * tables that carry a common owner column. This complements FK cascade (which
 * removes rows whose FK to auth.users declares `on delete cascade` when the
 * user itself is deleted). Rows with neither a matching owner column nor a
 * cascade FK are NOT removed — a documented limitation of the free-tier model.
 */
async function cleanUpRowsOwnedBy({
  projectId,
  organizationSlug,
  userId,
}: {
  projectId: string;
  organizationSlug: string;
  userId: string;
}): Promise<void> {
  if (!UUID_RE.test(userId)) {
    // The id comes from Supabase, but never interpolate a non-UUID into SQL.
    logger.warn(
      `Refusing to clean up rows for non-UUID test user "${userId}".`,
    );
    return;
  }
  try {
    const discoverQuery = `SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN (${OWNER_COLUMNS.map((c) => `'${c}'`).join(", ")});`;
    const raw = await executeSupabaseSql({
      supabaseProjectId: projectId,
      query: discoverQuery,
      organizationSlug,
    });
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }
    for (const row of rows) {
      const table = String(row?.table_name ?? "");
      const column = String(row?.column_name ?? "");
      if (!SAFE_IDENT_RE.test(table) || !SAFE_IDENT_RE.test(column)) {
        continue;
      }
      try {
        // SECURITY: the regex guards above (SAFE_IDENT_RE for table/column,
        // UUID_RE for userId) are the LOAD-BEARING injection defense here, not
        // format(). The values are interpolated into the JS template string
        // *before* Postgres ever sees the query, so if a value contained a
        // single quote it would break out of the SQL string literal that wraps
        // format()'s arguments — format() only escapes what reaches it intact.
        // The regexes guarantee that: SAFE_IDENT_RE/UUID_RE must NEVER be
        // relaxed to allow quotes, dollar signs, or backslashes. format(%I, %L)
        // is a second layer that quotes identifiers/values that already passed
        // regex validation.
        await executeSupabaseSql({
          supabaseProjectId: projectId,
          query: `DO $dyad_cleanup$ BEGIN EXECUTE format('DELETE FROM public.%I WHERE %I = %L', '${table}', '${column}', '${userId}'); END $dyad_cleanup$;`,
          organizationSlug,
        });
      } catch (error) {
        logger.warn(
          `Best-effort cleanup of public.${table}.${column} for test user failed: ${error}`,
        );
      }
    }
  } catch (error) {
    logger.warn(`Could not discover owner columns for cleanup: ${error}`);
  }
}

async function deleteUserBestEffort({
  projectUrl,
  projectId,
  organizationSlug,
  userId,
}: {
  projectUrl: string;
  projectId: string;
  organizationSlug: string;
  userId: string;
}): Promise<boolean> {
  if (!UUID_RE.test(userId)) {
    // The id comes from Supabase (or a possibly-corrupted DB column), but never
    // interpolate a non-UUID into the admin API URL path.
    logger.warn(`Refusing to delete non-UUID test user "${userId}".`);
    return false;
  }
  try {
    const serviceRole = await getServiceRoleKey({
      projectId,
      organizationSlug,
    });
    const response = await fetchWithRetry(
      `${projectUrl}/auth/v1/admin/users/${userId}`,
      {
        method: "DELETE",
        headers: adminHeaders(serviceRole),
      },
      `Delete test user ${userId}`,
    );
    // A 404 means it's already gone — treat as success so we clear the column.
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${detail}`);
    }
    logger.info(`Deleted test user ${userId} for project ${projectId}`);
    return true;
  } catch (error) {
    logger.warn(
      `Failed to delete test user ${userId} for project ${projectId} (will be retried on next launch if still tracked): ${error}`,
    );
    return false;
  }
}

async function persistTestUserId(appId: number, userId: string): Promise<void> {
  await db
    .update(apps)
    .set({ supabaseTestUserId: userId })
    .where(eq(apps.id, appId));
}
