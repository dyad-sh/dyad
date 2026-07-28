import { Client } from "pg";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";

const logger = log.scope("postgres_context");

// Socket-based counterpart to neon_context. Neon's HTTP driver batches an
// array of unawaited promises into one request; `pg` does not, so statements
// here are awaited in order inside an explicit BEGIN/COMMIT.

function requiresSsl(connectionString: string): boolean {
  try {
    const mode = new URL(connectionString).searchParams.get("sslmode");
    return mode !== null && mode !== "disable";
  } catch {
    return false;
  }
}

async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString,
    // Managed providers (Neon) require TLS; a self-hosted Postgres reached
    // through an SSH tunnel usually has none, and the tunnel already encrypts.
    ssl: requiresSsl(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Executes a single query and returns its rows as formatted JSON. */
export async function executePostgresSql({
  connectionString,
  query,
}: {
  connectionString: string;
  query: string;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return `[[TEST_POSTGRES_SQL_RESULT: ${query.slice(0, 50)}]]`;
  }
  try {
    return await withClient(connectionString, async (client) => {
      const result = await client.query(query);
      return JSON.stringify(result.rows, null, 2);
    });
  } catch (error) {
    logger.error("Error executing Postgres SQL:", error);
    throw new DyadError(
      `Failed to execute SQL on Postgres: ${
        error instanceof Error ? error.message : String(error)
      }`,
      DyadErrorKind.External,
    );
  }
}

/**
 * Applies statements inside a single transaction. Postgres DDL is
 * transactional, so a failure rolls the whole migration back.
 *
 * Statements that cannot run inside a transaction (e.g.
 * `CREATE INDEX CONCURRENTLY`) are excluded upstream by calling
 * ts-pg-schema-diff with `noConcurrentIndexOperations: true`.
 */
export async function executePostgresStatementsInTransaction({
  connectionString,
  statements,
}: {
  connectionString: string;
  statements: string[];
}): Promise<{ executed: number }> {
  if (IS_TEST_BUILD) {
    return { executed: statements.length };
  }
  if (statements.length === 0) {
    return { executed: 0 };
  }
  try {
    return await withClient(connectionString, async (client) => {
      await client.query("BEGIN");
      try {
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query("COMMIT");
        return { executed: statements.length };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  } catch (error) {
    logger.error("Error applying migration transaction on Postgres:", error);
    throw new DyadError(
      `Failed to apply migration on Postgres (transaction rolled back): ${
        error instanceof Error ? error.message : String(error)
      }`,
      DyadErrorKind.External,
    );
  }
}

/** Confirms a connection string actually reaches a live database. */
export async function testPostgresConnection(
  connectionString: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await withClient(connectionString, (client) => client.query("SELECT 1"));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
