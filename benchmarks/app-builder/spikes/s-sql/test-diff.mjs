// ts-pg-schema-diff spike: exactly Dyad's invocation (migration_utils.ts:142-148
// + MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS with hardcoded ssl:true) against
// local Postgres, plus the HTTP-driver schema-snapshot path used by
// getNeonTableSchema (neon_context.ts:347-363).
// Run with: NODE_EXTRA_CA_CERTS=certs/ca.pem node test-diff.mjs
import { neon, neonConfig } from "@neondatabase/serverless";
import assert from "node:assert/strict";
import {
  generateSchemaDiff,
  buildSchemaSnapshotSql,
  getSchemaFromSnapshot,
} from "ts-pg-schema-diff";

neonConfig.fetchEndpoint = "http://127.0.0.1:7790/sql";

const CONN_OPTS = {
  // verbatim from src/ipc/utils/migration_utils.ts:25-32
  ssl: true,
  maxConnections: 1,
  connectionTimeoutMs: 30_000,
  queryTimeoutMs: 120_000,
  statementTimeoutMs: 120_000,
  lockTimeoutMs: 30_000,
};

let passed = 0;
function ok(name) {
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

// -- setup two schema-divergent databases via the HTTP driver ---------------
const admin = neon("postgresql://mini:none@db.localtest.me/spike_ssql");
await admin.query("DROP DATABASE IF EXISTS spike_diff_cur", []);
await admin.query("DROP DATABASE IF EXISTS spike_diff_des", []);
await admin.query("CREATE DATABASE spike_diff_cur", []);
await admin.query("CREATE DATABASE spike_diff_des", []);
const cur = neon("postgresql://mini:none@db.localtest.me/spike_diff_cur");
const des = neon("postgresql://mini:none@db.localtest.me/spike_diff_des");
await cur.query("CREATE TABLE items (id serial primary key, name text)", []);
await des.query(
  `CREATE TABLE items (id serial primary key, name text, price numeric not null default 0);
   CREATE TABLE orders (id serial primary key, item_id int references items(id), qty int);`,
  [],
);
ok("setup: two divergent databases created through the HTTP driver");

// -- 1. schema snapshot through the HTTP driver (getNeonTableSchema path) ---
const snapshotRows = await des.query(
  buildSchemaSnapshotSql({ includeSchemas: ["public"] }),
  [],
);
assert.ok(snapshotRows.length > 0, "snapshot query returns rows");
const snapshot = snapshotRows[0]?.schema_snapshot;
assert.ok(snapshot !== undefined, "schema_snapshot column present");
const schema = await getSchemaFromSnapshot(snapshot);
assert.deepEqual(schema.tables.map((t) => t.name.escapedName).sort(), [
  '"items"',
  '"orders"',
]);
ok("buildSchemaSnapshotSql + getSchemaFromSnapshot through HTTP driver");

// -- 2. generateSchemaDiff with Dyad's ssl:true against PLAIN postgres ------
let plainErr = null;
try {
  await generateSchemaDiff({
    currentDatabaseUrl: "postgresql://mini@127.0.0.1:5432/spike_diff_cur",
    desiredDatabaseUrl: "postgresql://mini@127.0.0.1:5432/spike_diff_des",
    includeSchemas: ["public"],
    noConcurrentIndexOperations: true,
    connection: CONN_OPTS,
  });
} catch (e) {
  plainErr = e;
}
assert.ok(plainErr, "ssl:true against no-SSL postgres must fail");
console.log(
  `   (plain-postgres failure as expected: ${plainErr.message.slice(0, 80)})`,
);
ok(
  "CONFIRMED: ssl:true fails against no-SSL local postgres (mitigation needed)",
);

// -- 3. mitigation: TLS front on :5433, zero Dyad patch ---------------------
const diff = await generateSchemaDiff({
  currentDatabaseUrl: "postgresql://mini@localhost:5433/spike_diff_cur",
  desiredDatabaseUrl: "postgresql://mini@localhost:5433/spike_diff_des",
  includeSchemas: ["public"],
  noConcurrentIndexOperations: true,
  connection: CONN_OPTS,
});
assert.ok(diff.statements.length >= 2, "diff produces statements");
const sqlText = diff.statements.map((s) => s.sql).join("\n");
assert.match(sqlText, /price/);
assert.match(sqlText, /orders/i);
console.log(
  `   (${diff.statements.length} statements, e.g.: ${diff.statements[0].sql.slice(0, 70)})`,
);
ok(
  "generateSchemaDiff with Dyad's verbatim ssl:true options through pg-tls-front",
);

console.log(`\nALL ${passed} DIFF TESTS PASSED`);
process.exit(0);
