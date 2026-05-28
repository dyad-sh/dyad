# ts-pg-schema-diff

Strict TypeScript PostgreSQL schema diff library.

## API

```ts
import { Client } from "pg";
import { generateSchemaDiff } from "ts-pg-schema-diff";

const diff = await generateSchemaDiff({
  currentDatabaseUrl,
  desiredDatabaseUrl,
  connection: {
    ssl: true,
    maxConnections: 1,
    connectionTimeoutMs: 10_000,
    queryTimeoutMs: 30_000,
  },
});

const sqlScript = diff.statements
  .map((statement) => `${statement.sql};`)
  .join("\n\n");

const client = new Client({ connectionString: currentDatabaseUrl });
await client.connect();
try {
  for (const statement of diff.statements) {
    await client.query(statement.sql);
  }
} finally {
  await client.end();
}
```

`generateSchemaDiff` returns:

```ts
type SchemaDiffResult = {
  readonly statements: readonly {
    readonly sql: string;
    readonly type: "destructive" | "additive";
  }[];
};
```

Execute statements sequentially against `currentDatabaseUrl` to move it toward `desiredDatabaseUrl`.
Do not wrap the whole result in one transaction: PostgreSQL rejects `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` inside transaction blocks. If your executor requires a single transaction, call `generateSchemaDiff({ currentDatabaseUrl, desiredDatabaseUrl, noConcurrentIndexOperations: true })` and review the stronger locking behavior before applying.

Connection options are passed to the underlying `pg` pool for both databases. The default pool size is `1` per database because introspection only needs one checked-out connection per side.

## Type Checking

This project is intentionally strict: `npm run verify` runs `tsc --noEmit` and the default Vitest unit suite. Integration tests require a local PostgreSQL harness and can be run separately with `npm run test:integration`.
