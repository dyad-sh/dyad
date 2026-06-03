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
