import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateSchemaDiff,
  NotImplementedMigrationError,
  PgSchemaDiffError,
  UnsupportedPostgresVersionError,
} from "ts-pg-schema-diff";
import {
  detectDestructiveStatements,
  generateNeonMigrationStatements,
  MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS,
  MIGRATION_SCHEMA_DIFF_INCLUDE_SCHEMAS,
  deriveDestructiveReasons,
  logger,
} from "./migration_utils";
import { DyadErrorKind } from "@/errors/dyad_error";

vi.mock("ts-pg-schema-diff", async () => {
  const actual =
    await vi.importActual<typeof import("ts-pg-schema-diff")>(
      "ts-pg-schema-diff",
    );
  return {
    ...actual,
    generateSchemaDiff: vi.fn(),
  };
});

const generateSchemaDiffMock = vi.mocked(generateSchemaDiff);

describe("generateNeonMigrationStatements", () => {
  beforeEach(() => {
    generateSchemaDiffMock.mockReset();
  });

  it("diffs prod as current against dev as desired with transactional index SQL", async () => {
    generateSchemaDiffMock.mockResolvedValue({
      statements: [
        { sql: 'CREATE TABLE "users" ("id" integer)', type: "additive" },
        { sql: 'ALTER TABLE "users" ADD COLUMN "name" text', type: "additive" },
      ],
    });

    const statements = await generateNeonMigrationStatements({
      currentDatabaseUrl: "postgresql://prod",
      desiredDatabaseUrl: "postgresql://dev",
    });

    expect(statements).toEqual([
      { sql: 'CREATE TABLE "users" ("id" integer)', type: "additive" },
      { sql: 'ALTER TABLE "users" ADD COLUMN "name" text', type: "additive" },
    ]);
    expect(generateSchemaDiffMock).toHaveBeenCalledWith({
      currentDatabaseUrl: "postgresql://prod",
      desiredDatabaseUrl: "postgresql://dev",
      includeSchemas: MIGRATION_SCHEMA_DIFF_INCLUDE_SCHEMAS,
      noConcurrentIndexOperations: true,
      rejectEnumValueUsageInSameTransaction: true,
      connection: MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS,
    });
  });

  it("maps unsupported schema changes to precondition errors", async () => {
    generateSchemaDiffMock.mockRejectedValue(
      new NotImplementedMigrationError(
        "changing partition key def is not supported",
      ),
    );

    await expect(
      generateNeonMigrationStatements({
        currentDatabaseUrl: "postgresql://prod",
        desiredDatabaseUrl: "postgresql://dev",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message:
        "Unsupported schema change: changing partition key def is not supported",
    });
  });

  it("maps wrapped unsupported postgres versions to precondition errors", async () => {
    generateSchemaDiffMock.mockRejectedValue(
      new PgSchemaDiffError("Failed to introspect current database schema", {
        cause: new UnsupportedPostgresVersionError(130000),
      }),
    );

    await expect(
      generateNeonMigrationStatements({
        currentDatabaseUrl: "postgresql://prod",
        desiredDatabaseUrl: "postgresql://dev",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message:
        "PostgreSQL server version 130000 is not supported; PostgreSQL 14 or newer is required",
    });
  });

  it("maps introspection failures to external errors", async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => {});
    generateSchemaDiffMock.mockRejectedValue(
      new PgSchemaDiffError("Failed to introspect current database schema", {
        cause: new Error("connect ECONNRESET"),
      }),
    );

    await expect(
      generateNeonMigrationStatements({
        currentDatabaseUrl: "postgresql://prod",
        desiredDatabaseUrl: "postgresql://dev",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message:
        "Failed to compute migration plan: Failed to introspect current database schema: Error: connect ECONNRESET",
    });
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Failed to compute migration plan. Cause chain:",
      expect.stringContaining(
        "PgSchemaDiffError: Failed to introspect current database schema",
      ),
    );
    expect(loggerErrorSpy.mock.calls[0]?.[1]).toContain(
      "caused by: Error: connect ECONNRESET",
    );
    loggerErrorSpy.mockRestore();
  });
});

describe("detectDestructiveStatements", () => {
  it("flags DROP TABLE / DROP COLUMN / TRUNCATE / ALTER COLUMN TYPE", () => {
    const statements = additiveStatements([
      'CREATE TABLE "x" ("id" serial);',
      'DROP TABLE "old";',
      'ALTER TABLE "users" DROP COLUMN "legacy_id";',
      'TRUNCATE "events";',
      'ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE bigint;',
      'DROP SCHEMA "stale" CASCADE;',
    ]);

    const result = detectDestructiveStatements(statements);

    expect(result).toEqual([
      { index: 1, reason: "drop_table" },
      { index: 2, reason: "drop_column" },
      { index: 3, reason: "truncate" },
      { index: 4, reason: "alter_column_type" },
      { index: 5, reason: "drop_schema" },
    ]);
  });

  it("returns empty for purely additive migrations", () => {
    const result = detectDestructiveStatements(
      additiveStatements([
        'CREATE TABLE "x" ("id" serial);',
        'ALTER TABLE "x" ADD COLUMN "name" text;',
        'CREATE INDEX "idx" ON "x" ("id");',
      ]),
    );
    expect(result).toEqual([]);
  });

  it("uses schema-diff classification when no regex reason matches", () => {
    const result = detectDestructiveStatements([
      {
        sql: 'GRANT SELECT ON TABLE "users" TO "app_user";',
        type: "destructive",
      },
    ]);

    expect(result).toEqual([{ index: 0, reason: "schema_hazard" }]);
  });

  it("does not treat routine index creation as destructive", () => {
    const result = detectDestructiveStatements([
      {
        sql: 'CREATE INDEX "users_email_idx" ON "users" ("email");',
        type: "destructive",
      },
      {
        sql: 'CREATE UNIQUE INDEX CONCURRENTLY "users_name_idx" ON "users" ("name");',
        type: "destructive",
      },
    ]);

    expect(result).toEqual([]);
  });

  it("only flags each statement once", () => {
    const result = detectDestructiveStatements(
      destructiveStatements([
        'ALTER TABLE "x" DROP COLUMN "a", ALTER COLUMN "b" SET DATA TYPE bigint;',
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("drop_column");
  });
});

describe("deriveDestructiveReasons", () => {
  it("returns a unique reason code per destructive statement", () => {
    const reasons = deriveDestructiveReasons([
      { index: 0, reason: "drop_table" },
      { index: 1, reason: "drop_column" },
      { index: 2, reason: "drop_column" },
      { index: 3, reason: "alter_column_type" },
    ]);

    expect(reasons).toEqual(["drop_table", "drop_column", "alter_column_type"]);
  });

  it("returns empty when there are no destructive statements", () => {
    expect(deriveDestructiveReasons([])).toEqual([]);
  });
});

function additiveStatements(statements: readonly string[]) {
  return statements.map((sql) => ({ sql, type: "additive" as const }));
}

function destructiveStatements(statements: readonly string[]) {
  return statements.map((sql) => ({ sql, type: "destructive" as const }));
}
