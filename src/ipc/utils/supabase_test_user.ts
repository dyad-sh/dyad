import crypto from "node:crypto";
import log from "electron-log";
import { eq, isNotNull } from "drizzle-orm";

import { db } from "../../db";
import { apps } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { fetchWithRetry } from "@/ipc/utils/retryWithRateLimit";
import { retryTestDatabaseCleanup } from "./test_database_cleanup_retry";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import { executeSupabaseSql } from "../../supabase_admin/supabase_management_client";

import {
  getSupabaseAdminKey,
  type AdminKey,
} from "../../supabase_admin/supabase_admin_key";

export type { AdminKey } from "../../supabase_admin/supabase_admin_key";

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

for (const column of OWNER_COLUMNS) {
  if (!SAFE_IDENT_RE.test(column)) {
    throw new Error(`Unsafe Supabase test-user owner column: ${column}`);
  }
}

function projectUrlFor(ref: string): string {
  return `https://${ref}.supabase.co`;
}

/**
 * Test setup uses the shared main-process key fetcher. Only the Playwright
 * runner receives the admin key for Node fixtures; sandbox installs and app
 * servers receive public keys and temporary user credentials only.
 */
export const getServiceRoleKey = getSupabaseAdminKey;

/**
 * Authorization headers for the project's Auth Admin REST API.
 *
 * A new-format secret key goes on `apikey` ALONE. It isn't a JWT, and Supabase
 * documents that passing it on `Authorization: Bearer` — which many Supabase
 * clients still do by default — makes the platform try to parse it as one and
 * reject the request with "Invalid JWT". The legacy `service_role` key IS a
 * JWT and still needs the bearer header, so unmigrated projects keep working.
 *
 * https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
 */
function adminHeaders(key: AdminKey): Record<string, string> {
  return {
    apikey: key.apiKey,
    ...(key.isLegacyJwt ? { Authorization: `Bearer ${key.apiKey}` } : {}),
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
  options: { adminKey?: AdminKey; signal?: AbortSignal } = {},
): Promise<TempTestUser> {
  options.signal?.throwIfAborted();
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
      ...options,
    });
    if (!priorCleanupOk) {
      throw new DyadError(
        `Couldn't clean up the previous Supabase test user for app ${appData.id}. Skipping this run to avoid leaking a test user; it will be retried on the next launch.`,
        DyadErrorKind.External,
      );
    }
  }

  const adminKey =
    options.adminKey ??
    (await getServiceRoleKey({ projectId, organizationSlug }));
  // fetchWithRetry (not a bare fetch in retryWithRateLimit): fetch resolves on
  // a 429 rather than throwing, so only the throwing wrapper actually retries
  // when back-to-back runs hit the Auth Admin rate limit.
  const response = await fetchWithRetry(
    `${projectUrl}/auth/v1/admin/users`,
    {
      method: "POST",
      // Drain an accepted create until its ID is persisted. Aborting the HTTP
      // response can leave a remotely-created user with no recovery marker.
      // Cancellation still stops retries; the lifecycle reports a slow drain.
      headers: adminHeaders(adminKey),
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
    { signal: options.signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // The project turned its legacy keys off and had no secret key for us to
    // use instead. That's fixable in the Supabase dashboard, so say how rather
    // than surfacing raw Supabase JSON as an unexplained External failure.
    if (response.status === 401 && /legacy api keys/i.test(detail)) {
      throw new DyadError(
        "This Supabase project has its legacy API keys (anon, service_role) disabled, and Dyad couldn't find a secret key to use instead. Create a secret key in Supabase under Settings → API Keys, then run the tests again.",
        DyadErrorKind.Precondition,
      );
    }
    // `bad_jwt` means Supabase tried to read a JWT it couldn't parse. With a
    // new-format secret key that points at the key itself rather than at
    // anything the user did, so say which key was used instead of surfacing an
    // opaque 403 (see adminHeaders for why it travels on `apikey` alone).
    if (
      (response.status === 401 || response.status === 403) &&
      /bad_jwt|invalid jwt/i.test(detail)
    ) {
      throw new DyadError(
        `Supabase rejected the ${adminKey.isLegacyJwt ? "legacy service_role" : "secret"} key Dyad used to create the test user (${response.status}). ${detail}`,
        DyadErrorKind.External,
      );
    }
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
        adminKey,
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
export async function deleteTempTestUser(
  appData: AppRow,
  options: { adminKey?: AdminKey; signal?: AbortSignal } = {},
): Promise<boolean> {
  options.signal?.throwIfAborted();
  const userId = appData.supabaseTestUserId;
  const projectId = appData.supabaseProjectId;
  const organizationSlug = appData.supabaseOrganizationSlug;
  if (!userId || !projectId || !organizationSlug) {
    return true;
  }
  if (IS_TEST_BUILD) {
    await db
      .update(apps)
      .set({ supabaseTestUserId: null })
      .where(eq(apps.id, appData.id));
    return true;
  }

  // Sweep the user's rows FIRST so a `restrict`/`no action` FK to auth.users
  // doesn't block the user delete below.
  await cleanUpRowsOwnedBy({
    projectId,
    organizationSlug,
    userId,
    signal: options.signal,
  });

  // Only forget the user once Supabase confirms it's gone. Clearing the column
  // on a failed delete would orphan the user, since the startup reconciliation
  // sweep relies on this id to find it again.
  const projectUrl = projectUrlFor(projectId);
  const deleted = await deleteUserBestEffort({
    projectUrl,
    projectId,
    organizationSlug,
    userId,
    ...options,
  });
  if (deleted) {
    await db
      .update(apps)
      .set({ supabaseTestUserId: null })
      .where(eq(apps.id, appData.id));
  }
  return deleted;
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
        await appOperationCoordinator.run(
          {
            appId: appData.id,
            operation: "reconcile-supabase-test-user",
            resources: ["provider", "runtime-config"],
          },
          () => deleteTempTestUser(appData),
        );
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
  signal,
}: {
  projectId: string;
  organizationSlug: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (!UUID_RE.test(userId)) {
    // The id comes from Supabase, but never interpolate a non-UUID into SQL.
    logger.warn(
      `Refusing to clean up rows for non-UUID test user "${userId}".`,
    );
    return;
  }
  try {
    // pg_class rather than information_schema.columns: the latter also lists
    // views, which can't be deleted from (55000) and cost a wasted round trip
    // each. Ordinary and partitioned tables only; partitions are swept via
    // their parent.
    const discoverQuery = `SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND NOT c.relispartition
  AND a.attname IN (${OWNER_COLUMNS.map((c) => `'${c}'`).join(", ")});`;
    const raw = await retryTestDatabaseCleanup(
      () =>
        executeSupabaseSql({
          supabaseProjectId: projectId,
          query: discoverQuery,
          organizationSlug,
          signal,
        }),
      `Discover cleanup owner columns for test user ${userId}`,
      signal,
    );
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }
    const targets: { label: string; statement: string }[] = [];
    for (const row of rows) {
      const table = String(row?.table_name ?? "");
      const column = String(row?.column_name ?? "");
      if (!SAFE_IDENT_RE.test(table) || !SAFE_IDENT_RE.test(column)) {
        continue;
      }
      // Belt-and-suspenders: the static `$dyad_cleanup$` dollar-quote tag below
      // is only safe as long as no interpolated value can contain `$`. SAFE_IDENT_RE
      // already forbids it, but enforce the invariant explicitly here so relaxing
      // that regex can never silently open a dollar-quote breakout.
      if (table.includes("$") || column.includes("$")) {
        continue;
      }
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
      targets.push({
        label: `public.${table}.${column}`,
        statement: `EXECUTE format('DELETE FROM public.%I WHERE %I = %L', '${table}', '${column}', '${userId}');`,
      });
    }
    if (targets.length === 0) {
      return;
    }
    const runCleanup = (query: string, context: string) =>
      retryTestDatabaseCleanup(
        () =>
          executeSupabaseSql({
            supabaseProjectId: projectId,
            query,
            organizationSlug,
            signal,
          }),
        context,
        signal,
      );
    // Fast path: one round trip for every table, since per-test isolation runs
    // this before each case. Each DELETE gets its own exception block (a
    // subtransaction) so one failing table — an FK restrict, a non-uuid owner
    // column — doesn't roll back the others. A DO block can't return rows, so
    // the batch is a session-temporary function whose result carries each
    // table's error back for the same per-table log line as the fallback.
    let batchResult: string | undefined;
    try {
      batchResult = await runCleanup(
        `CREATE OR REPLACE FUNCTION pg_temp.dyad_cleanup() RETURNS text[] LANGUAGE plpgsql AS $dyad_cleanup$
DECLARE failures text[] := '{}';
BEGIN ${targets
          .map(
            ({ label, statement }) =>
              `BEGIN ${statement} EXCEPTION WHEN others THEN failures := failures || ('${label}: ' || SQLERRM); END;`,
          )
          .join(" ")} RETURN failures; END $dyad_cleanup$;
SELECT pg_temp.dyad_cleanup() AS failures;`,
        `Clean up ${targets.length} owner column(s) for test user ${userId}`,
      );
    } catch (error) {
      signal?.throwIfAborted();
      // `WHEN others` can't catch QUERY_CANCELED, so a statement timeout rolls
      // back the whole batch, including deletes that had succeeded. Fall back
      // to one committed request per table. If that outruns the lifecycle
      // budget, the abort propagates before the user is deleted, keeping the
      // recovery marker so startup reconciliation retries the sweep.
      logger.warn(
        `Batched cleanup for test user failed; retrying per table: ${error}`,
      );
    }
    if (batchResult !== undefined) {
      // The deletes committed; reporting is best-effort. An unexpected response
      // shape just means no per-table detail, never a rerun of the sweep.
      for (const failure of parseCleanupFailures(batchResult)) {
        logger.warn(`Best-effort cleanup for test user failed: ${failure}`);
      }
      return;
    }
    for (const { label, statement } of targets) {
      try {
        await runCleanup(
          `DO $dyad_cleanup$ BEGIN ${statement} END $dyad_cleanup$;`,
          `Clean up ${label} for test user ${userId}`,
        );
      } catch (error) {
        signal?.throwIfAborted();
        logger.warn(
          `Best-effort cleanup of ${label} for test user failed: ${error}`,
        );
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    logger.warn(`Could not discover owner columns for cleanup: ${error}`);
  }
}

/**
 * Reads the per-table errors the batched cleanup returns as
 * `[{ failures: ["public.t.c: <error>", ...] }]`. Anything else yields none.
 */
function parseCleanupFailures(raw: string): string[] {
  try {
    const rows = JSON.parse(raw);
    const failures = Array.isArray(rows) ? rows[0]?.failures : undefined;
    return Array.isArray(failures) ? failures.map(String) : [];
  } catch {
    return [];
  }
}

async function deleteUserBestEffort({
  projectUrl,
  projectId,
  organizationSlug,
  userId,
  adminKey: cachedAdminKey,
  signal,
}: {
  projectUrl: string;
  projectId: string;
  organizationSlug: string;
  userId: string;
  adminKey?: AdminKey;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (!UUID_RE.test(userId)) {
    // The id comes from Supabase (or a possibly-corrupted DB column), but never
    // interpolate a non-UUID into the admin API URL path.
    logger.warn(`Refusing to delete non-UUID test user "${userId}".`);
    return false;
  }
  try {
    const adminKey =
      cachedAdminKey ??
      (await getServiceRoleKey({
        projectId,
        organizationSlug,
      }));
    const response = await retryTestDatabaseCleanup(
      () =>
        fetchWithRetry(
          `${projectUrl}/auth/v1/admin/users/${userId}`,
          {
            method: "DELETE",
            signal,
            headers: adminHeaders(adminKey),
          },
          `Delete test user ${userId}`,
        ),
      `Delete test user ${userId}`,
      signal,
    );
    // A 404 means it's already gone — treat as success so we clear the column.
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${detail}`);
    }
    logger.info(`Deleted test user ${userId} for project ${projectId}`);
    return true;
  } catch (error) {
    signal?.throwIfAborted();
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
