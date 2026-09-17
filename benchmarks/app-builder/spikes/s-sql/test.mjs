// S-SQL protocol tests: real @neondatabase/serverless driver -> proxy.mjs -> local Postgres.
// Covers exactly the call shapes Dyad uses (src/neon_admin/neon_context.ts):
//   sql.query(text, [])           (executeNeonSql, getNeonProjectInfo, getNeonTableSchema)
//   sql.transaction(txn => [...]) (executeNeonStatementsInTransaction)
// plus tagged templates + type fidelity + error shape (neon_errors.ts reads .message).
import { neon, neonConfig } from "@neondatabase/serverless";
import assert from "node:assert/strict";

neonConfig.fetchEndpoint = "http://127.0.0.1:7790/sql";
neonConfig.poolQueryViaFetch = false;

const URI = "postgresql://mini:none@db.localtest.me/spike_ssql";
const sql = neon(URI);

let passed = 0;
async function t(name, fn) {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

await t("reset schema", async () => {
  await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;", []);
});

await t(
  "multi-statement query with empty params (dyad-execute-sql shape)",
  async () => {
    const r = await sql.query(
      `CREATE TABLE users (id serial primary key, name text not null, active boolean default true, created_at timestamptz default now(), meta jsonb);
     CREATE TABLE posts (id serial primary key, user_id int references users(id), title text);`,
      [],
    );
    assert.ok(Array.isArray(r));
  },
);

await t("tagged template with interpolated params", async () => {
  const name = "Ada Lovelace";
  const meta = { role: "admin", tags: ["a", "b"] };
  const rows =
    await sql`INSERT INTO users (name, meta) VALUES (${name}, ${meta}) RETURNING id, name, active, created_at, meta`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Ada Lovelace");
  assert.equal(rows[0].active, true);
  assert.ok(rows[0].created_at instanceof Date);
  assert.deepEqual(rows[0].meta, meta);
  assert.equal(typeof rows[0].id, "number");
});

await t("sql.query(text, params) returns array of row objects", async () => {
  const rows = await sql.query("SELECT id, name FROM users WHERE name = $1", [
    "Ada Lovelace",
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Ada Lovelace");
});

await t(
  "type fidelity: int, text, bool, timestamptz, json, null, numeric, bigint",
  async () => {
    const rows = await sql.query(
      `SELECT 42 as i, 'x' as t, true as b, now() as ts, '{"k":1}'::jsonb as j,
            NULL as n, 1.5::numeric as num, 9007199254740993::bigint as big`,
      [],
    );
    const r = rows[0];
    assert.equal(r.i, 42);
    assert.equal(r.t, "x");
    assert.equal(r.b, true);
    assert.ok(r.ts instanceof Date);
    assert.deepEqual(r.j, { k: 1 });
    assert.equal(r.n, null);
    assert.equal(r.num, "1.5"); // numeric stays string in pg-types
    assert.equal(r.big, "9007199254740993"); // int8 stays string
  },
);

await t(
  "transaction batch commits atomically (Dyad migration-apply shape)",
  async () => {
    await sql.transaction((txn) => [
      txn.query("INSERT INTO users (name) VALUES ('t1')", []),
      txn.query("INSERT INTO users (name) VALUES ('t2')", []),
    ]);
    const rows = await sql.query(
      "SELECT count(*)::int AS c FROM users WHERE name LIKE 't%'",
      [],
    );
    assert.equal(rows[0].c, 2);
  },
);

await t("failing statement rolls back whole batch", async () => {
  let threw = null;
  try {
    await sql.transaction((txn) => [
      txn.query("INSERT INTO users (name) VALUES ('t3')", []),
      txn.query("INSERT INTO nonexistent_table (x) VALUES (1)", []),
    ]);
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "transaction should throw");
  const rows = await sql.query(
    "SELECT count(*)::int AS c FROM users WHERE name = 't3'",
    [],
  );
  assert.equal(rows[0].c, 0, "t3 must be rolled back");
});

await t("error shape: pg fields surface on the driver error", async () => {
  let err = null;
  try {
    await sql.query("SELECT * FROM definitely_missing", []);
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.match(err.message, /definitely_missing/);
  assert.equal(err.code, "42P01"); // undefined_table
  assert.equal(err.severity, "ERROR");
  assert.ok(err.position, "position should be set");
  assert.equal(err.name, "NeonDbError");
});

await t(
  "constraint violation carries schema/table/constraint fields",
  async () => {
    let err = null;
    try {
      await sql.query("INSERT INTO users (id, name) VALUES (1, 'dup')", []);
      await sql.query("INSERT INTO users (id, name) VALUES (1, 'dup2')", []);
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.equal(err.code, "23505"); // unique_violation
    assert.equal(err.table, "users");
    assert.equal(err.constraint, "users_pkey");
  },
);

await t("Dyad TABLE_NAMES_QUERY (verbatim from neon_context.ts)", async () => {
  const rows = await sql.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name;`,
    [],
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    ["posts", "users"],
  );
});

console.log(`\nALL ${passed} PROTOCOL TESTS PASSED`);
process.exit(0);
