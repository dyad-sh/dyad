import { neon } from "@neondatabase/serverless";
import { IS_TEST_BUILD } from "./test_utils";

interface TestDatabaseTable {
  schema_name: string;
  table_name: string;
}

// These are service metadata, not test-user data. Removing project_config
// makes every auth request fail with "Project config not found"; jwks holds
// the signing keys the service and its clients use to verify tokens.
const NEON_AUTH_SERVICE_TABLES = new Set(["project_config", "jwks"]);

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Only call with the connection URL returned by createTempTestBranch. */
export async function clearNeonTestData(databaseUrl: string): Promise<void> {
  if (IS_TEST_BUILD) return;
  // Discover tables on every cleanup: a case may have created another schema
  // or table. Include auth users, sessions, accounts, verification tokens, and
  // organization data while preserving the managed auth service itself.
  const sql = neon(databaseUrl);
  const tables = (await sql.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
       AND n.nspname <> 'information_schema'
     ORDER BY n.nspname, c.relname
  `)) as TestDatabaseTable[];
  const dataTables = tables.filter(
    ({ schema_name, table_name }) =>
      schema_name !== "neon_auth" || !NEON_AUTH_SERVICE_TABLES.has(table_name),
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
