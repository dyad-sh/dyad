import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSchemaSnapshotSql,
  filterSchemaForTable,
  generateSchemaDiff,
  getSchemaFromSnapshot,
} from "../src/index.js";
import { getSchema } from "../src/db/introspect.js";
import { schemaQualifiedName } from "../src/schema/identifiers.js";

const execFileAsync = promisify(execFile);

type PgHarness = {
  readonly databaseUrl: (dbName: string) => string;
  readonly stop: () => Promise<void>;
};

let harness: PgHarness | null = null;

describe("generateSchemaDiff against local PostgreSQL", () => {
  beforeAll(async () => {
    const externalDatabaseUrl = process.env["PG_SCHEMA_DIFF_TEST_DATABASE_URL"];
    harness =
      externalDatabaseUrl === undefined
        ? await startPostgres()
        : externalPostgres(externalDatabaseUrl);
  }, 30_000);

  afterAll(async () => {
    if (harness !== null) {
      await harness.stop();
      harness = null;
    }
  }, 30_000);

  it("migrates a current database to a desired simple table schema and then reaches no-diff", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "current_db");
    await createDatabase(pg, "desired_db");

    await execSql(
      pg.databaseUrl("desired_db"),
      'CREATE TABLE "users" ("id" integer NOT NULL)',
    );

    const firstDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("current_db"),
      desiredDatabaseUrl: pg.databaseUrl("desired_db"),
    });

    expect(firstDiff.statements).toEqual([
      {
        sql: 'CREATE TABLE "public"."users" (\n\t"id" integer NOT NULL\n)',
        type: "additive",
      },
    ]);

    for (const statement of firstDiff.statements) {
      await execSql(pg.databaseUrl("current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("current_db"),
      desiredDatabaseUrl: pg.databaseUrl("desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
    await expect(dumpSchema(pg.databaseUrl("current_db"))).resolves.toBe(
      await dumpSchema(pg.databaseUrl("desired_db")),
    );
  }, 30_000);

  it("creates and drops named schemas", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "named_schema_current_db");
    await createDatabase(pg, "named_schema_desired_db");

    await execSql(
      pg.databaseUrl("named_schema_current_db"),
      'CREATE SCHEMA "schema 1"; CREATE SCHEMA "schema 2"',
    );
    await execSql(
      pg.databaseUrl("named_schema_desired_db"),
      'CREATE SCHEMA "schema 2"; CREATE SCHEMA "schema 3"',
    );

    const firstDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("named_schema_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("named_schema_desired_db"),
    });

    expect(firstDiff.statements).toEqual([
      {
        sql: 'CREATE SCHEMA "schema 3"',
        type: "additive",
      },
      {
        sql: 'DROP SCHEMA "schema 1"',
        type: "destructive",
      },
    ]);

    for (const statement of firstDiff.statements) {
      await execSql(pg.databaseUrl("named_schema_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("named_schema_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("named_schema_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
    await expect(
      dumpSchema(pg.databaseUrl("named_schema_current_db")),
    ).resolves.toBe(
      await dumpSchema(pg.databaseUrl("named_schema_desired_db")),
    );
  }, 30_000);

  it("creates and drops extensions in named schemas", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "extension_current_db");
    await createDatabase(pg, "extension_desired_db");

    await execSql(
      pg.databaseUrl("extension_current_db"),
      'CREATE SCHEMA "schema 1"; CREATE EXTENSION amcheck WITH SCHEMA "schema 1"',
    );
    await execSql(
      pg.databaseUrl("extension_desired_db"),
      'CREATE SCHEMA "schema 2"; CREATE EXTENSION pg_trgm WITH SCHEMA "schema 2"',
    );

    const firstDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("extension_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("extension_desired_db"),
    });

    expect(firstDiff.statements).toEqual([
      {
        sql: 'CREATE SCHEMA "schema 2"',
        type: "additive",
      },
      {
        sql: expect.stringMatching(
          /^CREATE EXTENSION "pg_trgm" WITH SCHEMA "schema 2" VERSION "[^"]+"$/u,
        ),
        type: "additive",
      },
      {
        sql: 'DROP EXTENSION "amcheck"',
        type: "destructive",
      },
      {
        sql: 'DROP SCHEMA "schema 1"',
        type: "destructive",
      },
    ]);

    for (const statement of firstDiff.statements) {
      await execSql(pg.databaseUrl("extension_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("extension_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("extension_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
    await expect(
      dumpSchema(pg.databaseUrl("extension_current_db")),
    ).resolves.toBe(await dumpSchema(pg.databaseUrl("extension_desired_db")));
  }, 30_000);

  it("upgrades extension versions", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "extension_upgrade_current_db");
    await createDatabase(pg, "extension_upgrade_desired_db");

    await execSql(
      pg.databaseUrl("extension_upgrade_current_db"),
      "CREATE EXTENSION pg_trgm WITH VERSION '1.5'",
    );
    await execSql(
      pg.databaseUrl("extension_upgrade_desired_db"),
      "CREATE EXTENSION pg_trgm",
    );

    const firstDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("extension_upgrade_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("extension_upgrade_desired_db"),
    });

    expect(firstDiff.statements).toEqual([
      {
        sql: expect.stringMatching(
          /^ALTER EXTENSION "pg_trgm" UPDATE TO "[^"]+"$/u,
        ),
        type: "additive",
      },
    ]);

    for (const statement of firstDiff.statements) {
      await execSql(
        pg.databaseUrl("extension_upgrade_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("extension_upgrade_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("extension_upgrade_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
    await expect(
      dumpSchema(pg.databaseUrl("extension_upgrade_current_db")),
    ).resolves.toBe(
      await dumpSchema(pg.databaseUrl("extension_upgrade_desired_db")),
    );
  }, 30_000);

  it("migrates table metadata including checks, RLS, policies, and privileges", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "metadata_current_db");
    await createDatabase(pg, "metadata_desired_db");

    await execSql(
      pg.databaseUrl("metadata_desired_db"),
      `
        CREATE TABLE accounts (
          id integer NOT NULL,
          label text CONSTRAINT label_present CHECK (label IS NOT NULL)
        );
        ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
        CREATE POLICY accounts_read ON accounts FOR SELECT TO PUBLIC USING (true);
        GRANT SELECT ON accounts TO PUBLIC;
      `,
    );

    const firstDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("metadata_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("metadata_desired_db"),
    });

    const sql = firstDiff.statements.map((statement) => statement.sql);
    expect(
      sql.some((statement) =>
        /^ALTER TABLE "public"\."accounts" ADD CONSTRAINT "label_present" CHECK\(.+\)$/u.test(
          statement,
        ),
      ),
    ).toBe(true);
    expect(sql).toContain(
      'CREATE POLICY "accounts_read" ON "public"."accounts" AS PERMISSIVE FOR SELECT TO PUBLIC USING (true)',
    );
    expect(sql).toContain(
      'ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).toContain('GRANT SELECT ON "public"."accounts" TO PUBLIC');

    for (const statement of firstDiff.statements) {
      await execSql(pg.databaseUrl("metadata_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("metadata_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("metadata_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds valid check constraints to existing tables as NOT VALID before validation", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "check_current_db");
    await createDatabase(pg, "check_desired_db");

    await execSql(
      pg.databaseUrl("check_current_db"),
      "CREATE TABLE accounts (id integer NOT NULL, balance integer NOT NULL)",
    );
    await execSql(
      pg.databaseUrl("check_desired_db"),
      "CREATE TABLE accounts (id integer NOT NULL, balance integer NOT NULL CONSTRAINT balance_nonnegative CHECK (balance >= 0))",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("check_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("check_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" ADD CONSTRAINT "balance_nonnegative" CHECK((balance >= 0)) NOT VALID',
      'ALTER TABLE "public"."accounts" VALIDATE CONSTRAINT "balance_nonnegative"',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("check_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("check_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("check_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("validates existing invalid check constraints", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "check_validate_current_db");
    await createDatabase(pg, "check_validate_desired_db");

    await execSql(
      pg.databaseUrl("check_validate_current_db"),
      "CREATE TABLE accounts (balance integer NOT NULL); ALTER TABLE accounts ADD CONSTRAINT balance_nonnegative CHECK (balance >= 0) NOT VALID",
    );
    await execSql(
      pg.databaseUrl("check_validate_desired_db"),
      "CREATE TABLE accounts (balance integer NOT NULL CONSTRAINT balance_nonnegative CHECK (balance >= 0))",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("check_validate_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("check_validate_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" VALIDATE CONSTRAINT "balance_nonnegative"',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("check_validate_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("check_validate_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("check_validate_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops check constraints before dependent column deletes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "check_column_delete_current_db");
    await createDatabase(pg, "check_column_delete_desired_db");

    await execSql(
      pg.databaseUrl("check_column_delete_current_db"),
      "CREATE TABLE accounts (id integer, balance integer CONSTRAINT balance_nonnegative CHECK (balance >= 0))",
    );
    await execSql(
      pg.databaseUrl("check_column_delete_desired_db"),
      "CREATE TABLE accounts (id integer)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("check_column_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("check_column_delete_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" DROP CONSTRAINT "balance_nonnegative"',
      'ALTER TABLE "public"."accounts" DROP COLUMN "balance"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("check_column_delete_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("check_column_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("check_column_delete_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops changed check constraints before dependent column type edits", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "check_column_type_current_db");
    await createDatabase(pg, "check_column_type_desired_db");

    await execSql(
      pg.databaseUrl("check_column_type_current_db"),
      "CREATE TABLE accounts (balance integer CONSTRAINT balance_positive CHECK (balance > 0))",
    );
    await execSql(
      pg.databaseUrl("check_column_type_desired_db"),
      "CREATE TABLE accounts (balance bigint CONSTRAINT balance_nonnegative CHECK (balance >= 0))",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("check_column_type_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("check_column_type_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" DROP CONSTRAINT "balance_positive"',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "balance" SET DATA TYPE bigint using "balance"::bigint',
      'ANALYZE "public"."accounts" ("balance")',
      'ALTER TABLE "public"."accounts" ADD CONSTRAINT "balance_nonnegative" CHECK((balance >= 0)) NOT VALID',
      'ALTER TABLE "public"."accounts" VALIDATE CONSTRAINT "balance_nonnegative"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("check_column_type_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("check_column_type_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("check_column_type_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("rejects check constraints that depend on user-defined functions", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "check_udf_current_db");
    await createDatabase(pg, "check_udf_desired_db");

    const functionSql = `
      CREATE FUNCTION is_nonnegative(value integer) RETURNS boolean
      LANGUAGE sql
      IMMUTABLE
      AS $$ SELECT value >= 0 $$;
      CREATE TABLE accounts (balance integer NOT NULL);
    `;
    await execSql(pg.databaseUrl("check_udf_current_db"), functionSql);
    await execSql(
      pg.databaseUrl("check_udf_desired_db"),
      `${functionSql} ALTER TABLE accounts ADD CONSTRAINT balance_nonnegative CHECK (is_nonnegative(balance));`,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl("check_udf_current_db"),
        desiredDatabaseUrl: pg.databaseUrl("check_udf_desired_db"),
      }),
    ).rejects.toThrow(
      "check constraints that depend on user-defined functions are not supported",
    );
  }, 30_000);

  it("rejects index replica identity on newly-added tables", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "replica_identity_index_add_current_db");
    await createDatabase(pg, "replica_identity_index_add_desired_db");

    await execSql(
      pg.databaseUrl("replica_identity_index_add_desired_db"),
      `
        CREATE TABLE accounts (
          id integer PRIMARY KEY,
          email text NOT NULL
        );
        CREATE UNIQUE INDEX accounts_email_idx ON accounts(email);
        ALTER TABLE accounts REPLICA IDENTITY USING INDEX accounts_email_idx;
      `,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl(
          "replica_identity_index_add_current_db",
        ),
        desiredDatabaseUrl: pg.databaseUrl(
          "replica_identity_index_add_desired_db",
        ),
      }),
    ).rejects.toThrow("index replica identity is not supported");
  }, 30_000);

  it("rejects altering to index replica identity", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "replica_identity_index_alter_current_db");
    await createDatabase(pg, "replica_identity_index_alter_desired_db");

    const baseSql = `
      CREATE TABLE accounts (
        id integer PRIMARY KEY,
        email text NOT NULL
      );
      CREATE UNIQUE INDEX accounts_email_idx ON accounts(email);
    `;
    await execSql(
      pg.databaseUrl("replica_identity_index_alter_current_db"),
      `${baseSql} ALTER TABLE accounts REPLICA IDENTITY FULL;`,
    );
    await execSql(
      pg.databaseUrl("replica_identity_index_alter_desired_db"),
      `${baseSql} ALTER TABLE accounts REPLICA IDENTITY USING INDEX accounts_email_idx;`,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl(
          "replica_identity_index_alter_current_db",
        ),
        desiredDatabaseUrl: pg.databaseUrl(
          "replica_identity_index_alter_desired_db",
        ),
      }),
    ).rejects.toThrow("index replica identity is not supported");
  }, 30_000);

  it("alters policy expressions in place when PostgreSQL supports it", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "policy_alter_current_db");
    await createDatabase(pg, "policy_alter_desired_db");

    await execSql(
      pg.databaseUrl("policy_alter_current_db"),
      `
        CREATE TABLE accounts (active boolean NOT NULL);
        CREATE POLICY accounts_read ON accounts AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);
      `,
    );
    await execSql(
      pg.databaseUrl("policy_alter_desired_db"),
      `
        CREATE TABLE accounts (active boolean NOT NULL);
        CREATE POLICY accounts_read ON accounts AS PERMISSIVE FOR SELECT TO PUBLIC USING (active);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("policy_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("policy_alter_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER POLICY "accounts_read" ON "public"."accounts"\n\tUSING (active)',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("policy_alter_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("policy_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("policy_alter_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("recreates policies when removing ALL policy expressions", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "policy_recreate_current_db");
    await createDatabase(pg, "policy_recreate_desired_db");

    await execSql(
      pg.databaseUrl("policy_recreate_current_db"),
      `
        CREATE TABLE accounts (active boolean NOT NULL);
        CREATE POLICY accounts_all ON accounts AS PERMISSIVE FOR ALL TO PUBLIC USING (active) WITH CHECK (active);
      `,
    );
    await execSql(
      pg.databaseUrl("policy_recreate_desired_db"),
      `
        CREATE TABLE accounts (active boolean NOT NULL);
        CREATE POLICY accounts_all ON accounts AS PERMISSIVE FOR ALL TO PUBLIC WITH CHECK (active);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("policy_recreate_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("policy_recreate_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP POLICY "accounts_all" ON "public"."accounts"',
      'CREATE POLICY "accounts_all" ON "public"."accounts" AS PERMISSIVE FOR ALL TO PUBLIC WITH CHECK (active)',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("policy_recreate_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("policy_recreate_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("policy_recreate_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops policies before dependent column deletes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "policy_column_delete_current_db");
    await createDatabase(pg, "policy_column_delete_desired_db");

    await execSql(
      pg.databaseUrl("policy_column_delete_current_db"),
      `
        CREATE TABLE accounts (tenant_id integer, name text);
        ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_filter ON accounts USING (tenant_id > 0);
      `,
    );
    await execSql(
      pg.databaseUrl("policy_column_delete_desired_db"),
      `
        CREATE TABLE accounts (name text);
        ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("policy_column_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("policy_column_delete_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP POLICY "tenant_filter" ON "public"."accounts"',
      'ALTER TABLE "public"."accounts" DROP COLUMN "tenant_id"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("policy_column_delete_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("policy_column_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("policy_column_delete_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("recreates table privileges when grant option changes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "privilege_grant_option_current_db");
    await createDatabase(pg, "privilege_grant_option_desired_db");
    await execSql(
      pg.databaseUrl("postgres"),
      "CREATE ROLE privilege_grant_option_user",
    );

    await execSql(
      pg.databaseUrl("privilege_grant_option_current_db"),
      "CREATE TABLE accounts (id integer); GRANT SELECT ON accounts TO privilege_grant_option_user",
    );
    await execSql(
      pg.databaseUrl("privilege_grant_option_desired_db"),
      "CREATE TABLE accounts (id integer); GRANT SELECT ON accounts TO privilege_grant_option_user WITH GRANT OPTION",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("privilege_grant_option_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("privilege_grant_option_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'REVOKE SELECT ON "public"."accounts" FROM "privilege_grant_option_user"',
      'GRANT SELECT ON "public"."accounts" TO "privilege_grant_option_user" WITH GRANT OPTION',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("privilege_grant_option_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("privilege_grant_option_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("privilege_grant_option_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("uses concurrent index operations for ordinary table indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "index_current_db");
    await createDatabase(pg, "index_desired_db");
    await createDatabase(pg, "index_no_index_db");

    await execSql(
      pg.databaseUrl("index_current_db"),
      "CREATE TABLE users (id integer NOT NULL, name text)",
    );
    await execSql(
      pg.databaseUrl("index_desired_db"),
      "CREATE TABLE users (id integer NOT NULL, name text)",
    );
    await execSql(
      pg.databaseUrl("index_no_index_db"),
      "CREATE TABLE users (id integer NOT NULL, name text)",
    );
    await execSql(
      pg.databaseUrl("index_desired_db"),
      "CREATE INDEX users_name_idx ON users (name)",
    );

    const addDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("index_desired_db"),
    });
    expect(addDiff.statements.map((statement) => statement.sql)).toContain(
      "CREATE INDEX CONCURRENTLY users_name_idx ON public.users USING btree (name)",
    );

    for (const statement of addDiff.statements) {
      await execSql(pg.databaseUrl("index_current_db"), statement.sql);
    }

    const noDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("index_desired_db"),
    });
    expect(noDiff.statements).toEqual([]);

    const dropDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("index_desired_db"),
      desiredDatabaseUrl: pg.databaseUrl("index_no_index_db"),
    });
    expect(dropDiff.statements.map((statement) => statement.sql)).toContain(
      'DROP INDEX CONCURRENTLY "public"."users_name_idx"',
    );
  }, 30_000);

  it("replaces changed indexes by renaming the old index before creating the new one", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "replace_index_current_db");
    await createDatabase(pg, "replace_index_desired_db");

    await execSql(
      pg.databaseUrl("replace_index_current_db"),
      "CREATE TABLE users (id integer NOT NULL, name text)",
    );
    await execSql(
      pg.databaseUrl("replace_index_desired_db"),
      "CREATE TABLE users (id integer NOT NULL, name text)",
    );
    await execSql(
      pg.databaseUrl("replace_index_current_db"),
      "CREATE INDEX users_name_idx ON users (name)",
    );
    await execSql(
      pg.databaseUrl("replace_index_desired_db"),
      "CREATE INDEX users_name_idx ON users (name, id)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("replace_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("replace_index_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      expect.stringMatching(
        /^ALTER INDEX "public"\."users_name_idx" RENAME TO "pgschemadiff_tmpidx_users_name_idx_[0-9a-f]{16}"$/u,
      ),
      "CREATE INDEX CONCURRENTLY users_name_idx ON public.users USING btree (name, id)",
      expect.stringMatching(
        /^DROP INDEX CONCURRENTLY "public"\."pgschemadiff_tmpidx_users_name_idx_[0-9a-f]{16}"$/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("replace_index_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("replace_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("replace_index_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("omits index drops when dropping their owning table", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "table_drop_index_current_db");
    await createDatabase(pg, "table_drop_index_desired_db");

    await execSql(
      pg.databaseUrl("table_drop_index_current_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, name text NOT NULL);
        CREATE INDEX accounts_name_idx ON accounts(name);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("table_drop_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("table_drop_index_desired_db"),
    });

    expect(diff.statements).toEqual([
      {
        sql: 'DROP TABLE "public"."accounts"',
        type: "destructive",
      },
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("table_drop_index_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("table_drop_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("table_drop_index_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("uses concurrent index creation on materialized views", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "matview_index_current_db");
    await createDatabase(pg, "matview_index_desired_db");

    const baseSql = `
      CREATE TABLE accounts (id integer PRIMARY KEY, name text);
      CREATE MATERIALIZED VIEW account_names AS SELECT id, name FROM accounts;
    `;
    await execSql(pg.databaseUrl("matview_index_current_db"), baseSql);
    await execSql(
      pg.databaseUrl("matview_index_desired_db"),
      `${baseSql} CREATE INDEX account_names_name_idx ON account_names(name);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_index_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      "CREATE INDEX CONCURRENTLY account_names_name_idx ON public.account_names USING btree (name)",
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("matview_index_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_index_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("omits index drops when dropping their owning materialized view", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "matview_drop_index_current_db");
    await createDatabase(pg, "matview_drop_index_desired_db");

    await execSql(
      pg.databaseUrl("matview_drop_index_current_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, name text NOT NULL);
        CREATE MATERIALIZED VIEW account_names AS SELECT id, name FROM accounts;
        CREATE INDEX account_names_name_idx ON account_names(name);
      `,
    );
    await execSql(
      pg.databaseUrl("matview_drop_index_desired_db"),
      "CREATE TABLE accounts (id integer NOT NULL, name text NOT NULL)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_drop_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_drop_index_desired_db"),
    });

    expect(diff.statements).toEqual([
      {
        sql: 'DROP MATERIALIZED VIEW "public"."account_names"',
        type: "destructive",
      },
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("matview_drop_index_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_drop_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_drop_index_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("preserves view options when replacing changed views", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "view_options_current_db");
    await createDatabase(pg, "view_options_desired_db");

    await execSql(
      pg.databaseUrl("view_options_current_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, active boolean NOT NULL);
        CREATE VIEW active_accounts AS SELECT id FROM accounts WHERE active;
      `,
    );
    await execSql(
      pg.databaseUrl("view_options_desired_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, active boolean NOT NULL);
        CREATE VIEW active_accounts WITH (security_barrier = true) AS SELECT id FROM accounts WHERE active;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("view_options_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("view_options_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      expect.stringMatching(
        /^CREATE OR REPLACE VIEW "public"\."active_accounts" WITH \(security_barrier=true\) AS\n/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("view_options_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("view_options_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("view_options_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("rejects view output-shape changes before replacing views", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "view_output_shape_current_db");
    await createDatabase(pg, "view_output_shape_desired_db");

    const tableSql = "CREATE TABLE accounts (id integer, name text);";
    await execSql(
      pg.databaseUrl("view_output_shape_current_db"),
      `${tableSql} CREATE VIEW account_summary AS SELECT id, name FROM accounts;`,
    );
    await execSql(
      pg.databaseUrl("view_output_shape_desired_db"),
      `${tableSql} CREATE VIEW account_summary AS SELECT name, id FROM accounts;`,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl("view_output_shape_current_db"),
        desiredDatabaseUrl: pg.databaseUrl("view_output_shape_desired_db"),
      }),
    ).rejects.toThrow(
      'changing the output columns of view "public"."account_summary" is not supported',
    );
  }, 30_000);

  it("preserves materialized view options when recreating changed materialized views", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "matview_options_current_db");
    await createDatabase(pg, "matview_options_desired_db");

    await execSql(
      pg.databaseUrl("matview_options_current_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, active boolean NOT NULL);
        CREATE MATERIALIZED VIEW active_accounts AS SELECT id FROM accounts WHERE active;
      `,
    );
    await execSql(
      pg.databaseUrl("matview_options_desired_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, active boolean NOT NULL);
        CREATE MATERIALIZED VIEW active_accounts WITH (autovacuum_enabled = false) AS SELECT id FROM accounts WHERE active;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_options_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_options_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP MATERIALIZED VIEW "public"."active_accounts"',
      expect.stringMatching(
        /^CREATE MATERIALIZED VIEW "public"\."active_accounts" WITH \(autovacuum_enabled=false\) AS\n/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("matview_options_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_options_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_options_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("creates materialized views before dependent views", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "matview_view_order_current_db");
    await createDatabase(pg, "matview_view_order_desired_db");

    const tableSql = "CREATE TABLE accounts (id integer NOT NULL);";
    await execSql(pg.databaseUrl("matview_view_order_current_db"), tableSql);
    await execSql(
      pg.databaseUrl("matview_view_order_desired_db"),
      `
        ${tableSql}
        CREATE MATERIALIZED VIEW account_ids AS SELECT id FROM accounts;
        CREATE VIEW account_ids_public AS SELECT id FROM account_ids;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_view_order_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_view_order_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      expect.stringMatching(
        /^CREATE MATERIALIZED VIEW "public"\."account_ids" AS\n/u,
      ),
      expect.stringMatching(
        /^CREATE VIEW "public"\."account_ids_public" AS\n/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("matview_view_order_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_view_order_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_view_order_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("creates materialized views before dependent materialized views", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "matview_matview_order_current_db");
    await createDatabase(pg, "matview_matview_order_desired_db");

    const tableSql = "CREATE TABLE accounts (id integer NOT NULL);";
    await execSql(pg.databaseUrl("matview_matview_order_current_db"), tableSql);
    await execSql(
      pg.databaseUrl("matview_matview_order_desired_db"),
      `
        ${tableSql}
        CREATE MATERIALIZED VIEW z_account_ids AS SELECT id FROM accounts;
        CREATE MATERIALIZED VIEW a_account_ids_snapshot AS SELECT id FROM z_account_ids;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_matview_order_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_matview_order_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      expect.stringMatching(
        /^CREATE MATERIALIZED VIEW "public"\."z_account_ids" AS\n/u,
      ),
      expect.stringMatching(
        /^CREATE MATERIALIZED VIEW "public"\."a_account_ids_snapshot" AS\n/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("matview_matview_order_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("matview_matview_order_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("matview_matview_order_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("recreates views and materialized views when dependent tables are recreated", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "view_dependency_current_db");
    await createDatabase(pg, "view_dependency_desired_db");

    await execSql(
      pg.databaseUrl("view_dependency_current_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, created_at date NOT NULL);
        CREATE VIEW account_days AS SELECT created_at, count(*) FROM accounts GROUP BY created_at;
        CREATE MATERIALIZED VIEW account_day_counts AS SELECT created_at, count(*) FROM accounts GROUP BY created_at;
      `,
    );
    await execSql(
      pg.databaseUrl("view_dependency_desired_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, created_at date NOT NULL) PARTITION BY RANGE (created_at);
        CREATE VIEW account_days AS SELECT created_at, count(*) FROM accounts GROUP BY created_at;
        CREATE MATERIALIZED VIEW account_day_counts AS SELECT created_at, count(*) FROM accounts GROUP BY created_at;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("view_dependency_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("view_dependency_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP VIEW "public"."account_days"',
      'DROP MATERIALIZED VIEW "public"."account_day_counts"',
      'DROP TABLE "public"."accounts"',
      'CREATE TABLE "public"."accounts" (\n\t"id" integer NOT NULL,\n\t"created_at" date NOT NULL\n) PARTITION BY RANGE (created_at)',
      expect.stringMatching(/^CREATE VIEW "public"\."account_days" AS\n/u),
      expect.stringMatching(
        /^CREATE MATERIALIZED VIEW "public"\."account_day_counts" AS\n/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("view_dependency_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("view_dependency_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("view_dependency_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("rejects materialized view rebuilds with dependent views", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "matview_dependent_current_db");
    await createDatabase(pg, "matview_dependent_desired_db");

    await execSql(
      pg.databaseUrl("matview_dependent_current_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL);
        CREATE MATERIALIZED VIEW account_ids AS SELECT id FROM accounts;
        CREATE VIEW account_ids_public AS SELECT id FROM account_ids;
      `,
    );
    await execSql(
      pg.databaseUrl("matview_dependent_desired_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL);
        CREATE MATERIALIZED VIEW account_ids AS SELECT id FROM accounts WHERE id > 0;
        CREATE VIEW account_ids_public AS SELECT id FROM account_ids;
      `,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl("matview_dependent_current_db"),
        desiredDatabaseUrl: pg.databaseUrl("matview_dependent_desired_db"),
      }),
    ).rejects.toThrow(
      'recreating materialized view "public"."account_ids" is not supported because it is referenced by view "public"."account_ids_public"',
    );
  }, 30_000);

  it("classifies untrackable routine dependencies as destructive", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "routine_hazard_current_db");
    await createDatabase(pg, "routine_hazard_desired_db");

    await execSql(
      pg.databaseUrl("routine_hazard_desired_db"),
      `
        CREATE FUNCTION non_sql_func(i integer) RETURNS integer AS $$ BEGIN RETURN i + 1; END; $$ LANGUAGE plpgsql;
        CREATE PROCEDURE sync_accounts() LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'sync'; END; $$;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("routine_hazard_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("routine_hazard_desired_db"),
    });

    expect(diff.statements).toEqual([
      {
        sql: expect.stringMatching(
          /^CREATE OR REPLACE FUNCTION public\.non_sql_func/u,
        ),
        type: "destructive",
      },
      {
        sql: expect.stringMatching(
          /^CREATE OR REPLACE PROCEDURE public\.sync_accounts/u,
        ),
        type: "destructive",
      },
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("routine_hazard_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("routine_hazard_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("routine_hazard_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("rejects function return type changes before replacing functions", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "function_return_current_db");
    await createDatabase(pg, "function_return_desired_db");

    await execSql(
      pg.databaseUrl("function_return_current_db"),
      "CREATE FUNCTION answer() RETURNS integer LANGUAGE sql RETURN 1",
    );
    await execSql(
      pg.databaseUrl("function_return_desired_db"),
      "CREATE FUNCTION answer() RETURNS text LANGUAGE sql RETURN '1'",
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl("function_return_current_db"),
        desiredDatabaseUrl: pg.databaseUrl("function_return_desired_db"),
      }),
    ).rejects.toThrow(
      'changing return type of function "public"."answer"() is not supported',
    );
  }, 30_000);

  it("orders function migrations by tracked dependencies", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "function_order_add_current_db");
    await createDatabase(pg, "function_order_add_desired_db");
    await createDatabase(pg, "function_order_drop_current_db");
    await createDatabase(pg, "function_order_drop_desired_db");

    await execSql(
      pg.databaseUrl("function_order_add_desired_db"),
      `
        CREATE FUNCTION z_base() RETURNS integer LANGUAGE SQL IMMUTABLE RETURN 1;
        CREATE FUNCTION a_depends() RETURNS integer LANGUAGE SQL IMMUTABLE RETURN z_base();
      `,
    );
    await execSql(
      pg.databaseUrl("function_order_drop_current_db"),
      `
        CREATE FUNCTION a_base() RETURNS integer LANGUAGE SQL IMMUTABLE RETURN 1;
        CREATE FUNCTION z_depends() RETURNS integer LANGUAGE SQL IMMUTABLE RETURN a_base();
      `,
    );

    const addDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("function_order_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("function_order_add_desired_db"),
    });
    expect(addDiff.statements.map((statement) => statement.sql)).toEqual([
      expect.stringMatching(/^CREATE OR REPLACE FUNCTION public\.z_base/u),
      expect.stringMatching(/^CREATE OR REPLACE FUNCTION public\.a_depends/u),
    ]);

    for (const statement of addDiff.statements) {
      await execSql(
        pg.databaseUrl("function_order_add_current_db"),
        statement.sql,
      );
    }
    const addSecondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("function_order_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("function_order_add_desired_db"),
    });
    expect(addSecondDiff.statements).toEqual([]);

    const dropDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("function_order_drop_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("function_order_drop_desired_db"),
    });
    expect(dropDiff.statements.map((statement) => statement.sql)).toEqual([
      'DROP FUNCTION "public"."z_depends"()',
      'DROP FUNCTION "public"."a_base"()',
    ]);

    for (const statement of dropDiff.statements) {
      await execSql(
        pg.databaseUrl("function_order_drop_current_db"),
        statement.sql,
      );
    }
    const dropSecondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("function_order_drop_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("function_order_drop_desired_db"),
    });
    expect(dropSecondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds primary key constraints using a newly-created backing index", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "pk_current_db");
    await createDatabase(pg, "pk_desired_db");

    await execSql(
      pg.databaseUrl("pk_current_db"),
      "CREATE TABLE accounts (id integer NOT NULL)",
    );
    await execSql(
      pg.databaseUrl("pk_desired_db"),
      "CREATE TABLE accounts (id integer PRIMARY KEY)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("pk_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("pk_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      "CREATE UNIQUE INDEX CONCURRENTLY accounts_pkey ON public.accounts USING btree (id)",
      'ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_pkey" PRIMARY KEY USING INDEX "accounts_pkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("pk_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("pk_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("pk_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("attaches unique constraints to existing unique indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "unique_existing_index_current_db");
    await createDatabase(pg, "unique_existing_index_desired_db");

    await execSql(
      pg.databaseUrl("unique_existing_index_current_db"),
      "CREATE TABLE accounts (email text); CREATE UNIQUE INDEX accounts_email_key ON accounts(email)",
    );
    await execSql(
      pg.databaseUrl("unique_existing_index_desired_db"),
      "CREATE TABLE accounts (email text UNIQUE)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("unique_existing_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("unique_existing_index_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_email_key" UNIQUE USING INDEX "accounts_email_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("unique_existing_index_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("unique_existing_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("unique_existing_index_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("replaces differently named existing indexes when adding constraints", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "constraint_rename_index_current_db");
    await createDatabase(pg, "constraint_rename_index_desired_db");

    await execSql(
      pg.databaseUrl("constraint_rename_index_current_db"),
      "CREATE TABLE accounts (email text); CREATE UNIQUE INDEX accounts_email_idx ON accounts(email)",
    );
    await execSql(
      pg.databaseUrl("constraint_rename_index_desired_db"),
      `
        CREATE TABLE accounts (email text);
        CREATE UNIQUE INDEX accounts_email_idx ON accounts(email);
        ALTER TABLE accounts ADD CONSTRAINT accounts_email_key UNIQUE USING INDEX accounts_email_idx;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("constraint_rename_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("constraint_rename_index_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX CONCURRENTLY "public"."accounts_email_idx"',
      "CREATE UNIQUE INDEX CONCURRENTLY accounts_email_key ON public.accounts USING btree (email)",
      'ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_email_key" UNIQUE USING INDEX "accounts_email_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("constraint_rename_index_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("constraint_rename_index_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("constraint_rename_index_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("attaches existing child indexes to partitioned parent indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_index_attach_current_db");
    await createDatabase(pg, "partitioned_index_attach_desired_db");

    const baseSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE INDEX metrics_recorded_at_idx ON ONLY metrics (recorded_at);
      CREATE INDEX metrics_2024_recorded_at_idx ON metrics_2024 (recorded_at);
    `;
    await execSql(
      pg.databaseUrl("partitioned_index_attach_current_db"),
      baseSql,
    );
    await execSql(
      pg.databaseUrl("partitioned_index_attach_desired_db"),
      `${baseSql} ALTER INDEX metrics_recorded_at_idx ATTACH PARTITION metrics_2024_recorded_at_idx;`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_attach_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_attach_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER INDEX "public"."metrics_recorded_at_idx" ATTACH PARTITION "public"."metrics_2024_recorded_at_idx"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_index_attach_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_attach_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_attach_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("attaches remaining child indexes to invalid partitioned parent indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_invalid_index_attach_current_db");
    await createDatabase(pg, "partitioned_invalid_index_attach_desired_db");

    const baseSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE TABLE metrics_2025 PARTITION OF metrics
        FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
      CREATE INDEX metrics_recorded_at_idx ON ONLY metrics (recorded_at);
      CREATE INDEX metrics_2024_recorded_at_idx ON metrics_2024 (recorded_at);
      ALTER INDEX metrics_recorded_at_idx ATTACH PARTITION metrics_2024_recorded_at_idx;
      CREATE INDEX metrics_2025_recorded_at_idx ON metrics_2025 (recorded_at);
    `;
    await execSql(
      pg.databaseUrl("partitioned_invalid_index_attach_current_db"),
      baseSql,
    );
    await execSql(
      pg.databaseUrl("partitioned_invalid_index_attach_desired_db"),
      `${baseSql} ALTER INDEX metrics_recorded_at_idx ATTACH PARTITION metrics_2025_recorded_at_idx;`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_invalid_index_attach_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_invalid_index_attach_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER INDEX "public"."metrics_recorded_at_idx" ATTACH PARTITION "public"."metrics_2025_recorded_at_idx"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_invalid_index_attach_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_invalid_index_attach_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_invalid_index_attach_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("replaces partitioned indexes when the access method changes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_index_type_current_db");
    await createDatabase(pg, "partitioned_index_type_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE TABLE metrics_2025 PARTITION OF metrics
        FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_index_type_current_db"),
      `${tableSql} CREATE INDEX metrics_recorded_at_idx ON metrics (recorded_at);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_index_type_desired_db"),
      `${tableSql} CREATE INDEX metrics_recorded_at_idx ON metrics USING hash (recorded_at);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_type_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_type_desired_db"),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql).toContain(
      "CREATE INDEX metrics_recorded_at_idx ON ONLY public.metrics USING hash (recorded_at)",
    );
    expect(
      sql.filter((statement) =>
        /^CREATE INDEX .+ ON public\.metrics_202[45] USING hash \(recorded_at\)$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(2);
    expect(
      sql.filter((statement) =>
        /^ALTER INDEX "public"\."metrics_recorded_at_idx" ATTACH PARTITION "public"\.".+"$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(2);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_index_type_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_type_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_type_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("replaces partitioned indexes when indexed column order changes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_index_order_current_db");
    await createDatabase(pg, "partitioned_index_order_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE TABLE metrics_2025 PARTITION OF metrics
        FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_index_order_current_db"),
      `${tableSql} CREATE INDEX metrics_recorded_tenant_idx ON metrics (recorded_at, tenant_id);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_index_order_desired_db"),
      `${tableSql} CREATE INDEX metrics_recorded_tenant_idx ON metrics (tenant_id, recorded_at);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_order_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_order_desired_db"),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql).toContain(
      "CREATE INDEX metrics_recorded_tenant_idx ON ONLY public.metrics USING btree (tenant_id, recorded_at)",
    );
    expect(
      sql.filter((statement) =>
        /^CREATE INDEX .+ ON public\.metrics_202[45] USING btree \(tenant_id, recorded_at\)$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(2);
    expect(
      sql.filter((statement) =>
        /^ALTER INDEX "public"\."metrics_recorded_tenant_idx" ATTACH PARTITION "public"\.".+"$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(2);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_index_order_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_order_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_order_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops partitioned indexes before deleting indexed columns", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_index_column_delete_current_db");
    await createDatabase(pg, "partitioned_index_column_delete_desired_db");

    await execSql(
      pg.databaseUrl("partitioned_index_column_delete_current_db"),
      `
        CREATE TABLE metrics (
          tenant_id integer NOT NULL,
          recorded_at date NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE metrics_2024 PARTITION OF metrics
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE INDEX metrics_tenant_recorded_idx ON metrics (tenant_id, recorded_at);
      `,
    );
    await execSql(
      pg.databaseUrl("partitioned_index_column_delete_desired_db"),
      `
        CREATE TABLE metrics (
          recorded_at date NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE metrics_2024 PARTITION OF metrics
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_index_column_delete_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_index_column_delete_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX "public"."metrics_tenant_recorded_idx"',
      'ALTER TABLE "public"."metrics" DROP COLUMN "tenant_id"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_index_column_delete_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_index_column_delete_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_index_column_delete_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops partitioned indexes and partitioned index-backed constraints", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_index_delete_current_db");
    await createDatabase(pg, "partitioned_index_delete_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL,
        region text NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_index_delete_current_db"),
      `
        ${tableSql}
        CREATE INDEX metrics_recorded_at_idx ON metrics (recorded_at);
        CREATE UNIQUE INDEX metrics_recorded_region_idx ON metrics (recorded_at, region);
        ALTER TABLE metrics ADD CONSTRAINT metrics_pkey PRIMARY KEY (recorded_at, tenant_id);
        ALTER TABLE metrics ADD CONSTRAINT metrics_recorded_region_key UNIQUE (recorded_at, region);
      `,
    );
    await execSql(
      pg.databaseUrl("partitioned_index_delete_desired_db"),
      tableSql,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_delete_desired_db"),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql).toContain('DROP INDEX "public"."metrics_recorded_at_idx"');
    expect(sql).toContain('DROP INDEX "public"."metrics_recorded_region_idx"');
    expect(sql).toContain(
      'ALTER TABLE "public"."metrics" DROP CONSTRAINT "metrics_pkey"',
    );
    expect(sql).toContain(
      'ALTER TABLE "public"."metrics" DROP CONSTRAINT "metrics_recorded_region_key"',
    );

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_index_delete_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_delete_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops local child partition indexes before deleting indexed columns", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_index_column_delete_current_db");
    await createDatabase(pg, "local_index_column_delete_desired_db");

    await execSql(
      pg.databaseUrl("local_index_column_delete_current_db"),
      `
        CREATE TABLE metrics (
          tenant_id integer NOT NULL,
          recorded_at date NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE metrics_2024 PARTITION OF metrics
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE INDEX metrics_2024_tenant_recorded_idx ON metrics_2024 (tenant_id, recorded_at);
      `,
    );
    await execSql(
      pg.databaseUrl("local_index_column_delete_desired_db"),
      `
        CREATE TABLE metrics (
          recorded_at date NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE metrics_2024 PARTITION OF metrics
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_index_column_delete_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_index_column_delete_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX CONCURRENTLY "public"."metrics_2024_tenant_recorded_idx"',
      'ALTER TABLE "public"."metrics" DROP COLUMN "tenant_id"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_index_column_delete_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_index_column_delete_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_index_column_delete_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("switches partitioned primary keys", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_pk_switch_current_db");
    await createDatabase(pg, "partitioned_pk_switch_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE TABLE metrics_2025 PARTITION OF metrics
        FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_pk_switch_current_db"),
      `${tableSql} ALTER TABLE metrics ADD PRIMARY KEY (recorded_at);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_pk_switch_desired_db"),
      `${tableSql} ALTER TABLE metrics ADD PRIMARY KEY (recorded_at, tenant_id);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_pk_switch_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_pk_switch_desired_db"),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql[0]).toBe(
      'ALTER TABLE "public"."metrics" DROP CONSTRAINT "metrics_pkey"',
    );
    expect(sql).toContain(
      'ALTER TABLE ONLY "public"."metrics" ADD CONSTRAINT "metrics_pkey" PRIMARY KEY (recorded_at, tenant_id)',
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_pkey ON public.metrics_2024 USING btree (recorded_at, tenant_id)",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2025_pkey ON public.metrics_2025 USING btree (recorded_at, tenant_id)",
    );
    expect(sql).toContain(
      'ALTER INDEX "public"."metrics_pkey" ATTACH PARTITION "public"."metrics_2024_pkey"',
    );
    expect(sql).toContain(
      'ALTER INDEX "public"."metrics_pkey" ATTACH PARTITION "public"."metrics_2025_pkey"',
    );

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_pk_switch_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_pk_switch_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_pk_switch_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("replaces local child partition indexes when definitions change", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_partition_index_change_current_db");
    await createDatabase(pg, "local_partition_index_change_desired_db");

    const tableSql = `
      CREATE SCHEMA tenant_data;
      CREATE TABLE tenant_data.metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE tenant_data.metrics_2024 PARTITION OF tenant_data.metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("local_partition_index_change_current_db"),
      `${tableSql} CREATE INDEX metrics_2024_local_idx ON tenant_data.metrics_2024 (recorded_at, tenant_id);`,
    );
    await execSql(
      pg.databaseUrl("local_partition_index_change_desired_db"),
      `${tableSql} CREATE INDEX metrics_2024_local_idx ON tenant_data.metrics_2024 (tenant_id, recorded_at);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_partition_index_change_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_partition_index_change_desired_db",
      ),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql).toEqual([
      expect.stringMatching(
        /^ALTER INDEX "tenant_data"\."metrics_2024_local_idx" RENAME TO "pgschemadiff_tmpidx_metrics_2024_local_idx_[0-9a-f]{16}"$/u,
      ),
      "CREATE INDEX CONCURRENTLY metrics_2024_local_idx ON tenant_data.metrics_2024 USING btree (tenant_id, recorded_at)",
      expect.stringMatching(
        /^DROP INDEX CONCURRENTLY "tenant_data"\."pgschemadiff_tmpidx_metrics_2024_local_idx_[0-9a-f]{16}"$/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_partition_index_change_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_partition_index_change_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_partition_index_change_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("replaces same-named local child partition indexes in different schemas", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_partition_index_conflict_current_db");
    await createDatabase(pg, "local_partition_index_conflict_desired_db");

    const tableSql = `
      CREATE SCHEMA first_parent;
      CREATE SCHEMA first_child;
      CREATE TABLE first_parent.metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE first_child.metrics_2024 PARTITION OF first_parent.metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

      CREATE SCHEMA second_parent;
      CREATE SCHEMA second_child;
      CREATE TABLE second_parent.metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE second_child.metrics_2024 PARTITION OF second_parent.metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("local_partition_index_conflict_current_db"),
      `
        ${tableSql}
        CREATE UNIQUE INDEX same_local_idx ON first_child.metrics_2024 (recorded_at, tenant_id);
        CREATE UNIQUE INDEX same_local_idx ON second_child.metrics_2024 (recorded_at, tenant_id);
      `,
    );
    await execSql(
      pg.databaseUrl("local_partition_index_conflict_desired_db"),
      `
        ${tableSql}
        CREATE UNIQUE INDEX same_local_idx ON first_child.metrics_2024 (tenant_id, recorded_at);
        CREATE UNIQUE INDEX same_local_idx ON second_child.metrics_2024 (tenant_id, recorded_at);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_partition_index_conflict_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_partition_index_conflict_desired_db",
      ),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(
      sql.filter((statement) =>
        /^ALTER INDEX "first_child"\."same_local_idx" RENAME TO "pgschemadiff_tmpidx_same_local_idx_[0-9a-f]{16}"$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(1);
    expect(
      sql.filter((statement) =>
        /^ALTER INDEX "second_child"\."same_local_idx" RENAME TO "pgschemadiff_tmpidx_same_local_idx_[0-9a-f]{16}"$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(1);
    expect(sql).toContain(
      "CREATE UNIQUE INDEX CONCURRENTLY same_local_idx ON first_child.metrics_2024 USING btree (tenant_id, recorded_at)",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX CONCURRENTLY same_local_idx ON second_child.metrics_2024 USING btree (tenant_id, recorded_at)",
    );
    expect(
      sql.filter((statement) =>
        /^DROP INDEX CONCURRENTLY "first_child"\."pgschemadiff_tmpidx_same_local_idx_[0-9a-f]{16}"$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(1);
    expect(
      sql.filter((statement) =>
        /^DROP INDEX CONCURRENTLY "second_child"\."pgschemadiff_tmpidx_same_local_idx_[0-9a-f]{16}"$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(1);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_partition_index_conflict_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_partition_index_conflict_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_partition_index_conflict_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("switches a partitioned index to a local child index", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_to_local_index_current_db");
    await createDatabase(pg, "partitioned_to_local_index_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_to_local_index_current_db"),
      `${tableSql} CREATE INDEX metrics_recorded_at_idx ON metrics (recorded_at);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_to_local_index_desired_db"),
      `${tableSql} CREATE INDEX metrics_2024_recorded_at_idx ON metrics_2024 (recorded_at);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_to_local_index_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_to_local_index_desired_db",
      ),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql).toEqual([
      expect.stringMatching(
        /^ALTER INDEX "public"\."metrics_2024_recorded_at_idx" RENAME TO "pgschemadiff_tmpidx_metrics_2024_recorded_at_i_[0-9a-f]{16}"$/u,
      ),
      'DROP INDEX "public"."metrics_recorded_at_idx"',
      "CREATE INDEX CONCURRENTLY metrics_2024_recorded_at_idx ON public.metrics_2024 USING btree (recorded_at)",
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_to_local_index_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_to_local_index_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_to_local_index_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds and drops local child partition indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_child_index_add_drop_current_db");
    await createDatabase(pg, "local_child_index_add_drop_desired_db");

    const tableSql = `
      CREATE SCHEMA app_data;
      CREATE SCHEMA partition_data;
      CREATE TABLE app_data.metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL,
        region text NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE partition_data.metrics_2024 PARTITION OF app_data.metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE TABLE partition_data.metrics_2025 PARTITION OF app_data.metrics
        FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
    `;
    await execSql(
      pg.databaseUrl("local_child_index_add_drop_current_db"),
      `${tableSql} CREATE UNIQUE INDEX old_metrics_2024_region_idx ON partition_data.metrics_2024 (recorded_at, region);`,
    );
    await execSql(
      pg.databaseUrl("local_child_index_add_drop_desired_db"),
      `
        ${tableSql}
        CREATE INDEX metrics_2024_recorded_at_idx ON partition_data.metrics_2024 (recorded_at);
        CREATE UNIQUE INDEX metrics_2025_recorded_region_idx ON partition_data.metrics_2025 (recorded_at, region);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_child_index_add_drop_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_child_index_add_drop_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX CONCURRENTLY "partition_data"."old_metrics_2024_region_idx"',
      "CREATE INDEX CONCURRENTLY metrics_2024_recorded_at_idx ON partition_data.metrics_2024 USING btree (recorded_at)",
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2025_recorded_region_idx ON partition_data.metrics_2025 USING btree (recorded_at, region)",
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_child_index_add_drop_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_child_index_add_drop_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_child_index_add_drop_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds ordinary partitioned indexes with child index attachment", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_index_add_current_db");
    await createDatabase(pg, "partitioned_index_add_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE TABLE metrics_2025 PARTITION OF metrics
        FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
    `;
    await execSql(pg.databaseUrl("partitioned_index_add_current_db"), tableSql);
    await execSql(
      pg.databaseUrl("partitioned_index_add_desired_db"),
      `${tableSql} CREATE INDEX metrics_recorded_at_idx ON metrics(recorded_at);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_add_desired_db"),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql[0]).toBe(
      "CREATE INDEX metrics_recorded_at_idx ON ONLY public.metrics USING btree (recorded_at)",
    );
    expect(
      sql.filter((statement) =>
        /^CREATE INDEX .+ ON public\.metrics_202[45] USING btree \(recorded_at\)$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(2);
    expect(
      sql.filter((statement) =>
        /^ALTER INDEX "public"\."metrics_recorded_at_idx" ATTACH PARTITION "public"\.".+"$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(2);
    expect(sql[0]?.includes("CONCURRENTLY")).toBe(false);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_index_add_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_index_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_index_add_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned indexes with quoted names, expressions, and non-btree access methods", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_index_sql_shape_current_db");
    await createDatabase(pg, "partitioned_index_sql_shape_desired_db");

    const tableSql = `
      CREATE TABLE "Event Log" (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL,
        "Event Type" text NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE "Event Log 2024" PARTITION OF "Event Log"
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_index_sql_shape_current_db"),
      tableSql,
    );
    await execSql(
      pg.databaseUrl("partitioned_index_sql_shape_desired_db"),
      `
        ${tableSql}
        CREATE INDEX "Event Type Hash Idx" ON "Event Log" USING hash ("Event Type");
        CREATE INDEX "Event Lower Idx" ON "Event Log" (lower("Event Type"));
        CREATE INDEX "Event Type Recorded Idx" ON "Event Log" ("Event Type", recorded_at);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_index_sql_shape_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_index_sql_shape_desired_db",
      ),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql).toContain(
      'CREATE INDEX "Event Lower Idx" ON ONLY public."Event Log" USING btree (lower("Event Type"))',
    );
    expect(sql).toContain(
      'CREATE INDEX "Event Type Hash Idx" ON ONLY public."Event Log" USING hash ("Event Type")',
    );
    expect(sql).toContain(
      'CREATE INDEX "Event Type Recorded Idx" ON ONLY public."Event Log" USING btree ("Event Type", recorded_at)',
    );
    expect(
      sql.filter((statement) =>
        /^ALTER INDEX "public"\."Event .+ Idx" ATTACH PARTITION "public"\.".+_idx"$/u.test(
          statement,
        ),
      ),
    ).toHaveLength(3);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_index_sql_shape_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_index_sql_shape_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_index_sql_shape_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned unique indexes when matching local child indexes already exist", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_unique_index_local_current_db");
    await createDatabase(pg, "partitioned_unique_index_local_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_unique_index_local_current_db"),
      `${tableSql} CREATE UNIQUE INDEX metrics_2024_recorded_at_tenant_id_idx ON metrics_2024 (recorded_at, tenant_id);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_unique_index_local_desired_db"),
      `${tableSql} CREATE UNIQUE INDEX metrics_recorded_tenant_idx ON metrics (recorded_at, tenant_id);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_index_local_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_index_local_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      "CREATE UNIQUE INDEX metrics_recorded_tenant_idx ON ONLY public.metrics USING btree (recorded_at, tenant_id)",
      'ALTER INDEX "public"."metrics_recorded_tenant_idx" ATTACH PARTITION "public"."metrics_2024_recorded_at_tenant_id_idx"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_unique_index_local_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_index_local_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_index_local_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned indexes used by local primary keys", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_local_pk_index_current_db");
    await createDatabase(pg, "partitioned_local_pk_index_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_local_pk_index_current_db"),
      tableSql,
    );
    await execSql(
      pg.databaseUrl("partitioned_local_pk_index_desired_db"),
      `
        ${tableSql}
        CREATE UNIQUE INDEX metrics_recorded_tenant_idx ON ONLY metrics (recorded_at, tenant_id);
        CREATE UNIQUE INDEX metrics_2024_pkey ON metrics_2024 (recorded_at, tenant_id);
        ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_pkey PRIMARY KEY USING INDEX metrics_2024_pkey;
        ALTER INDEX metrics_recorded_tenant_idx ATTACH PARTITION metrics_2024_pkey;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_local_pk_index_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_local_pk_index_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      "CREATE UNIQUE INDEX metrics_recorded_tenant_idx ON ONLY public.metrics USING btree (recorded_at, tenant_id)",
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_pkey ON public.metrics_2024 USING btree (recorded_at, tenant_id)",
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_pkey" PRIMARY KEY USING INDEX "metrics_2024_pkey"',
      'ALTER INDEX "public"."metrics_recorded_tenant_idx" ATTACH PARTITION "public"."metrics_2024_pkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_local_pk_index_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_local_pk_index_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_local_pk_index_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds quoted partitioned primary keys with child index attachment", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_pk_add_current_db");
    await createDatabase(pg, "partitioned_pk_add_desired_db");

    const tableSql = `
      CREATE TABLE "Metrics" (
        "Tenant Id" integer NOT NULL,
        "Recorded At" date NOT NULL
      ) PARTITION BY RANGE ("Recorded At");
      CREATE TABLE "Metrics 2024" PARTITION OF "Metrics"
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(pg.databaseUrl("partitioned_pk_add_current_db"), tableSql);
    await execSql(
      pg.databaseUrl("partitioned_pk_add_desired_db"),
      `${tableSql} ALTER TABLE "Metrics" ADD CONSTRAINT "Metrics PKey" PRIMARY KEY ("Recorded At", "Tenant Id");`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_pk_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_pk_add_desired_db"),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql).toContain(
      'ALTER TABLE ONLY "public"."Metrics" ADD CONSTRAINT "Metrics PKey" PRIMARY KEY ("Recorded At", "Tenant Id")',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY "Metrics 2024_pkey" ON public."Metrics 2024" USING btree ("Recorded At", "Tenant Id")',
    );
    expect(sql).toContain(
      'ALTER TABLE "public"."Metrics 2024" ADD CONSTRAINT "Metrics 2024_pkey" PRIMARY KEY USING INDEX "Metrics 2024_pkey"',
    );
    expect(sql).toContain(
      'ALTER INDEX "public"."Metrics PKey" ATTACH PARTITION "public"."Metrics 2024_pkey"',
    );

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_pk_add_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_pk_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_pk_add_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned primary keys when matching local indexes already exist", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_pk_existing_local_idx_current_db");
    await createDatabase(pg, "partitioned_pk_existing_local_idx_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_pk_existing_local_idx_current_db"),
      `${tableSql} CREATE UNIQUE INDEX metrics_2024_existing_idx ON metrics_2024 (recorded_at, tenant_id);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_pk_existing_local_idx_desired_db"),
      `
        ${tableSql}
        ALTER TABLE metrics ADD CONSTRAINT metrics_pkey PRIMARY KEY (recorded_at, tenant_id);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_existing_local_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_existing_local_idx_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX CONCURRENTLY "public"."metrics_2024_existing_idx"',
      'ALTER TABLE ONLY "public"."metrics" ADD CONSTRAINT "metrics_pkey" PRIMARY KEY (recorded_at, tenant_id)',
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_pkey ON public.metrics_2024 USING btree (recorded_at, tenant_id)",
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_pkey" PRIMARY KEY USING INDEX "metrics_2024_pkey"',
      'ALTER INDEX "public"."metrics_pkey" ATTACH PARTITION "public"."metrics_2024_pkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_pk_existing_local_idx_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_existing_local_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_existing_local_idx_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned primary keys when only the matching parent index exists", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_pk_parent_idx_current_db");
    await createDatabase(pg, "partitioned_pk_parent_idx_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_pk_parent_idx_current_db"),
      `${tableSql} CREATE UNIQUE INDEX metrics_pkey ON metrics (recorded_at, tenant_id);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_pk_parent_idx_desired_db"),
      `${tableSql} ALTER TABLE metrics ADD CONSTRAINT metrics_pkey PRIMARY KEY (recorded_at, tenant_id);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_parent_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_parent_idx_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX "public"."metrics_pkey"',
      'ALTER TABLE ONLY "public"."metrics" ADD CONSTRAINT "metrics_pkey" PRIMARY KEY (recorded_at, tenant_id)',
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_pkey ON public.metrics_2024 USING btree (recorded_at, tenant_id)",
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_pkey" PRIMARY KEY USING INDEX "metrics_2024_pkey"',
      'ALTER INDEX "public"."metrics_pkey" ATTACH PARTITION "public"."metrics_2024_pkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_pk_parent_idx_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_parent_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_parent_idx_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned primary keys when the parent index and local child primary key already exist", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_pk_parent_idx_local_pk_current_db");
    await createDatabase(pg, "partitioned_pk_parent_idx_local_pk_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_pk_parent_idx_local_pk_current_db"),
      `
        ${tableSql}
        CREATE UNIQUE INDEX metrics_pkey ON ONLY metrics (recorded_at, tenant_id);
        ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_pkey PRIMARY KEY (recorded_at, tenant_id);
      `,
    );
    await execSql(
      pg.databaseUrl("partitioned_pk_parent_idx_local_pk_desired_db"),
      `${tableSql} ALTER TABLE metrics ADD CONSTRAINT metrics_pkey PRIMARY KEY (recorded_at, tenant_id);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_parent_idx_local_pk_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_parent_idx_local_pk_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX "public"."metrics_pkey"',
      'ALTER TABLE ONLY "public"."metrics" ADD CONSTRAINT "metrics_pkey" PRIMARY KEY (recorded_at, tenant_id)',
      'ALTER INDEX "public"."metrics_pkey" ATTACH PARTITION "public"."metrics_2024_pkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_pk_parent_idx_local_pk_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_parent_idx_local_pk_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_pk_parent_idx_local_pk_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned unique constraints when matching local indexes already exist", async () => {
    const pg = requireHarness();
    await createDatabase(
      pg,
      "partitioned_unique_existing_local_idx_current_db",
    );
    await createDatabase(
      pg,
      "partitioned_unique_existing_local_idx_desired_db",
    );

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_unique_existing_local_idx_current_db"),
      `${tableSql} CREATE UNIQUE INDEX metrics_2024_existing_idx ON metrics_2024 (recorded_at, tenant_id);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_unique_existing_local_idx_desired_db"),
      `
        ${tableSql}
        ALTER TABLE metrics ADD CONSTRAINT metrics_recorded_tenant_key UNIQUE (recorded_at, tenant_id);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_existing_local_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_existing_local_idx_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX CONCURRENTLY "public"."metrics_2024_existing_idx"',
      'ALTER TABLE ONLY "public"."metrics" ADD CONSTRAINT "metrics_recorded_tenant_key" UNIQUE (recorded_at, tenant_id)',
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_recorded_at_tenant_id_key ON public.metrics_2024 USING btree (recorded_at, tenant_id)",
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_recorded_at_tenant_id_key" UNIQUE USING INDEX "metrics_2024_recorded_at_tenant_id_key"',
      'ALTER INDEX "public"."metrics_recorded_tenant_key" ATTACH PARTITION "public"."metrics_2024_recorded_at_tenant_id_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_unique_existing_local_idx_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_existing_local_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_existing_local_idx_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned unique constraints when only the matching parent index exists", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_unique_parent_idx_current_db");
    await createDatabase(pg, "partitioned_unique_parent_idx_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_unique_parent_idx_current_db"),
      `${tableSql} CREATE UNIQUE INDEX metrics_recorded_tenant_key ON metrics (recorded_at, tenant_id);`,
    );
    await execSql(
      pg.databaseUrl("partitioned_unique_parent_idx_desired_db"),
      `${tableSql} ALTER TABLE metrics ADD CONSTRAINT metrics_recorded_tenant_key UNIQUE (recorded_at, tenant_id);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_parent_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_parent_idx_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX "public"."metrics_recorded_tenant_key"',
      'ALTER TABLE ONLY "public"."metrics" ADD CONSTRAINT "metrics_recorded_tenant_key" UNIQUE (recorded_at, tenant_id)',
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_recorded_at_tenant_id_key ON public.metrics_2024 USING btree (recorded_at, tenant_id)",
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_recorded_at_tenant_id_key" UNIQUE USING INDEX "metrics_2024_recorded_at_tenant_id_key"',
      'ALTER INDEX "public"."metrics_recorded_tenant_key" ATTACH PARTITION "public"."metrics_2024_recorded_at_tenant_id_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_unique_parent_idx_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_parent_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_parent_idx_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned unique constraints when the parent index and local child unique constraint already exist", async () => {
    const pg = requireHarness();
    await createDatabase(
      pg,
      "partitioned_unique_parent_idx_local_unique_current_db",
    );
    await createDatabase(
      pg,
      "partitioned_unique_parent_idx_local_unique_desired_db",
    );

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_unique_parent_idx_local_unique_current_db"),
      `
        ${tableSql}
        CREATE UNIQUE INDEX metrics_recorded_tenant_key ON ONLY metrics (recorded_at, tenant_id);
        ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_recorded_at_tenant_id_key UNIQUE (recorded_at, tenant_id);
      `,
    );
    await execSql(
      pg.databaseUrl("partitioned_unique_parent_idx_local_unique_desired_db"),
      `${tableSql} ALTER TABLE metrics ADD CONSTRAINT metrics_recorded_tenant_key UNIQUE (recorded_at, tenant_id);`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_parent_idx_local_unique_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_parent_idx_local_unique_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX "public"."metrics_recorded_tenant_key"',
      'ALTER TABLE ONLY "public"."metrics" ADD CONSTRAINT "metrics_recorded_tenant_key" UNIQUE (recorded_at, tenant_id)',
      'ALTER INDEX "public"."metrics_recorded_tenant_key" ATTACH PARTITION "public"."metrics_2024_recorded_at_tenant_id_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_unique_parent_idx_local_unique_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_parent_idx_local_unique_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partitioned_unique_parent_idx_local_unique_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("rejects partitioned constraint adds when an attached child index backs a local constraint", async () => {
    const pg = requireHarness();
    await createDatabase(
      pg,
      "partitioned_constraint_attached_local_current_db",
    );
    await createDatabase(
      pg,
      "partitioned_constraint_attached_local_desired_db",
    );

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_constraint_attached_local_current_db"),
      `
        ${tableSql}
        CREATE UNIQUE INDEX metrics_pkey ON metrics (recorded_at, tenant_id);
        ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_pkey PRIMARY KEY USING INDEX metrics_2024_recorded_at_tenant_id_idx;
      `,
    );
    await execSql(
      pg.databaseUrl("partitioned_constraint_attached_local_desired_db"),
      `${tableSql} ALTER TABLE metrics ADD CONSTRAINT metrics_pkey PRIMARY KEY (recorded_at, tenant_id);`,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl(
          "partitioned_constraint_attached_local_current_db",
        ),
        desiredDatabaseUrl: pg.databaseUrl(
          "partitioned_constraint_attached_local_desired_db",
        ),
      }),
    ).rejects.toThrow(
      "dropping an index partition that backs a local constraint is not supported",
    );
  }, 30_000);

  it("rejects partitioned unique adds when an attached child index backs a local unique constraint", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_unique_attached_local_current_db");
    await createDatabase(pg, "partitioned_unique_attached_local_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partitioned_unique_attached_local_current_db"),
      `
        ${tableSql}
        CREATE UNIQUE INDEX metrics_recorded_tenant_key ON metrics (recorded_at, tenant_id);
        ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_recorded_at_tenant_id_key UNIQUE USING INDEX metrics_2024_recorded_at_tenant_id_idx;
      `,
    );
    await execSql(
      pg.databaseUrl("partitioned_unique_attached_local_desired_db"),
      `${tableSql} ALTER TABLE metrics ADD CONSTRAINT metrics_recorded_tenant_key UNIQUE (recorded_at, tenant_id);`,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl(
          "partitioned_unique_attached_local_current_db",
        ),
        desiredDatabaseUrl: pg.databaseUrl(
          "partitioned_unique_attached_local_desired_db",
        ),
      }),
    ).rejects.toThrow(
      "dropping an index partition that backs a local constraint is not supported",
    );
  }, 30_000);

  it("rejects partitioned unique adds when an attached child index backs a local primary key", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_unique_attached_local_pk_current_db");
    await createDatabase(pg, "partitioned_unique_attached_local_pk_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE UNIQUE INDEX metrics_2024_recorded_at_tenant_id_idx ON metrics_2024 (recorded_at, tenant_id);
      CREATE UNIQUE INDEX metrics_recorded_tenant_key ON ONLY metrics (recorded_at, tenant_id);
      ALTER INDEX metrics_recorded_tenant_key ATTACH PARTITION metrics_2024_recorded_at_tenant_id_idx;
    `;
    await execSql(
      pg.databaseUrl("partitioned_unique_attached_local_pk_current_db"),
      `${tableSql} ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_pkey PRIMARY KEY USING INDEX metrics_2024_recorded_at_tenant_id_idx;`,
    );
    await execSql(
      pg.databaseUrl("partitioned_unique_attached_local_pk_desired_db"),
      `
        CREATE TABLE metrics (
          tenant_id integer NOT NULL,
          recorded_at date NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE metrics_2024 PARTITION OF metrics
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        ALTER TABLE metrics ADD CONSTRAINT metrics_recorded_tenant_key UNIQUE (recorded_at, tenant_id);
      `,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl(
          "partitioned_unique_attached_local_pk_current_db",
        ),
        desiredDatabaseUrl: pg.databaseUrl(
          "partitioned_unique_attached_local_pk_desired_db",
        ),
      }),
    ).rejects.toThrow(
      "dropping an index partition that backs a local constraint is not supported",
    );
  }, 30_000);

  it("attaches local primary-key constraints to existing child indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_pk_existing_child_idx_current_db");
    await createDatabase(pg, "local_pk_existing_child_idx_desired_db");

    const baseSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE UNIQUE INDEX metrics_2024_pkey ON metrics_2024 (recorded_at, tenant_id);
    `;
    await execSql(
      pg.databaseUrl("local_pk_existing_child_idx_current_db"),
      baseSql,
    );
    await execSql(
      pg.databaseUrl("local_pk_existing_child_idx_desired_db"),
      `${baseSql} ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_pkey PRIMARY KEY USING INDEX metrics_2024_pkey;`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_pk_existing_child_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_pk_existing_child_idx_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_pkey" PRIMARY KEY USING INDEX "metrics_2024_pkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_pk_existing_child_idx_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_pk_existing_child_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_pk_existing_child_idx_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds local child primary-key and unique constraints with new backing indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_child_constraints_current_db");
    await createDatabase(pg, "local_child_constraints_desired_db");

    await execSql(
      pg.databaseUrl("local_child_constraints_current_db"),
      `
        CREATE SCHEMA tenant_data;
        CREATE TABLE tenant_data.metrics (
          tenant_id integer NOT NULL,
          recorded_at date NOT NULL,
          region text NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE tenant_data.metrics_2024 PARTITION OF tenant_data.metrics
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE TABLE tenant_data.metrics_2025 PARTITION OF tenant_data.metrics
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
      `,
    );
    await execSql(
      pg.databaseUrl("local_child_constraints_desired_db"),
      `
        CREATE SCHEMA tenant_data;
        CREATE TABLE tenant_data.metrics (
          tenant_id integer NOT NULL,
          recorded_at date NOT NULL,
          region text NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE tenant_data.metrics_2024 PARTITION OF tenant_data.metrics (
          CONSTRAINT metrics_2024_pkey PRIMARY KEY (recorded_at, tenant_id)
        ) FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE TABLE tenant_data.metrics_2025 PARTITION OF tenant_data.metrics (
          CONSTRAINT metrics_2025_recorded_region_key UNIQUE (recorded_at, region)
        ) FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("local_child_constraints_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("local_child_constraints_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_pkey ON tenant_data.metrics_2024 USING btree (recorded_at, tenant_id)",
      'ALTER TABLE "tenant_data"."metrics_2024" ADD CONSTRAINT "metrics_2024_pkey" PRIMARY KEY USING INDEX "metrics_2024_pkey"',
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2025_recorded_region_key ON tenant_data.metrics_2025 USING btree (recorded_at, region)",
      'ALTER TABLE "tenant_data"."metrics_2025" ADD CONSTRAINT "metrics_2025_recorded_region_key" UNIQUE USING INDEX "metrics_2025_recorded_region_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_child_constraints_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("local_child_constraints_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("local_child_constraints_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("attaches local unique constraints to existing child indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_unique_existing_child_idx_current_db");
    await createDatabase(pg, "local_unique_existing_child_idx_desired_db");

    const baseSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE UNIQUE INDEX metrics_2024_recorded_tenant_key ON metrics_2024 (recorded_at, tenant_id);
    `;
    await execSql(
      pg.databaseUrl("local_unique_existing_child_idx_current_db"),
      baseSql,
    );
    await execSql(
      pg.databaseUrl("local_unique_existing_child_idx_desired_db"),
      `${baseSql} ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_recorded_tenant_key UNIQUE USING INDEX metrics_2024_recorded_tenant_key;`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_unique_existing_child_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_unique_existing_child_idx_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_recorded_tenant_key" UNIQUE USING INDEX "metrics_2024_recorded_tenant_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_unique_existing_child_idx_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "local_unique_existing_child_idx_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "local_unique_existing_child_idx_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops local child primary-key constraints from individual partitions", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_pk_delete_current_db");
    await createDatabase(pg, "local_pk_delete_desired_db");

    const baseSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL,
        region text NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics (
        CONSTRAINT metrics_2024_pkey PRIMARY KEY (recorded_at, tenant_id)
      ) FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE TABLE metrics_2025 PARTITION OF metrics (
        CONSTRAINT metrics_2025_pkey PRIMARY KEY (recorded_at, region)
      ) FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
    `;
    await execSql(pg.databaseUrl("local_pk_delete_current_db"), baseSql);
    await execSql(
      pg.databaseUrl("local_pk_delete_desired_db"),
      `
        CREATE TABLE metrics (
          tenant_id integer NOT NULL,
          recorded_at date NOT NULL,
          region text NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE metrics_2024 PARTITION OF metrics (
          CONSTRAINT metrics_2024_pkey PRIMARY KEY (recorded_at, tenant_id)
        ) FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE TABLE metrics_2025 PARTITION OF metrics
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("local_pk_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("local_pk_delete_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."metrics_2025" DROP CONSTRAINT "metrics_2025_pkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_pk_delete_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("local_pk_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("local_pk_delete_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("switches local child primary-key constraints across schemas", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_pk_switch_current_db");
    await createDatabase(pg, "local_pk_switch_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL,
        region text NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics (
        CONSTRAINT metrics_2024_pkey PRIMARY KEY (recorded_at, tenant_id)
      ) FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      CREATE TABLE metrics_2025 PARTITION OF metrics (
        CONSTRAINT metrics_2025_pkey PRIMARY KEY (recorded_at, region)
      ) FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

      CREATE SCHEMA tenant_data;
      CREATE TABLE tenant_data.metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL,
        region text NOT NULL
      ) PARTITION BY RANGE (recorded_at);
    `;
    await execSql(
      pg.databaseUrl("local_pk_switch_current_db"),
      `
        ${tableSql}
        CREATE TABLE tenant_data.metrics_2024 PARTITION OF tenant_data.metrics
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE TABLE tenant_data.metrics_2025 PARTITION OF tenant_data.metrics
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
      `,
    );
    await execSql(
      pg.databaseUrl("local_pk_switch_desired_db"),
      `
        ${tableSql}
        CREATE TABLE tenant_data.metrics_2024 PARTITION OF tenant_data.metrics (
          CONSTRAINT metrics_2024_pkey PRIMARY KEY (recorded_at, tenant_id)
        ) FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE TABLE tenant_data.metrics_2025 PARTITION OF tenant_data.metrics (
          CONSTRAINT metrics_2025_pkey PRIMARY KEY (recorded_at, region)
        ) FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        ALTER TABLE metrics_2025 DROP CONSTRAINT metrics_2025_pkey;
        ALTER TABLE metrics_2025 ADD CONSTRAINT metrics_2025_pkey PRIMARY KEY (recorded_at, tenant_id);
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("local_pk_switch_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("local_pk_switch_desired_db"),
    });

    const sql = diff.statements.map((statement) => statement.sql);
    expect(sql).toContain(
      'ALTER TABLE "public"."metrics_2025" DROP CONSTRAINT "metrics_2025_pkey"',
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2025_pkey ON public.metrics_2025 USING btree (recorded_at, tenant_id)",
    );
    expect(sql).toContain(
      'ALTER TABLE "public"."metrics_2025" ADD CONSTRAINT "metrics_2025_pkey" PRIMARY KEY USING INDEX "metrics_2025_pkey"',
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_pkey ON tenant_data.metrics_2024 USING btree (recorded_at, tenant_id)",
    );
    expect(sql).toContain(
      'ALTER TABLE "tenant_data"."metrics_2024" ADD CONSTRAINT "metrics_2024_pkey" PRIMARY KEY USING INDEX "metrics_2024_pkey"',
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2025_pkey ON tenant_data.metrics_2025 USING btree (recorded_at, region)",
    );
    expect(sql).toContain(
      'ALTER TABLE "tenant_data"."metrics_2025" ADD CONSTRAINT "metrics_2025_pkey" PRIMARY KEY USING INDEX "metrics_2025_pkey"',
    );

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_pk_switch_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("local_pk_switch_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("local_pk_switch_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops local child unique constraints from individual partitions", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "local_unique_delete_current_db");
    await createDatabase(pg, "local_unique_delete_desired_db");

    await execSql(
      pg.databaseUrl("local_unique_delete_current_db"),
      `
        CREATE TABLE metrics (
          tenant_id integer NOT NULL,
          recorded_at date NOT NULL,
          region text NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE metrics_2024 PARTITION OF metrics (
          CONSTRAINT metrics_2024_key UNIQUE (recorded_at, tenant_id)
        ) FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE TABLE metrics_2025 PARTITION OF metrics (
          CONSTRAINT metrics_2025_key UNIQUE (recorded_at, region)
        ) FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
      `,
    );
    await execSql(
      pg.databaseUrl("local_unique_delete_desired_db"),
      `
        CREATE TABLE metrics (
          tenant_id integer NOT NULL,
          recorded_at date NOT NULL,
          region text NOT NULL
        ) PARTITION BY RANGE (recorded_at);
        CREATE TABLE metrics_2024 PARTITION OF metrics (
          CONSTRAINT metrics_2024_key UNIQUE (recorded_at, tenant_id)
        ) FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE TABLE metrics_2025 PARTITION OF metrics
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("local_unique_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("local_unique_delete_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."metrics_2025" DROP CONSTRAINT "metrics_2025_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("local_unique_delete_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("local_unique_delete_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("local_unique_delete_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partitioned unique constraints with child index attachment", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_unique_current_db");
    await createDatabase(pg, "partitioned_unique_desired_db");

    const tableSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(pg.databaseUrl("partitioned_unique_current_db"), tableSql);
    await execSql(
      pg.databaseUrl("partitioned_unique_desired_db"),
      `
        ${tableSql}
        ALTER TABLE ONLY metrics ADD CONSTRAINT metrics_recorded_at_tenant_id_key UNIQUE (recorded_at, tenant_id);
        CREATE UNIQUE INDEX metrics_2024_recorded_at_tenant_id_idx ON metrics_2024 (recorded_at, tenant_id);
        ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_recorded_at_tenant_id_idx UNIQUE USING INDEX metrics_2024_recorded_at_tenant_id_idx;
        ALTER INDEX metrics_recorded_at_tenant_id_key ATTACH PARTITION metrics_2024_recorded_at_tenant_id_idx;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_unique_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_unique_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE ONLY "public"."metrics" ADD CONSTRAINT "metrics_recorded_at_tenant_id_key" UNIQUE (recorded_at, tenant_id)',
      "CREATE UNIQUE INDEX CONCURRENTLY metrics_2024_recorded_at_tenant_id_idx ON public.metrics_2024 USING btree (recorded_at, tenant_id)",
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_recorded_at_tenant_id_idx" UNIQUE USING INDEX "metrics_2024_recorded_at_tenant_id_idx"',
      'ALTER INDEX "public"."metrics_recorded_at_tenant_id_key" ATTACH PARTITION "public"."metrics_2024_recorded_at_tenant_id_idx"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_unique_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_unique_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_unique_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds partition constraints using existing child indexes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partition_child_constraint_current_db");
    await createDatabase(pg, "partition_child_constraint_desired_db");

    const baseSql = `
      CREATE TABLE metrics (
        tenant_id integer NOT NULL,
        recorded_at date NOT NULL
      ) PARTITION BY RANGE (recorded_at);
      CREATE TABLE metrics_2024 PARTITION OF metrics
        FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
      ALTER TABLE ONLY metrics ADD CONSTRAINT metrics_tenant_recorded_key UNIQUE (recorded_at, tenant_id);
      CREATE UNIQUE INDEX metrics_2024_tenant_recorded_key ON metrics_2024(recorded_at, tenant_id);
    `;
    await execSql(
      pg.databaseUrl("partition_child_constraint_current_db"),
      baseSql,
    );
    await execSql(
      pg.databaseUrl("partition_child_constraint_desired_db"),
      `${baseSql}
       ALTER TABLE metrics_2024 ADD CONSTRAINT metrics_2024_tenant_recorded_key UNIQUE USING INDEX metrics_2024_tenant_recorded_key;
       ALTER INDEX metrics_tenant_recorded_key ATTACH PARTITION metrics_2024_tenant_recorded_key;`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partition_child_constraint_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partition_child_constraint_desired_db",
      ),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."metrics_2024" ADD CONSTRAINT "metrics_2024_tenant_recorded_key" UNIQUE USING INDEX "metrics_2024_tenant_recorded_key"',
      'ALTER INDEX "public"."metrics_tenant_recorded_key" ATTACH PARTITION "public"."metrics_2024_tenant_recorded_key"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partition_child_constraint_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "partition_child_constraint_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "partition_child_constraint_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("creates and attaches new table partitions", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partition_add_current_db");
    await createDatabase(pg, "partition_add_desired_db");

    const parentSql = `
      CREATE TABLE events (
        tenant_id integer NOT NULL,
        occurred_at date NOT NULL
      ) PARTITION BY RANGE (occurred_at);
    `;
    await execSql(pg.databaseUrl("partition_add_current_db"), parentSql);
    await execSql(
      pg.databaseUrl("partition_add_desired_db"),
      `${parentSql} CREATE TABLE events_2024 PARTITION OF events FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partition_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partition_add_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'CREATE TABLE "public"."events_2024" (\n\t"tenant_id" integer NOT NULL,\n\t"occurred_at" date NOT NULL\n)',
      'ALTER TABLE "public"."events" ATTACH PARTITION "public"."events_2024" FOR VALUES FROM (\'2024-01-01\') TO (\'2025-01-01\')',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("partition_add_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partition_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partition_add_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops partitioned tables through the parent table only", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_table_drop_current_db");
    await createDatabase(pg, "partitioned_table_drop_desired_db");

    await execSql(
      pg.databaseUrl("partitioned_table_drop_current_db"),
      `
        CREATE TABLE events (
          tenant_id integer NOT NULL,
          occurred_at date NOT NULL
        ) PARTITION BY RANGE (occurred_at);
        CREATE TABLE events_2024 PARTITION OF events FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        CREATE TABLE events_2025 PARTITION OF events FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_table_drop_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_table_drop_desired_db"),
    });

    expect(diff.statements).toEqual([
      {
        sql: 'DROP TABLE "public"."events"',
        type: "destructive",
      },
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partitioned_table_drop_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partitioned_table_drop_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partitioned_table_drop_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("rejects dropping a table partition without dropping its parent", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partition_drop_current_db");
    await createDatabase(pg, "partition_drop_desired_db");

    const parentSql = `
      CREATE TABLE events (
        tenant_id integer NOT NULL,
        occurred_at date NOT NULL
      ) PARTITION BY RANGE (occurred_at);
      CREATE TABLE events_2024 PARTITION OF events FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    `;
    await execSql(
      pg.databaseUrl("partition_drop_current_db"),
      `${parentSql} CREATE TABLE events_2025 PARTITION OF events FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');`,
    );
    await execSql(pg.databaseUrl("partition_drop_desired_db"), parentSql);

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl("partition_drop_current_db"),
        desiredDatabaseUrl: pg.databaseUrl("partition_drop_desired_db"),
      }),
    ).rejects.toThrow(
      "deleting partitions without dropping parent table is not supported",
    );
  }, 30_000);

  it("alters partition column nullability independently from the parent", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partition_nullability_current_db");
    await createDatabase(pg, "partition_nullability_desired_db");

    const parentSql = `
      CREATE TABLE events (
        tenant_id integer,
        occurred_at date NOT NULL
      ) PARTITION BY RANGE (occurred_at);
    `;
    await execSql(
      pg.databaseUrl("partition_nullability_current_db"),
      `${parentSql} CREATE TABLE events_2024 PARTITION OF events (tenant_id NOT NULL) FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');`,
    );
    await execSql(
      pg.databaseUrl("partition_nullability_desired_db"),
      `${parentSql} CREATE TABLE events_2024 PARTITION OF events FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');`,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partition_nullability_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partition_nullability_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."events_2024" ALTER COLUMN "tenant_id" DROP NOT NULL',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("partition_nullability_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("partition_nullability_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("partition_nullability_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("rejects changing a partition key definition", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partition_key_change_current_db");
    await createDatabase(pg, "partition_key_change_desired_db");

    await execSql(
      pg.databaseUrl("partition_key_change_current_db"),
      `
        CREATE TABLE events (
          tenant_id integer NOT NULL,
          occurred_at date NOT NULL
        ) PARTITION BY RANGE (occurred_at);
      `,
    );
    await execSql(
      pg.databaseUrl("partition_key_change_desired_db"),
      `
        CREATE TABLE events (
          tenant_id integer NOT NULL,
          occurred_at date NOT NULL
        ) PARTITION BY LIST (tenant_id);
      `,
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl("partition_key_change_current_db"),
        desiredDatabaseUrl: pg.databaseUrl("partition_key_change_desired_db"),
      }),
    ).rejects.toThrow("changing partition key def is not supported");
  }, 30_000);

  it("preserves sequence ownership for owned sequences", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "sequence_owner_current_db");
    await createDatabase(pg, "sequence_owner_desired_db");

    await execSql(
      pg.databaseUrl("sequence_owner_desired_db"),
      `
        CREATE SEQUENCE order_id_seq;
        CREATE TABLE orders (
          id integer DEFAULT nextval('order_id_seq')
        );
        ALTER SEQUENCE order_id_seq OWNED BY orders.id;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("sequence_owner_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("sequence_owner_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toContain(
      'ALTER SEQUENCE "public"."order_id_seq" OWNED BY "public"."orders"."id"',
    );

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("sequence_owner_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("sequence_owner_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("sequence_owner_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("omits sequence drops when dropping the owning table", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "owned_sequence_drop_current_db");
    await createDatabase(pg, "owned_sequence_drop_desired_db");

    await execSql(
      pg.databaseUrl("owned_sequence_drop_current_db"),
      "CREATE TABLE orders (id serial PRIMARY KEY)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("owned_sequence_drop_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("owned_sequence_drop_desired_db"),
    });

    expect(diff.statements).toEqual([
      {
        sql: 'DROP TABLE "public"."orders"',
        type: "destructive",
      },
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("owned_sequence_drop_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("owned_sequence_drop_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("owned_sequence_drop_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("omits sequence drops when dropping the owning column", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "owned_sequence_column_drop_current_db");
    await createDatabase(pg, "owned_sequence_column_drop_desired_db");

    await execSql(
      pg.databaseUrl("owned_sequence_column_drop_current_db"),
      "CREATE TABLE orders (id serial, note text)",
    );
    await execSql(
      pg.databaseUrl("owned_sequence_column_drop_desired_db"),
      "CREATE TABLE orders (note text)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "owned_sequence_column_drop_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "owned_sequence_column_drop_desired_db",
      ),
    });

    expect(diff.statements).toEqual([
      {
        sql: 'ALTER TABLE "public"."orders" DROP COLUMN "id"',
        type: "destructive",
      },
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("owned_sequence_column_drop_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl(
        "owned_sequence_column_drop_current_db",
      ),
      desiredDatabaseUrl: pg.databaseUrl(
        "owned_sequence_column_drop_desired_db",
      ),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("classifies unowned sequence adds and drops as destructive", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "unowned_sequence_empty_db");
    await createDatabase(pg, "unowned_sequence_drop_target_db");
    await createDatabase(pg, "unowned_sequence_desired_db");

    await execSql(
      pg.databaseUrl("unowned_sequence_desired_db"),
      "CREATE SEQUENCE ticket_seq",
    );

    const addDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("unowned_sequence_empty_db"),
      desiredDatabaseUrl: pg.databaseUrl("unowned_sequence_desired_db"),
    });
    expect(addDiff.statements).toEqual([
      {
        sql: 'CREATE SEQUENCE "public"."ticket_seq"\n\tAS bigint\n\tINCREMENT BY 1\n\tMINVALUE 1 MAXVALUE 9223372036854775807\n\tSTART WITH 1 CACHE 1 NO CYCLE',
        type: "destructive",
      },
    ]);

    for (const statement of addDiff.statements) {
      await execSql(pg.databaseUrl("unowned_sequence_empty_db"), statement.sql);
    }

    const dropDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("unowned_sequence_empty_db"),
      desiredDatabaseUrl: pg.databaseUrl("unowned_sequence_desired_db"),
    });
    expect(dropDiff.statements).toEqual([]);

    const reverseDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("unowned_sequence_desired_db"),
      desiredDatabaseUrl: pg.databaseUrl("unowned_sequence_drop_target_db"),
    });
    expect(reverseDiff.statements).toEqual([
      {
        sql: 'DROP SEQUENCE "public"."ticket_seq"',
        type: "destructive",
      },
    ]);
  }, 30_000);

  it("drops owned sequences after removing column defaults", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "owned_sequence_type_current_db");
    await createDatabase(pg, "owned_sequence_type_desired_db");

    await execSql(
      pg.databaseUrl("owned_sequence_type_current_db"),
      "CREATE TABLE orders (id serial)",
    );
    await execSql(
      pg.databaseUrl("owned_sequence_type_desired_db"),
      "CREATE TABLE orders (id text)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("owned_sequence_type_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("owned_sequence_type_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."orders" ALTER COLUMN "id" DROP DEFAULT',
      'ALTER TABLE "public"."orders" ALTER COLUMN "id" DROP NOT NULL',
      'ALTER TABLE "public"."orders" ALTER COLUMN "id" SET DATA TYPE text COLLATE "pg_catalog"."default" using "id"::text',
      'ANALYZE "public"."orders" ("id")',
      'DROP SEQUENCE "public"."orders_id_seq"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("owned_sequence_type_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("owned_sequence_type_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("owned_sequence_type_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("alters existing sequence properties without recreating the sequence", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "sequence_alter_current_db");
    await createDatabase(pg, "sequence_alter_desired_db");

    await execSql(
      pg.databaseUrl("sequence_alter_current_db"),
      "CREATE SEQUENCE ticket_seq INCREMENT BY 1 CACHE 1",
    );
    await execSql(
      pg.databaseUrl("sequence_alter_desired_db"),
      "CREATE SEQUENCE ticket_seq INCREMENT BY 5 CACHE 2 CYCLE",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("sequence_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("sequence_alter_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER SEQUENCE "public"."ticket_seq"\n\tAS bigint\n\tINCREMENT BY 5\n\tMINVALUE 1 MAXVALUE 9223372036854775807\n\tSTART WITH 1 CACHE 2 CYCLE',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("sequence_alter_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("sequence_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("sequence_alter_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("alters existing sequence ownership", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "sequence_owner_alter_current_db");
    await createDatabase(pg, "sequence_owner_alter_desired_db");

    await execSql(
      pg.databaseUrl("sequence_owner_alter_current_db"),
      `
        CREATE SEQUENCE ticket_seq;
        CREATE TABLE tickets (id integer DEFAULT nextval('ticket_seq'));
      `,
    );
    await execSql(
      pg.databaseUrl("sequence_owner_alter_desired_db"),
      `
        CREATE SEQUENCE ticket_seq;
        CREATE TABLE tickets (id integer DEFAULT nextval('ticket_seq'));
        ALTER SEQUENCE ticket_seq OWNED BY tickets.id;
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("sequence_owner_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("sequence_owner_alter_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER SEQUENCE "public"."ticket_seq" OWNED BY "public"."tickets"."id"',
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("sequence_owner_alter_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("sequence_owner_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("sequence_owner_alter_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds valid foreign keys as NOT VALID before validating them", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "fk_current_db");
    await createDatabase(pg, "fk_desired_db");

    await execSql(
      pg.databaseUrl("fk_current_db"),
      "CREATE TABLE parent (id integer PRIMARY KEY); CREATE TABLE child (parent_id integer);",
    );
    await execSql(
      pg.databaseUrl("fk_desired_db"),
      "CREATE TABLE parent (id integer PRIMARY KEY); CREATE TABLE child (parent_id integer REFERENCES parent(id));",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("fk_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("fk_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."child" ADD CONSTRAINT "child_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES parent(id) NOT VALID',
      'ALTER TABLE "public"."child" VALIDATE CONSTRAINT "child_parent_id_fkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("fk_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("fk_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("fk_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("validates existing invalid foreign keys", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "fk_validate_current_db");
    await createDatabase(pg, "fk_validate_desired_db");

    await execSql(
      pg.databaseUrl("fk_validate_current_db"),
      `
        CREATE TABLE parent (id integer PRIMARY KEY);
        CREATE TABLE child (parent_id integer);
        ALTER TABLE child ADD CONSTRAINT child_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES parent(id) NOT VALID;
      `,
    );
    await execSql(
      pg.databaseUrl("fk_validate_desired_db"),
      `
        CREATE TABLE parent (id integer PRIMARY KEY);
        CREATE TABLE child (parent_id integer REFERENCES parent(id));
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("fk_validate_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("fk_validate_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."child" VALIDATE CONSTRAINT "child_parent_id_fkey"',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("fk_validate_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("fk_validate_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("fk_validate_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("preserves enum value ordering when adding labels", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "enum_order_current_db");
    await createDatabase(pg, "enum_order_desired_db");

    await execSql(
      pg.databaseUrl("enum_order_current_db"),
      "CREATE TYPE mood AS ENUM ('sad', 'happy')",
    );
    await execSql(
      pg.databaseUrl("enum_order_desired_db"),
      "CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy')",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("enum_order_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("enum_order_desired_db"),
    });
    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      "ALTER TYPE \"public\".\"mood\" ADD VALUE 'ok' BEFORE 'happy'",
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("enum_order_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("enum_order_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("enum_order_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("recreates unused enums when labels are removed", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "enum_recreate_current_db");
    await createDatabase(pg, "enum_recreate_desired_db");

    await execSql(
      pg.databaseUrl("enum_recreate_current_db"),
      "CREATE TYPE status AS ENUM ('open', 'pending', 'closed')",
    );
    await execSql(
      pg.databaseUrl("enum_recreate_desired_db"),
      "CREATE TYPE status AS ENUM ('new', 'open', 'closed')",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("enum_recreate_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("enum_recreate_desired_db"),
    });
    expect(diff.statements).toEqual([
      {
        sql: 'DROP TYPE "public"."status"',
        type: "destructive",
      },
      {
        sql: "CREATE TYPE \"public\".\"status\" AS ENUM ('new', 'open', 'closed')",
        type: "additive",
      },
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("enum_recreate_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("enum_recreate_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("enum_recreate_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("rejects enum label removal when the enum is still used", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "enum_used_recreate_current_db");
    await createDatabase(pg, "enum_used_recreate_desired_db");

    await execSql(
      pg.databaseUrl("enum_used_recreate_current_db"),
      "CREATE TYPE status AS ENUM ('open', 'pending', 'closed'); CREATE TABLE tickets (state status)",
    );
    await execSql(
      pg.databaseUrl("enum_used_recreate_desired_db"),
      "CREATE TYPE status AS ENUM ('open', 'closed'); CREATE TABLE tickets (state status)",
    );

    await expect(
      generateSchemaDiff({
        currentDatabaseUrl: pg.databaseUrl("enum_used_recreate_current_db"),
        desiredDatabaseUrl: pg.databaseUrl("enum_used_recreate_desired_db"),
      }),
    ).rejects.toThrow(
      'removing labels from enum "public"."status" is not supported because it is used by table "public"."tickets"',
    );
  }, 30_000);

  it("filters schema objects by includeSchemas", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "filter_current_db");
    await createDatabase(pg, "filter_desired_db");

    await execSql(
      pg.databaseUrl("filter_desired_db"),
      "CREATE TABLE public.visible_table (id integer)",
    );
    await execSql(
      pg.databaseUrl("filter_desired_db"),
      "CREATE SCHEMA ignored; CREATE TABLE ignored.hidden_table (id integer);",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("filter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("filter_desired_db"),
      includeSchemas: ["public"],
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'CREATE TABLE "public"."visible_table" (\n\t"id" integer\n)',
    ]);
  }, 30_000);

  it("uses an online check-constraint sequence when changing a column to NOT NULL", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "not_null_current_db");
    await createDatabase(pg, "not_null_desired_db");

    await execSql(
      pg.databaseUrl("not_null_current_db"),
      "CREATE TABLE users (id integer)",
    );
    await execSql(
      pg.databaseUrl("not_null_desired_db"),
      "CREATE TABLE users (id integer NOT NULL)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("not_null_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("not_null_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      expect.stringMatching(
        /^ALTER TABLE "public"\."users" ADD CONSTRAINT "pgschemadiff_tmpnn_[0-9a-f]{16}" CHECK\("id" IS NOT NULL\) NOT VALID$/u,
      ),
      expect.stringMatching(
        /^ALTER TABLE "public"\."users" VALIDATE CONSTRAINT "pgschemadiff_tmpnn_[0-9a-f]{16}"$/u,
      ),
      'ALTER TABLE "public"."users" ALTER COLUMN "id" SET NOT NULL',
      expect.stringMatching(
        /^ALTER TABLE "public"\."users" DROP CONSTRAINT "pgschemadiff_tmpnn_[0-9a-f]{16}"$/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("not_null_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("not_null_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("not_null_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("adds identity to existing columns after dropping defaults", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "identity_add_current_db");
    await createDatabase(pg, "identity_add_desired_db");

    await execSql(
      pg.databaseUrl("identity_add_current_db"),
      "CREATE TABLE accounts (id bigint NOT NULL DEFAULT 5)",
    );
    await execSql(
      pg.databaseUrl("identity_add_desired_db"),
      "CREATE TABLE accounts (id bigint NOT NULL GENERATED ALWAYS AS IDENTITY)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("identity_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("identity_add_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" DROP DEFAULT',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE)',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("identity_add_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("identity_add_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("identity_add_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops changed defaults before column type changes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "default_type_current_db");
    await createDatabase(pg, "default_type_desired_db");

    await execSql(
      pg.databaseUrl("default_type_current_db"),
      "CREATE TABLE accounts (status text DEFAULT 'abc')",
    );
    await execSql(
      pg.databaseUrl("default_type_desired_db"),
      "CREATE TABLE accounts (status integer DEFAULT 0)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("default_type_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("default_type_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" ALTER COLUMN "status" DROP DEFAULT',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "status" SET DATA TYPE integer using "status"::integer',
      'ANALYZE "public"."accounts" ("status")',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "status" SET DEFAULT 0',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("default_type_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("default_type_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("default_type_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("drops identity from existing columns", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "identity_drop_current_db");
    await createDatabase(pg, "identity_drop_desired_db");

    await execSql(
      pg.databaseUrl("identity_drop_current_db"),
      "CREATE TABLE accounts (id bigint NOT NULL GENERATED ALWAYS AS IDENTITY)",
    );
    await execSql(
      pg.databaseUrl("identity_drop_desired_db"),
      "CREATE TABLE accounts (id bigint NOT NULL)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("identity_drop_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("identity_drop_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" DROP IDENTITY',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("identity_drop_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("identity_drop_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("identity_drop_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("alters existing identity properties", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "identity_alter_current_db");
    await createDatabase(pg, "identity_alter_desired_db");

    await execSql(
      pg.databaseUrl("identity_alter_current_db"),
      "CREATE TABLE accounts (id bigint GENERATED ALWAYS AS IDENTITY (MINVALUE 2 MAXVALUE 9 START 3 INCREMENT 4 CACHE 5 NO CYCLE))",
    );
    await execSql(
      pg.databaseUrl("identity_alter_desired_db"),
      "CREATE TABLE accounts (id bigint GENERATED BY DEFAULT AS IDENTITY (MINVALUE 1 MAXVALUE 90 START 30 INCREMENT 40 CACHE 50 CYCLE))",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("identity_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("identity_alter_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" SET GENERATED BY DEFAULT',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" SET INCREMENT BY 40',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" SET MINVALUE 1',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" SET MAXVALUE 90',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" SET START 30',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" SET CACHE 50',
      'ALTER TABLE "public"."accounts" ALTER COLUMN "id" SET CYCLE',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("identity_alter_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("identity_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("identity_alter_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("uses timestamp conversion and analyzes after bigint to timestamp type changes", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "type_timestamp_current_db");
    await createDatabase(pg, "type_timestamp_desired_db");

    await execSql(
      pg.databaseUrl("type_timestamp_current_db"),
      "CREATE TABLE events (occurred_at bigint)",
    );
    await execSql(
      pg.databaseUrl("type_timestamp_desired_db"),
      "CREATE TABLE events (occurred_at timestamp without time zone)",
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("type_timestamp_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("type_timestamp_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."events" ALTER COLUMN "occurred_at" SET DATA TYPE timestamp without time zone using to_timestamp("occurred_at" / 1000.0)',
      'ANALYZE "public"."events" ("occurred_at")',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("type_timestamp_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("type_timestamp_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("type_timestamp_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("alters column collation and analyzes afterward", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "collation_current_db");
    await createDatabase(pg, "collation_desired_db");

    await execSql(
      pg.databaseUrl("collation_current_db"),
      "CREATE TABLE users (name text)",
    );
    await execSql(
      pg.databaseUrl("collation_desired_db"),
      'CREATE TABLE users (name text COLLATE "C")',
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("collation_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("collation_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."users" ALTER COLUMN "name" SET DATA TYPE text COLLATE "pg_catalog"."C" using "name"::text',
      'ANALYZE "public"."users" ("name")',
    ]);

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("collation_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("collation_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("collation_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("alters ordinary triggers with CREATE OR REPLACE", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "trigger_alter_current_db");
    await createDatabase(pg, "trigger_alter_desired_db");

    await execSql(
      pg.databaseUrl("trigger_alter_current_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, active boolean NOT NULL);
        CREATE FUNCTION touch_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
        CREATE TRIGGER account_touch BEFORE INSERT ON accounts FOR EACH ROW WHEN (NEW.active) EXECUTE FUNCTION touch_account();
      `,
    );
    await execSql(
      pg.databaseUrl("trigger_alter_desired_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, active boolean NOT NULL);
        CREATE FUNCTION touch_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
        CREATE TRIGGER account_touch BEFORE INSERT ON accounts FOR EACH ROW WHEN (NOT NEW.active) EXECUTE FUNCTION touch_account();
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("trigger_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("trigger_alter_desired_db"),
    });

    expect(diff.statements).toEqual([
      {
        sql: expect.stringMatching(
          /^CREATE OR REPLACE TRIGGER account_touch BEFORE INSERT ON public\.accounts/u,
        ),
        type: "additive",
      },
    ]);
    expect(diff.statements[0]?.sql).not.toContain("DROP TRIGGER");

    for (const statement of diff.statements) {
      await execSql(pg.databaseUrl("trigger_alter_current_db"), statement.sql);
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("trigger_alter_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("trigger_alter_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("recreates changed constraint triggers", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "constraint_trigger_current_db");
    await createDatabase(pg, "constraint_trigger_desired_db");

    await execSql(
      pg.databaseUrl("constraint_trigger_current_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, active boolean NOT NULL);
        CREATE FUNCTION touch_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
        CREATE CONSTRAINT TRIGGER account_touch AFTER INSERT ON accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.active) EXECUTE FUNCTION touch_account();
      `,
    );
    await execSql(
      pg.databaseUrl("constraint_trigger_desired_db"),
      `
        CREATE TABLE accounts (id integer NOT NULL, active boolean NOT NULL);
        CREATE FUNCTION touch_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
        CREATE CONSTRAINT TRIGGER account_touch AFTER INSERT ON accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NOT NEW.active) EXECUTE FUNCTION touch_account();
      `,
    );

    const diff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("constraint_trigger_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("constraint_trigger_desired_db"),
    });

    expect(diff.statements.map((statement) => statement.sql)).toEqual([
      expect.stringMatching(
        /^DROP TRIGGER "account_touch" ON "public"\."accounts"$/u,
      ),
      expect.stringMatching(
        /^CREATE CONSTRAINT TRIGGER account_touch AFTER INSERT ON public\.accounts/u,
      ),
    ]);

    for (const statement of diff.statements) {
      await execSql(
        pg.databaseUrl("constraint_trigger_current_db"),
        statement.sql,
      );
    }

    const secondDiff = await generateSchemaDiff({
      currentDatabaseUrl: pg.databaseUrl("constraint_trigger_current_db"),
      desiredDatabaseUrl: pg.databaseUrl("constraint_trigger_desired_db"),
    });
    expect(secondDiff.statements).toEqual([]);
  }, 30_000);

  it("introspects representative PostgreSQL schema objects", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "introspection_db");
    await execSql(
      pg.databaseUrl("introspection_db"),
      `
        CREATE TYPE mood AS ENUM ('sad', 'ok');
        CREATE TABLE parent (
          id integer PRIMARY KEY,
          label text CONSTRAINT parent_label_present CHECK (label IS NOT NULL)
        );
        CREATE TABLE child (
          id integer,
          parent_id integer REFERENCES parent(id),
          mood mood DEFAULT 'ok'
        );
        CREATE INDEX child_parent_id_idx ON child(parent_id);
        CREATE SEQUENCE ticket_seq;
        CREATE FUNCTION touch_child() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER child_touch BEFORE INSERT ON child FOR EACH ROW EXECUTE FUNCTION touch_child();
        CREATE VIEW child_view AS SELECT id, parent_id FROM child;
        CREATE MATERIALIZED VIEW child_mv AS SELECT id FROM child;
        ALTER TABLE child ENABLE ROW LEVEL SECURITY;
        CREATE POLICY child_read ON child FOR SELECT USING (true);
        GRANT SELECT ON child TO PUBLIC;
      `,
    );

    const client = new Client({
      connectionString: pg.databaseUrl("introspection_db"),
    });
    await client.connect();
    try {
      const schema = await getSchema(client);
      expect(
        schema.enums.map((schemaEnum) => schemaEnum.labels),
      ).toContainEqual(["sad", "ok"]);
      expect(schema.tables.map((table) => table.name.escapedName)).toContain(
        '"child"',
      );
      expect(schema.indexes.map((index) => index.name)).toContain(
        "child_parent_id_idx",
      );
      expect(schema.foreignKeyConstraints).toHaveLength(1);
      expect(
        schema.sequences.map((sequence) => sequence.name.escapedName),
      ).toContain('"ticket_seq"');
      expect(schema.functions.map((fn) => fn.name.escapedName)).toContain(
        '"touch_child"()',
      );
      expect(schema.triggers.map((trigger) => trigger.escapedName)).toContain(
        '"child_touch"',
      );
      expect(schema.views.map((view) => view.name.escapedName)).toContain(
        '"child_view"',
      );
      expect(
        schema.materializedViews.map((view) => view.name.escapedName),
      ).toContain('"child_mv"');
      expect(
        schema.tables.find((table) => table.name.escapedName === '"child"')
          ?.policies,
      ).toHaveLength(1);
      expect(
        schema.tables.find((table) => table.name.escapedName === '"child"')
          ?.privileges,
      ).toContainEqual({
        kind: "tablePrivilege",
        grantee: "",
        privilege: "SELECT",
        isGrantable: false,
      });
    } finally {
      await client.end();
    }
  }, 30_000);

  it("introspects Go-style expected structs across schema object categories", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "go_struct_parity_introspection_db");
    await execSql(
      pg.databaseUrl("go_struct_parity_introspection_db"),
      `
        CREATE SCHEMA app;
        CREATE EXTENSION pg_trgm WITH SCHEMA app;
        CREATE TYPE app.mood AS ENUM ('sad', 'ok');
        CREATE SEQUENCE app.ticket_seq AS bigint INCREMENT BY 2 MINVALUE 10 MAXVALUE 100 START WITH 10 CACHE 3 CYCLE;
        CREATE TABLE app.parent (
          id integer GENERATED BY DEFAULT AS IDENTITY (START WITH 5),
          code text COLLATE "C" NOT NULL,
          mood app.mood DEFAULT 'ok'::app.mood,
          normalized text GENERATED ALWAYS AS (lower(code)) STORED,
          CONSTRAINT parent_pkey PRIMARY KEY (id)
        );
        ALTER TABLE app.parent ADD CONSTRAINT parent_code_check CHECK (length(code) > 0) NOT VALID;
        ALTER TABLE app.parent ENABLE ROW LEVEL SECURITY;
        ALTER TABLE app.parent FORCE ROW LEVEL SECURITY;
        CREATE POLICY parent_read ON app.parent FOR SELECT TO PUBLIC USING (code IS NOT NULL);
        GRANT SELECT ON app.parent TO PUBLIC;
        CREATE TABLE app.child (
          id integer PRIMARY KEY,
          parent_id integer NOT NULL
        );
        ALTER TABLE app.child ADD CONSTRAINT child_parent_fk FOREIGN KEY (parent_id) REFERENCES app.parent(id) NOT VALID;
        CREATE INDEX child_parent_idx ON app.child(parent_id);
        CREATE FUNCTION app.base_fn() RETURNS integer LANGUAGE SQL IMMUTABLE RETURN 1;
        CREATE FUNCTION app.dependent_fn() RETURNS integer LANGUAGE SQL IMMUTABLE RETURN app.base_fn();
        CREATE PROCEDURE app.touch_proc() LANGUAGE SQL AS $$ SELECT 1 $$;
        CREATE FUNCTION app.touch_child() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER child_touch BEFORE INSERT ON app.child FOR EACH ROW EXECUTE FUNCTION app.touch_child();
        CREATE VIEW app.child_view WITH (security_barrier = true) AS SELECT id, parent_id FROM app.child;
        CREATE MATERIALIZED VIEW app.child_mv WITH (autovacuum_enabled = false) AS SELECT id FROM app.child;
      `,
    );

    const client = new Client({
      connectionString: pg.databaseUrl("go_struct_parity_introspection_db"),
    });
    await client.connect();
    try {
      const schema = await getSchema(client);
      const parentTable = schema.tables.find(
        (table) => table.name.escapedName === '"parent"',
      );
      const childTable = schema.tables.find(
        (table) => table.name.escapedName === '"child"',
      );
      const codeColumn = parentTable?.columns.find(
        (column) => column.name === "code",
      );
      const idColumn = parentTable?.columns.find(
        (column) => column.name === "id",
      );
      const normalizedColumn = parentTable?.columns.find(
        (column) => column.name === "normalized",
      );
      const checkConstraint = parentTable?.checkConstraints.find(
        (constraint) => constraint.name === "parent_code_check",
      );
      const parentPolicy = parentTable?.policies.find(
        (policy) => policy.escapedName === '"parent_read"',
      );
      const childIndex = schema.indexes.find(
        (index) => index.name === "child_parent_idx",
      );
      const childFk = schema.foreignKeyConstraints.find(
        (fk) => fk.escapedName === '"child_parent_fk"',
      );
      const ticketSeq = schema.sequences.find(
        (sequence) => sequence.name.escapedName === '"ticket_seq"',
      );
      const dependentFn = schema.functions.find(
        (fn) => fn.name.escapedName === '"dependent_fn"()',
      );
      const procedure = schema.procedures.find(
        (proc) => proc.name.escapedName === '"touch_proc"()',
      );
      const trigger = schema.triggers.find(
        (item) => item.escapedName === '"child_touch"',
      );
      const childView = schema.views.find(
        (view) => view.name.escapedName === '"child_view"',
      );
      const childMaterializedView = schema.materializedViews.find(
        (view) => view.name.escapedName === '"child_mv"',
      );

      expect(schema.namedSchemas).toContainEqual({
        kind: "namedSchema",
        name: "app",
      });
      expect(
        schema.extensions.find(
          (extension) => extension.name.escapedName === '"pg_trgm"',
        ),
      ).toMatchObject({
        kind: "extension",
        name: schemaQualifiedName("app", "pg_trgm"),
        version: expect.any(String),
      });
      expect(
        schema.enums.find(
          (schemaEnum) => schemaEnum.name.escapedName === '"mood"',
        ),
      ).toEqual({
        kind: "enum",
        name: schemaQualifiedName("app", "mood"),
        labels: ["sad", "ok"],
      });
      expect(parentTable).toMatchObject({
        kind: "table",
        name: schemaQualifiedName("app", "parent"),
        replicaIdentity: "d",
        rlsEnabled: true,
        rlsForced: true,
        partitionKeyDef: "",
        parentTable: null,
        forValues: "",
      });
      expect(idColumn).toMatchObject({
        kind: "column",
        name: "id",
        type: "integer",
        default: "",
        isGenerated: false,
        isNullable: false,
        identity: { type: "d", startValue: 5n },
      });
      expect(codeColumn).toMatchObject({
        kind: "column",
        name: "code",
        type: "text",
        collation: schemaQualifiedName("pg_catalog", "C"),
        default: "",
        isNullable: false,
      });
      expect(normalizedColumn).toMatchObject({
        kind: "column",
        name: "normalized",
        type: "text",
        isGenerated: true,
        generationExpression: "lower(code)",
      });
      expect(checkConstraint).toMatchObject({
        kind: "checkConstraint",
        name: "parent_code_check",
        isValid: false,
        isInheritable: true,
      });
      expect(parentPolicy).toMatchObject({
        kind: "policy",
        escapedName: '"parent_read"',
        isPermissive: true,
        appliesTo: ["PUBLIC"],
        cmd: "r",
        usingExpression: "(code IS NOT NULL)",
      });
      expect(parentTable?.privileges).toContainEqual({
        kind: "tablePrivilege",
        grantee: "",
        privilege: "SELECT",
        isGrantable: false,
      });
      expect(childTable).toMatchObject({
        kind: "table",
        name: schemaQualifiedName("app", "child"),
      });
      expect(childIndex).toMatchObject({
        kind: "index",
        name: "child_parent_idx",
        owningRelName: schemaQualifiedName("app", "child"),
        owningRelKind: "r",
        columns: ["parent_id"],
        isInvalid: false,
        isUnique: false,
        constraint: null,
        parentIdx: null,
      });
      expect(childFk).toMatchObject({
        kind: "foreignKeyConstraint",
        escapedName: '"child_parent_fk"',
        owningTable: schemaQualifiedName("app", "child"),
        foreignTable: schemaQualifiedName("app", "parent"),
        isValid: false,
      });
      expect(ticketSeq).toMatchObject({
        kind: "sequence",
        name: schemaQualifiedName("app", "ticket_seq"),
        owner: null,
        type: "bigint",
        startValue: 10n,
        increment: 2n,
        maxValue: 100n,
        minValue: 10n,
        cacheSize: 3n,
        cycle: true,
      });
      expect(dependentFn).toMatchObject({
        kind: "function",
        name: { schemaName: "app", escapedName: '"dependent_fn"()' },
        returnType: "integer",
        language: "sql",
        dependsOnFunctions: [{ schemaName: "app", escapedName: '"base_fn"()' }],
      });
      expect(procedure).toMatchObject({
        kind: "procedure",
        name: { schemaName: "app", escapedName: '"touch_proc"()' },
      });
      expect(trigger).toMatchObject({
        kind: "trigger",
        escapedName: '"child_touch"',
        owningTable: schemaQualifiedName("app", "child"),
        functionName: { schemaName: "app", escapedName: '"touch_child"()' },
        isConstraint: false,
      });
      expect(childView).toMatchObject({
        kind: "view",
        name: schemaQualifiedName("app", "child_view"),
        outputColumns: [
          { name: "id", type: "integer" },
          { name: "parent_id", type: "integer" },
        ],
        options: { security_barrier: "true" },
        tableDependencies: [
          {
            name: schemaQualifiedName("app", "child"),
            columns: ["id", "parent_id"],
          },
        ],
      });
      expect(childMaterializedView).toMatchObject({
        kind: "materializedView",
        name: schemaQualifiedName("app", "child_mv"),
        outputColumns: [{ name: "id", type: "integer" }],
        options: { autovacuum_enabled: "false" },
        tableDependencies: [
          { name: schemaQualifiedName("app", "child"), columns: ["id"] },
        ],
      });
    } finally {
      await client.end();
    }
  }, 30_000);

  it("introspects partitioned constraint-backed indexes with parent metadata", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "partitioned_index_introspection_db");
    await execSql(
      pg.databaseUrl("partitioned_index_introspection_db"),
      `
        CREATE TABLE foobar (
          id integer NOT NULL,
          foo text NOT NULL
        ) PARTITION BY LIST (foo);
        CREATE TABLE foobar_1 PARTITION OF foobar FOR VALUES IN ('foo_1');
        ALTER TABLE ONLY foobar ADD CONSTRAINT foobar_foo_id_key UNIQUE (foo, id);
        CREATE UNIQUE INDEX foobar_1_foo_id_key ON foobar_1(foo, id);
        ALTER TABLE foobar_1 ADD CONSTRAINT foobar_1_foo_id_key UNIQUE USING INDEX foobar_1_foo_id_key;
        ALTER INDEX foobar_foo_id_key ATTACH PARTITION foobar_1_foo_id_key;
      `,
    );

    const client = new Client({
      connectionString: pg.databaseUrl("partitioned_index_introspection_db"),
    });
    await client.connect();
    try {
      const schema = await getSchema(client);
      const parentIndex = schema.indexes.find(
        (index) => index.name === "foobar_foo_id_key",
      );
      const childIndex = schema.indexes.find(
        (index) => index.name === "foobar_1_foo_id_key",
      );

      expect(parentIndex).toMatchObject({
        kind: "index",
        name: "foobar_foo_id_key",
        owningRelName: schemaQualifiedName("public", "foobar"),
        owningRelKind: "p",
        columns: ["foo", "id"],
        isInvalid: false,
        isUnique: true,
        constraint: {
          type: "u",
          escapedConstraintName: '"foobar_foo_id_key"',
          constraintDef: "UNIQUE (foo, id)",
          isLocal: true,
        },
        parentIdx: null,
      });
      expect(childIndex).toMatchObject({
        kind: "index",
        name: "foobar_1_foo_id_key",
        owningRelName: schemaQualifiedName("public", "foobar_1"),
        owningRelKind: "r",
        columns: ["foo", "id"],
        isInvalid: false,
        isUnique: true,
        constraint: {
          type: "u",
          escapedConstraintName: '"foobar_1_foo_id_key"',
          constraintDef: "UNIQUE (foo, id)",
          isLocal: false,
        },
        parentIdx: schemaQualifiedName("public", "foobar_foo_id_key"),
      });
    } finally {
      await client.end();
    }
  }, 30_000);

  it("reconstructs the same schema from one snapshot query", async () => {
    const pg = requireHarness();
    await createDatabase(pg, "single_query_snapshot_db");
    await execSql(
      pg.databaseUrl("single_query_snapshot_db"),
      `
        CREATE TYPE account_state AS ENUM ('active', 'disabled');
        CREATE TABLE accounts (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          state account_state NOT NULL,
          balance integer NOT NULL CHECK (balance >= 0)
        );
        CREATE INDEX accounts_state_idx ON accounts (state);
        ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
        CREATE POLICY accounts_read ON accounts FOR SELECT USING (true);
        CREATE FUNCTION touch_account() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER accounts_touch BEFORE UPDATE ON accounts
          FOR EACH ROW EXECUTE FUNCTION touch_account();
        CREATE TABLE unrelated (id integer PRIMARY KEY);
        CREATE FUNCTION unrelated_function() RETURNS integer
          LANGUAGE sql RETURN 1;
        CREATE SCHEMA private_data;
        CREATE TABLE private_data.secret_table (id integer PRIMARY KEY);
      `,
    );

    const client = new Client({
      connectionString: pg.databaseUrl("single_query_snapshot_db"),
    });
    await client.connect();
    try {
      const directSchema = await getSchema(client, {
        includeSchemas: ["public"],
      });
      const result = await client.query(buildSchemaSnapshotSql());
      const snapshotSchema = await getSchemaFromSnapshot(
        result.rows[0]?.schema_snapshot,
        { includeSchemas: ["public"] },
      );

      expect(snapshotSchema).toEqual(directSchema);

      const scopedResult = await client.query(
        buildSchemaSnapshotSql({
          includeSchemas: ["public"],
          tableName: "accounts",
        }),
      );
      const scopedSchema = await getSchemaFromSnapshot(
        scopedResult.rows[0]?.schema_snapshot,
        { includeSchemas: ["public"] },
      );
      expect(
        filterSchemaForTable(scopedSchema, { tableName: "accounts" }),
      ).toEqual(filterSchemaForTable(directSchema, { tableName: "accounts" }));
    } finally {
      await client.end();
    }
  }, 30_000);
});

async function startPostgres(): Promise<PgHarness> {
  const dataDir = await mkdtemp(join(tmpdir(), "ts-pg-schema-diff-"));
  await execFileAsync("initdb", [
    "-U",
    "postgres",
    "-D",
    dataDir,
    "-A",
    "trust",
  ]);

  const { spawn } = await import("node:child_process");
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const process = spawn(
    "postgres",
    ["-D", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    {
      stdio: ["ignore", "ignore", "ignore"],
    },
  );

  const databaseUrl = (dbName: string): string =>
    `postgresql://postgres@127.0.0.1:${port}/${dbName}`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await execSql(databaseUrl("postgres"), "SELECT 1");
      return {
        databaseUrl,
        stop: async () => {
          process.kill("SIGINT");
          await new Promise<void>((resolve) => {
            process.once("exit", () => resolve());
          });
          await rm(dataDir, { recursive: true, force: true });
        },
      };
    } catch {
      await delay(500);
    }
  }

  process.kill("SIGINT");
  throw new Error("PostgreSQL did not start within the expected time");
}

function externalPostgres(baseDatabaseUrl: string): PgHarness {
  return {
    databaseUrl: (dbName: string): string => {
      const url = new URL(baseDatabaseUrl);
      url.pathname = `/${dbName}`;
      return url.toString();
    },
    stop: async () => {},
  };
}

function requireHarness(): PgHarness {
  if (harness === null) {
    throw new Error("PostgreSQL harness has not started");
  }
  return harness;
}

async function createDatabase(pg: PgHarness, name: string): Promise<void> {
  await execSql(pg.databaseUrl("postgres"), `CREATE DATABASE "${name}"`);
}

async function execSql(databaseUrl: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function dumpSchema(databaseUrl: string): Promise<string> {
  const result = await execFileAsync("pg_dump", [
    databaseUrl,
    "--schema-only",
    "--no-owner",
    "--restrict-key",
    "tspgschemadiffrestrict",
  ]);
  return result.stdout;
}
