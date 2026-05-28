import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { ConnectionOptions } from "node:tls";

export type DatabaseClient = Pick<PoolClient, "query">;

export type DatabaseConnectionOptions = {
  readonly ssl?: boolean | ConnectionOptions;
  readonly maxConnections?: number;
  readonly connectionTimeoutMs?: number;
  readonly queryTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
};

export async function withDatabaseClient<T>(
  databaseUrl: string,
  options: DatabaseConnectionOptions,
  callback: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const pool = new Pool(buildPoolConfig(databaseUrl, options));
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    return await callback(client);
  } finally {
    client?.release();
    await pool.end();
  }
}

export function buildPoolConfig(
  connectionString: string,
  options: DatabaseConnectionOptions = {},
): PoolConfig {
  const sessionOptions: string[] = [];
  if (options.statementTimeoutMs !== undefined) {
    sessionOptions.push(`-c statement_timeout=${options.statementTimeoutMs}`);
  }
  if (options.lockTimeoutMs !== undefined) {
    sessionOptions.push(`-c lock_timeout=${options.lockTimeoutMs}`);
  }

  return {
    connectionString,
    max: options.maxConnections ?? 1,
    ssl: options.ssl,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    query_timeout: options.queryTimeoutMs,
    options: sessionOptions.length === 0 ? undefined : sessionOptions.join(" "),
  };
}
