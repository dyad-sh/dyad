import { neon } from "@neondatabase/serverless";
import { IS_TEST_BUILD } from "./test_utils";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

interface TestDatabaseTable {
  schema_name: string;
  table_name: string;
  extension_owned: boolean;
}

// These are service metadata, not test-user data. Removing project_config
// makes every auth request fail with "Project config not found"; jwks holds
// the signing keys the service and its clients use to verify tokens.
const NEON_AUTH_SERVICE_TABLES = new Set(["project_config", "jwks"]);
const MIGRATION_SCHEMAS = new Set(["drizzle", "supabase_migrations"]);
const MIGRATION_TABLES = new Set([
  "__drizzle_migrations",
  "_prisma_migrations",
  "schema_migrations",
  "knex_migrations",
  "knex_migrations_lock",
  "SequelizeMeta",
]);

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Verify the target once per run, before exposing any destructive operation. */
export async function createNeonTestDataCleaner({
  databaseUrl,
  projectId,
  branchId,
  protectedBranchIds,
}: {
  databaseUrl: string;
  projectId: string;
  branchId: string;
  protectedBranchIds: (string | null)[];
}): Promise<(signal?: AbortSignal) => Promise<void>> {
  if (!branchId || protectedBranchIds.includes(branchId)) {
    throw new DyadError(
      "Refusing to clear a non-test Neon branch.",
      DyadErrorKind.Precondition,
    );
  }
  if (IS_TEST_BUILD) return async () => {};
  const client = await getNeonClient();
  const { data } = await client.listProjectBranchEndpoints(projectId, branchId);
  const host = new URL(databaseUrl).hostname.replace(/-pooler(?=\.)/, "");
  if (
    !data.endpoints.some(
      (endpoint) => endpoint.branch_id === branchId && endpoint.host === host,
    )
  ) {
    throw new DyadError(
      "Refusing to clear a database outside the temporary Neon branch.",
      DyadErrorKind.Precondition,
    );
  }
  return (signal) => clearNeonTestData(databaseUrl, signal);
}

async function clearNeonTestData(
  databaseUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  // Discover tables on every cleanup: a case may have created another schema
  // or table. Include auth users, sessions, accounts, verification tokens, and
  // organization data while preserving the managed auth service itself.
  const sql = neon(databaseUrl, { fetchOptions: { signal } });
  const tables = (await sql.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name,
           EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                AND d.deptype = 'e'
           ) AS extension_owned
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
       AND n.nspname <> 'information_schema'
     ORDER BY n.nspname, c.relname
  `)) as TestDatabaseTable[];
  const dataTables = tables.filter(
    ({ schema_name, table_name, extension_owned }) =>
      !extension_owned &&
      !MIGRATION_SCHEMAS.has(schema_name) &&
      !MIGRATION_TABLES.has(table_name) &&
      (schema_name !== "neon_auth" ||
        !NEON_AUTH_SERVICE_TABLES.has(table_name)),
  );
  if (dataTables.length === 0) return;

  // A single statement handles cross-schema foreign keys atomically and
  // resets owned sequences. RESTRICT ensures a new FK from a preserved table
  // fails cleanup rather than silently cascading into auth configuration.
  await sql.query(
    `TRUNCATE TABLE ${dataTables
      .map(
        ({ schema_name, table_name }) =>
          `${quoteIdentifier(schema_name)}.${quoteIdentifier(table_name)}`,
      )
      .join(", ")} RESTART IDENTITY RESTRICT`,
  );
}
