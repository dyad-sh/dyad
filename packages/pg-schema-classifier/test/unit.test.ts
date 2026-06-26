import { describe, expect, it } from "vitest";
import {
  detectSqlDataDeletion,
  detectSqlSchemaMutation,
} from "../src/index.js";

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

describe("detectSqlDataDeletion", () => {
  it("flags direct data deletion statements", () => {
    for (const sql of [
      "DELETE FROM users WHERE id = 1",
      "TRUNCATE events",
      "TRUNCATE TABLE events RESTART IDENTITY",
      "DROP TABLE users",
      "DROP TABLE IF EXISTS users",
      "DROP SCHEMA private CASCADE",
      "DROP SCHEMA IF EXISTS private CASCADE",
      "DROP DATABASE old_app",
      "DROP DATABASE IF EXISTS old_app",
      "ALTER TABLE users DROP COLUMN legacy_id",
      "ALTER TABLE users DROP legacy_id",
      "ALTER TABLE users DROP IF EXISTS legacy_id",
      "ALTER TABLE users DROP COLUMN IF EXISTS legacy_id",
      "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE",
    ]) {
      expect(detectSqlDataDeletion(sql).deletesData, sql).toBe(true);
    }
  });

  it("treats dynamic execution as destructive because the body is opaque", () => {
    for (const sql of [
      "DO $$ BEGIN DELETE FROM users WHERE inactive; END $$",
      "DO $$ BEGIN EXECUTE 'DELETE FROM users'; END $$",
      "CALL delete_inactive_users()",
    ]) {
      const result = detectSqlDataDeletion(sql);
      expect(result.deletesData, sql).toBe(true);
      expect(result.statements[0]?.reason, sql).toBe("dynamic_execution");
    }
  });

  it("treats incomplete SQL as destructive because it gates auto-approval", () => {
    for (const sql of [
      "SELECT 'unterminated",
      "DELETE FROM users -- cleanup",
      "DROP TABLE users -- cleanup",
    ]) {
      const result = detectSqlDataDeletion(sql);
      expect(result.deletesData, sql).toBe(true);
      expect(result.statements[0]?.reason, sql).toBe(
        "unparseable_or_incomplete",
      );
    }
  });

  it("flags data-modifying CTE deletes", () => {
    const result = detectSqlDataDeletion(`
      WITH deleted AS (
        DELETE FROM users WHERE inactive = true RETURNING id
      )
      SELECT * FROM deleted;
    `);

    expect(result.deletesData).toBe(true);
    expect(result.statements[0]?.reason).toBe("data_modifying_cte");
  });

  it("does not flag reads, inserts, updates, comments, or quoted text", () => {
    for (const sql of [
      "SELECT * FROM users",
      "INSERT INTO users (name) VALUES ('Ada')",
      "UPDATE users SET name = 'Ada'",
      "DROP VIEW old_users",
      "ALTER TABLE users DROP CONSTRAINT users_email_key",
      "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key",
      "ALTER TABLE users ALTER COLUMN legacy_id DROP DEFAULT",
      "ALTER TABLE users ALTER COLUMN legacy_id DROP NOT NULL",
      "SELECT 'DELETE FROM users' AS example",
      "-- DELETE FROM users\nSELECT 1",
      "/* TRUNCATE events */ SELECT 1",
      `SELECT $$DELETE FROM users$$ AS example`,
    ]) {
      expect(detectSqlDataDeletion(sql).deletesData, sql).toBe(false);
    }
  });

  it("only flags EXPLAIN-wrapped deletes when the statement executes", () => {
    expect(
      detectSqlDataDeletion("EXPLAIN DELETE FROM users WHERE id = 1")
        .deletesData,
    ).toBe(false);
    expect(
      detectSqlDataDeletion("EXPLAIN ANALYZE DELETE FROM users WHERE id = 1")
        .deletesData,
    ).toBe(true);
    expect(
      detectSqlDataDeletion(
        "EXPLAIN (ANALYZE false) DELETE FROM users WHERE id = 1",
      ).deletesData,
    ).toBe(false);
    expect(
      detectSqlDataDeletion(
        "EXPLAIN (ANALYZE true) DELETE FROM users WHERE id = 1",
      ).deletesData,
    ).toBe(true);
    expect(
      detectSqlDataDeletion("EXPLAIN ANALYZE DROP TABLE users").deletesData,
    ).toBe(true);
    expect(
      detectSqlDataDeletion(
        "EXPLAIN (ANALYZE true) ALTER TABLE users DROP COLUMN legacy_id",
      ).deletesData,
    ).toBe(true);
    expect(
      detectSqlDataDeletion(
        "EXPLAIN (ANALYZE true) MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE",
      ).deletesData,
    ).toBe(true);
  });

  it("reports mixed multi-statement SQL when any statement deletes data", () => {
    const result = detectSqlDataDeletion(`
      SELECT * FROM users;
      DELETE FROM users WHERE id = 1;
    `);

    expect(result.deletesData).toBe(true);
    expect(result.statements.map((statement) => statement.deletesData)).toEqual(
      [false, true],
    );
  });
});
