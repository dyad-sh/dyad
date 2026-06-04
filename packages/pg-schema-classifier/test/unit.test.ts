import { describe, expect, it } from "vitest";
import { detectSqlSchemaMutation } from "../src/index.js";

describe("detectSqlSchemaMutation", () => {
  it("does not flag ordinary reads or DML", () => {
    for (const sql of [
      "SELECT * FROM users",
      "WITH active AS (SELECT * FROM users) SELECT * FROM active",
      "INSERT INTO users (name) VALUES ('Ada')",
      "UPDATE users SET name = 'Ada'",
      "DELETE FROM users WHERE id = 1",
      "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN UPDATE SET name = incoming.name",
      "BEGIN; COMMIT;",
      "SET search_path TO public",
      "EXPLAIN SELECT * FROM users",
    ]) {
      expect(detectSqlSchemaMutation(sql).mutatesSchema, sql).toBe(false);
    }
  });

  it("flags direct schema definition statements", () => {
    for (const sql of [
      "CREATE TABLE users (id bigint)",
      "CREATE OR REPLACE FUNCTION answer() RETURNS int LANGUAGE sql RETURN 1",
      "ALTER TABLE users ADD COLUMN email text",
      "DROP VIEW old_users",
      "IMPORT FOREIGN SCHEMA public FROM SERVER foreign_server INTO public",
    ]) {
      expect(detectSqlSchemaMutation(sql).mutatesSchema, sql).toBe(true);
    }
  });

  it("flags authorization, metadata, and dynamic execution", () => {
    for (const sql of [
      "GRANT SELECT ON TABLE users TO app_user",
      "REVOKE SELECT ON TABLE users FROM app_user",
      "COMMENT ON TABLE users IS 'Application users'",
      "SECURITY LABEL ON TABLE users IS 'classified'",
      "DO $$ BEGIN EXECUTE 'ALTER TABLE users ADD COLUMN x int'; END $$",
      "CALL run_migration()",
    ]) {
      expect(detectSqlSchemaMutation(sql).mutatesSchema, sql).toBe(true);
    }
  });

  it("flags select into table creation", () => {
    expect(
      detectSqlSchemaMutation("SELECT id, name INTO archived_users FROM users")
        .mutatesSchema,
    ).toBe(true);
    expect(
      detectSqlSchemaMutation(
        "WITH active AS (SELECT * FROM users) SELECT * INTO active_users FROM active",
      ).mutatesSchema,
    ).toBe(true);
  });

  it("flags known extension functions that mutate schema", () => {
    for (const sql of [
      "SELECT AddGeometryColumn('public', 'roads', 'geom', 4326, 'LINESTRING', 2)",
      "SELECT public.DropGeometryColumn('roads', 'geom')",
      "SELECT create_hypertable('metrics', 'ts')",
      `SELECT "create_hypertable"('metrics', 'ts')`,
      "SELECT * FROM create_hypertable('metrics', by_range('ts'))",
      "SELECT create_distributed_table('events', 'tenant_id')",
      "SELECT partman.create_parent('public.events', 'created_at', 'native', 'daily')",
      "SELECT CreateTopology('my_topo', 4326)",
      "SELECT dblink_exec('dbname=app', 'CREATE TABLE remote_t (id int)')",
    ]) {
      const result = detectSqlSchemaMutation(sql);
      expect(result.mutatesSchema, sql).toBe(true);
      expect(result.statements[0]?.reason, sql).toBe("schema_function");
    }
  });

  it("flags cron functions only when schema-qualified", () => {
    expect(
      detectSqlSchemaMutation(
        "SELECT cron.schedule('nightly', '0 3 * * *', 'VACUUM')",
      ).mutatesSchema,
    ).toBe(true);
    expect(
      detectSqlSchemaMutation(
        `SELECT "cron"."schedule"('nightly', '0 3 * * *', 'VACUUM')`,
      ).mutatesSchema,
    ).toBe(true);

    // A user-defined function that happens to be named `schedule` is not pg_cron.
    expect(
      detectSqlSchemaMutation("SELECT schedule(meeting_id, '2026-01-01')")
        .mutatesSchema,
    ).toBe(false);
    expect(
      detectSqlSchemaMutation(
        "SELECT cron = schedule(meeting_id, '2026-01-01') FROM meetings",
      ).mutatesSchema,
    ).toBe(false);
  });

  it("does not flag ordinary or read-only function calls", () => {
    for (const sql of [
      "SELECT count(*) FROM users",
      `SELECT "into" FROM users`,
      "SELECT avg(price), max(created_at) FROM orders",
      "SELECT ST_Distance(a.geom, b.geom) FROM places a, places b",
      "SELECT similarity(name, 'ada') FROM users",
      "SELECT * FROM generate_series(1, 100)",
      "SELECT calculate_tax(subtotal, region) FROM cart",
      "SELECT nextval('orders_id_seq')",
    ]) {
      expect(detectSqlSchemaMutation(sql).mutatesSchema, sql).toBe(false);
    }
  });

  it("detects an extension function nested in DML", () => {
    expect(
      detectSqlSchemaMutation(
        "INSERT INTO log SELECT create_hypertable('metrics', 'ts')",
      ).mutatesSchema,
    ).toBe(true);
  });

  it("does not flag non-executing EXPLAIN wrappers", () => {
    for (const sql of [
      "EXPLAIN SELECT create_hypertable('metrics', 'ts')",
      "EXPLAIN (FORMAT JSON) SELECT create_hypertable('metrics', 'ts')",
      "EXPLAIN (ANALYZE false) SELECT create_hypertable('metrics', 'ts')",
      "EXPLAIN (ANALYZE off) SELECT create_hypertable('metrics', 'ts')",
    ]) {
      expect(detectSqlSchemaMutation(sql).mutatesSchema, sql).toBe(false);
    }
  });

  it("flags executing EXPLAIN ANALYZE wrappers", () => {
    for (const sql of [
      "EXPLAIN ANALYZE SELECT create_hypertable('metrics', 'ts')",
      "EXPLAIN (ANALYZE, BUFFERS) SELECT create_hypertable('metrics', 'ts')",
      "EXPLAIN (VERBOSE, ANALYZE true) SELECT create_hypertable('metrics', 'ts')",
    ]) {
      expect(detectSqlSchemaMutation(sql).mutatesSchema, sql).toBe(true);
    }
  });

  it("handles mixed multi-statement SQL", () => {
    const result = detectSqlSchemaMutation(`
      SELECT * FROM users;
      CREATE TABLE audit_log (id bigint);
      UPDATE users SET name = 'Ada';
    `);

    expect(result.mutatesSchema).toBe(true);
    expect(
      result.statements.map((statement) => statement.mutatesSchema),
    ).toEqual([false, true, false]);
  });

  it("ignores semicolons and keywords inside quoted regions and comments", () => {
    const result = detectSqlSchemaMutation(`
      SELECT 'CREATE TABLE nope (id int);' AS sql;
      SELECT $$DROP TABLE nope;$$ AS sql;
      -- ALTER TABLE nope ADD COLUMN x int;
      /* DROP TABLE nope; */
      SELECT "from" FROM users;
    `);

    expect(result.mutatesSchema).toBe(false);
    expect(result.statements).toHaveLength(3);
  });

  it("keeps dollar-quoted function bodies in one mutating statement", () => {
    const result = detectSqlSchemaMutation(`
      CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM 1;
      END;
      $$;
    `);

    expect(result.mutatesSchema).toBe(true);
    expect(result.statements).toHaveLength(1);
  });

  it("classifies incomplete SQL as mutating", () => {
    const result = detectSqlSchemaMutation("SELECT 'unterminated");

    expect(result.mutatesSchema).toBe(true);
    expect(result.statements[0]).toMatchObject({
      mutatesSchema: true,
      reason: "unparseable_or_incomplete",
    });
  });
});
