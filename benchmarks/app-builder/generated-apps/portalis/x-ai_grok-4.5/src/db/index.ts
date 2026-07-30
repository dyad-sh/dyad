import { neon, neonConfig, Pool, type QueryResultRow } from "@neondatabase/serverless";
import ws from "ws";

// Required for Neon Pool in Node.js
neonConfig.webSocketConstructor = ws;

export const sql = neon(process.env.DATABASE_URL!);

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

/**
 * Template-tag query helper that works with either neon() or a Pool client.
 */
export function createSql(queryable: Queryable) {
  return async function txSql<T extends QueryResultRow = QueryResultRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> {
    let text = "";
    const params: unknown[] = [];
    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i < values.length) {
        params.push(values[i]);
        text += `$${params.length}`;
      }
    }
    const result = await queryable.query<T>(text, params);
    return result.rows;
  };
}

export type TxSql = ReturnType<typeof createSql>;

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  }
  return pool;
}

export async function withTransaction<T>(
  fn: (tx: TxSql) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  const tx = createSql(client);
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}
