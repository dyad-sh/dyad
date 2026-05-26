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

export function buildPoolConfig(connectionString: string, options: DatabaseConnectionOptions = {}): PoolConfig {
  return {
    connectionString,
    max: options.maxConnections ?? 1,
    ssl: options.ssl,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    query_timeout: options.queryTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
    lock_timeout: options.lockTimeoutMs,
  };
}
