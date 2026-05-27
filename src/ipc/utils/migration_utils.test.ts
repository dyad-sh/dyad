import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import {
  generateSchemaDiff,
  NotImplementedMigrationError,
  PgSchemaDiffError,
  UnsupportedPostgresVersionError,
} from "ts-pg-schema-diff";
import {
  BASELINE_SQL_BODY,
  areMigrationDepsInstalled,
  assertGenerateArtifactsComplete,
  detectDestructiveStatements,
  detectDrizzleKitFailureInStderr,
  generateNeonMigrationStatements,
  MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS,
  MIGRATION_SCHEMA_DIFF_INCLUDE_SCHEMAS,
  parseDrizzleMigrationFile,
  deriveDestructiveReasons,
  getInstalledDrizzleKitMajor,
  readPendingMigrationFiles,
  type DrizzleKitMajor,
} from "./migration_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

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

// Per-layout fixture writers. v0 = journal + `<tag>.sql` + `meta/<idx>_snapshot.json`;
// v1 = `<tag>/migration.sql` + `<tag>/snapshot.json`. Mirrors what
// drizzle-kit writes for each major.
async function writeV0Migration(
  drizzleDir: string,
  entries: Array<{ idx: number; tag: string; sql: string }>,
): Promise<void> {
  await fs.mkdir(path.join(drizzleDir, "meta"), { recursive: true });
  await fs.writeFile(
    path.join(drizzleDir, "meta", "_journal.json"),
    JSON.stringify({ entries: entries.map(({ idx, tag }) => ({ idx, tag })) }),
    "utf-8",
  );
  for (const { idx, tag, sql } of entries) {
    await fs.writeFile(path.join(drizzleDir, `${tag}.sql`), sql, "utf-8");
    await fs.writeFile(
      path.join(
        drizzleDir,
        "meta",
        `${String(idx).padStart(4, "0")}_snapshot.json`,
      ),
      "{}",
      "utf-8",
    );
  }
}

async function writeV1Migration(
  drizzleDir: string,
  entries: Array<{ tag: string; sql: string }>,
): Promise<void> {
  await fs.mkdir(drizzleDir, { recursive: true });
  for (const { tag, sql } of entries) {
    const migrationDir = path.join(drizzleDir, tag);
    await fs.mkdir(migrationDir, { recursive: true });
    await fs.writeFile(path.join(migrationDir, "migration.sql"), sql, "utf-8");
    await fs.writeFile(path.join(migrationDir, "snapshot.json"), "{}", "utf-8");
  }
}

// Sample inputs are anchored to the format drizzle-kit `generate` writes:
// SQL files separated by `--> statement-breakpoint` markers on their own
// lines. Re-validate when MIGRATION_DEPS bumps drizzle-kit.

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
      'CREATE TABLE "users" ("id" integer)',
      'ALTER TABLE "users" ADD COLUMN "name" text',
    ]);
    expect(generateSchemaDiffMock).toHaveBeenCalledWith({
      currentDatabaseUrl: "postgresql://prod",
      desiredDatabaseUrl: "postgresql://dev",
      includeSchemas: MIGRATION_SCHEMA_DIFF_INCLUDE_SCHEMAS,
      noConcurrentIndexOperations: true,
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
        "Failed to compute migration plan: Failed to introspect current database schema",
    });
  });
});

describe("parseDrizzleMigrationFile", () => {
  it("returns a single statement when there are no breakpoints", () => {
    const sql = `CREATE TABLE "users" (\n\t"id" serial PRIMARY KEY NOT NULL,\n\t"email" text NOT NULL\n);\n`;
    const statements = parseDrizzleMigrationFile(sql);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('CREATE TABLE "users"');
    expect(statements[0]).toContain('"email" text NOT NULL');
  });

  it("splits multiple statements on the breakpoint marker", () => {
    const sql = [
      'ALTER TABLE "users" ADD COLUMN "email" text;',
      "--> statement-breakpoint",
      'CREATE TABLE "posts" (',
      '\t"id" serial PRIMARY KEY NOT NULL,',
      '\t"title" text NOT NULL',
      ");",
      "--> statement-breakpoint",
      'DROP TABLE "old";',
      "",
    ].join("\n");

    const statements = parseDrizzleMigrationFile(sql);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe('ALTER TABLE "users" ADD COLUMN "email" text;');
    expect(statements[1]).toContain('CREATE TABLE "posts"');
    expect(statements[1]).toContain('"title" text NOT NULL');
    expect(statements[2]).toBe('DROP TABLE "old";');
  });

  it("returns an empty array for a comment-only file (the baseline shape)", () => {
    const sql =
      "-- Baseline: prod schema captured at bootstrap. Intentionally no-op; the snapshot\n" +
      "-- (meta/0000_snapshot.json) is the authoritative anchor for diffing.\n";

    expect(parseDrizzleMigrationFile(sql)).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseDrizzleMigrationFile("")).toEqual([]);
    expect(parseDrizzleMigrationFile("\n\n\n")).toEqual([]);
  });

  it("does not split on the marker text inside a SQL string literal", () => {
    // Marker at end-of-line splits; same text mid-line (e.g. inside a quoted
    // value) must NOT split. The regex anchors to $ with the m flag so the
    // literal — which continues past the marker — never matches.
    const sql = [
      `INSERT INTO "logs" ("note") VALUES ('--> statement-breakpoint inline');`,
      "--> statement-breakpoint",
      'CREATE TABLE "x" ("id" serial);',
    ].join("\n");

    const statements = parseDrizzleMigrationFile(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("INSERT INTO");
    expect(statements[0]).toContain("inline");
    expect(statements[1]).toBe('CREATE TABLE "x" ("id" serial);');
  });

  it("splits when the marker follows a semicolon on the same line", () => {
    // drizzle-kit `generate` emits the marker directly after the closing `;`
    // with no preceding newline. Without same-line support, the entire file
    // collapses into a single statement and Neon HTTP rejects the multi-
    // command prepared statement at apply time.
    const sql =
      'ALTER TABLE "todos" DROP COLUMN "column_1";--> statement-breakpoint\n' +
      'ALTER TABLE "todos" DROP COLUMN "column_2";\n';

    const statements = parseDrizzleMigrationFile(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('ALTER TABLE "todos" DROP COLUMN "column_1";');
    expect(statements[1]).toBe('ALTER TABLE "todos" DROP COLUMN "column_2";');
  });

  it("strips ANSI codes that may have leaked into the file", () => {
    const sql =
      '\x1b[34mCREATE TABLE "x" ("id" serial);\x1b[0m\n' +
      "--> statement-breakpoint\n" +
      '\x1b[31mDROP TABLE "old";\x1b[0m\n';

    const statements = parseDrizzleMigrationFile(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('CREATE TABLE "x" ("id" serial);');
    expect(statements[1]).toBe('DROP TABLE "old";');
  });
});

describe("detectDestructiveStatements", () => {
  it("flags DROP TABLE / DROP COLUMN / TRUNCATE / ALTER COLUMN TYPE", () => {
    const statements = [
      'CREATE TABLE "x" ("id" serial);',
      'DROP TABLE "old";',
      'ALTER TABLE "users" DROP COLUMN "legacy_id";',
      'TRUNCATE "events";',
      'ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE bigint;',
      'DROP SCHEMA "stale" CASCADE;',
    ];

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
    const result = detectDestructiveStatements([
      'CREATE TABLE "x" ("id" serial);',
      'ALTER TABLE "x" ADD COLUMN "name" text;',
      'CREATE INDEX "idx" ON "x" ("id");',
    ]);
    expect(result).toEqual([]);
  });

  it("only flags each statement once", () => {
    const result = detectDestructiveStatements([
      'ALTER TABLE "x" DROP COLUMN "a", ALTER COLUMN "b" SET DATA TYPE bigint;',
    ]);
    expect(result).toHaveLength(1);
    // First match wins; drop_column comes before alter_column_type.
    expect(result[0].reason).toBe("drop_column");
  });
});

describe("detectDrizzleKitFailureInStderr", () => {
  // The patterns here cover failure modes where drizzle-kit prints an error
  // to stderr but the Node utility process doesn't emit a clean non-zero
  // exit (esbuild service still running, neon websocket open, etc.).
  // Without this scan, those failures slip past the exit-code gate and the
  // user is told their schemas are already in sync.

  it("returns the trimmed stderr when esbuild Transform fails", () => {
    const stderr = [
      "Error: Transform failed with 1 error:",
      "/tmp/dyad-migration-app-7/dev-schema-out/schema.ts:18:35: ERROR: Unterminated string literal",
      "    at failureErrorWithLog (/path/to/esbuild/lib/main.js:1467:15)",
      "",
    ].join("\n");

    const detected = detectDrizzleKitFailureInStderr(stderr);
    expect(detected).not.toBeNull();
    expect(detected).toContain("Transform failed");
    expect(detected).toContain("failureErrorWithLog");
  });

  it("returns the trimmed stderr for any leading 'Error:' line", () => {
    const stderr = "Error: connect ECONNREFUSED 127.0.0.1:5432\n";
    expect(detectDrizzleKitFailureInStderr(stderr)).toBe(
      "Error: connect ECONNREFUSED 127.0.0.1:5432",
    );
  });

  it("returns the trimmed stderr for an Error subclass like ReferenceError", () => {
    // When drizzle-kit produces an introspected schema.ts that references a
    // type it couldn't map (e.g. an unmapped column type emitting `unknown`),
    // the second `generate` run crashes with a Node runtime error like
    // `ReferenceError: unknown is not defined`. The previous pattern only
    // matched leading `Error:`, so these crashes slipped through and the
    // user was told their schemas were already in sync.
    const stderr = [
      "ReferenceError: unknown is not defined",
      "    at <anonymous> (/tmp/dyad-migration-app-14/dev-schema-out/schema.ts:12:32)",
      "",
    ].join("\n");

    const detected = detectDrizzleKitFailureInStderr(stderr);
    expect(detected).not.toBeNull();
    expect(detected).toContain("ReferenceError:");
  });

  it("returns the trimmed stderr for a TypeError", () => {
    const stderr = "TypeError: Cannot read properties of undefined\n";
    expect(detectDrizzleKitFailureInStderr(stderr)).toBe(
      "TypeError: Cannot read properties of undefined",
    );
  });

  it("returns null for empty or whitespace-only stderr", () => {
    expect(detectDrizzleKitFailureInStderr("")).toBeNull();
    expect(detectDrizzleKitFailureInStderr("   \n\t\n")).toBeNull();
  });

  it("returns null for benign stderr that doesn't match a failure pattern", () => {
    // drizzle-kit and its deps occasionally emit deprecation/info warnings
    // on stderr that are not failures. Without this exclusion the scan
    // would turn every such warning into a hard migration failure.
    const stderr =
      "warning: experimental dialect 'postgresql' may change in future releases\n";
    expect(detectDrizzleKitFailureInStderr(stderr)).toBeNull();
  });
});

// Shared behavior contract for `assertGenerateArtifactsComplete` across both
// layouts:
//   1. No artifacts AND clean spawn → return 0 (genuine no-op generate).
//   2. No artifacts AND idle settle with stderr → throw (suspicious:
//      drizzle-kit normally writes its artifacts before going quiet).
//   3. Artifacts present but incomplete (missing SQL / snapshot) → throw
//      regardless of how we settled.
describe.each<{ major: DrizzleKitMajor; label: string }>([
  { major: 0, label: "v0 layout" },
  { major: 1, label: "v1 layout" },
])("assertGenerateArtifactsComplete ($label)", ({ major }) => {
  async function makeTempDrizzleDir(): Promise<string> {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-"),
    );
    return dir;
  }

  it("returns 0 when there are no artifacts and the spawn settled cleanly", async () => {
    const dir = await makeTempDrizzleDir();
    try {
      const count = await assertGenerateArtifactsComplete(
        dir,
        { terminatedReason: "exit", stderr: "" },
        major,
      );
      expect(count).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when the spawn went idle with stderr but no artifacts were written", async () => {
    // Real-world shape: an esbuild Transform error on the introspected
    // schema crashes drizzle-kit before it can write any artifacts, but the
    // esbuild service subprocess holds the parent open so the spawn
    // settles via idle (`exitCode: null`). Returning 0 here would let the
    // caller proudly report "already in sync".
    const dir = await makeTempDrizzleDir();
    try {
      await expect(
        assertGenerateArtifactsComplete(
          dir,
          {
            terminatedReason: "idle",
            stderr:
              "Error: Transform failed with 1 error:\n  schema.ts:18:35\n",
          },
          major,
        ),
      ).rejects.toBeInstanceOf(DyadError);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 0 when the spawn went idle but stderr is empty (benign no-op)", async () => {
    // drizzle-kit can finish quickly enough that we settle on idle without
    // it printing anything to stderr. With an empty stderr there's no
    // signal of a failure, so this remains a legitimate no-op generate.
    const dir = await makeTempDrizzleDir();
    try {
      const count = await assertGenerateArtifactsComplete(
        dir,
        { terminatedReason: "idle", stderr: "" },
        major,
      );
      expect(count).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when an entry is missing its SQL file", async () => {
    const dir = await makeTempDrizzleDir();
    try {
      if (major === 0) {
        // Journal references a tag, snapshot exists, SQL is missing — the
        // shape we'd see if drizzle-kit was killed mid-write.
        await fs.mkdir(path.join(dir, "meta"), { recursive: true });
        await fs.writeFile(
          path.join(dir, "meta", "_journal.json"),
          JSON.stringify({ entries: [{ idx: 0, tag: "0000_test" }] }),
          "utf-8",
        );
        await fs.writeFile(
          path.join(dir, "meta", "0000_snapshot.json"),
          "{}",
          "utf-8",
        );
      } else {
        // Migration directory exists with snapshot but no migration.sql.
        const migrationDir = path.join(dir, "0000_test");
        await fs.mkdir(migrationDir, { recursive: true });
        await fs.writeFile(
          path.join(migrationDir, "snapshot.json"),
          "{}",
          "utf-8",
        );
      }

      await expect(
        assertGenerateArtifactsComplete(
          dir,
          { terminatedReason: "exit", stderr: "" },
          major,
        ),
      ).rejects.toBeInstanceOf(DyadError);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns the entry count when all artifacts are present", async () => {
    const dir = await makeTempDrizzleDir();
    try {
      if (major === 0) {
        await writeV0Migration(dir, [
          {
            idx: 0,
            tag: "0000_test",
            sql: 'CREATE TABLE "x" ("id" serial);\n',
          },
        ]);
      } else {
        await writeV1Migration(dir, [
          { tag: "0000_test", sql: 'CREATE TABLE "x" ("id" serial);\n' },
        ]);
      }

      const count = await assertGenerateArtifactsComplete(
        dir,
        { terminatedReason: "exit", stderr: "" },
        major,
      );
      expect(count).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe.each<{ major: DrizzleKitMajor; label: string }>([
  { major: 0, label: "v0 layout" },
  { major: 1, label: "v1 layout" },
])("readPendingMigrationFiles ($label)", ({ major }) => {
  async function makeTempWorkDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "dyad-migration-utils-test-"));
  }

  it("returns an empty array when drizzle/ does not exist", async () => {
    const workDir = await makeTempWorkDir();
    try {
      const out = await readPendingMigrationFiles(workDir, major);
      expect(out).toEqual([]);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  it("reads entries in idx order and flags the baseline by content equality", async () => {
    const workDir = await makeTempWorkDir();
    try {
      const drizzleDir = path.join(workDir, "drizzle");
      const diffSql =
        'CREATE TABLE "users" ("id" serial);\n--> statement-breakpoint\nALTER TABLE "users" ADD COLUMN "name" text;\n';

      if (major === 0) {
        await writeV0Migration(drizzleDir, [
          { idx: 0, tag: "0000_baseline", sql: BASELINE_SQL_BODY },
          { idx: 1, tag: "0001_test_diff", sql: diffSql },
        ]);
      } else {
        await writeV1Migration(drizzleDir, [
          { tag: "0000_baseline", sql: BASELINE_SQL_BODY },
          { tag: "0001_test_diff", sql: diffSql },
        ]);
      }

      const out = await readPendingMigrationFiles(workDir, major);
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ name: "0000_baseline", isBaseline: true });
      expect(out[1]).toMatchObject({
        name: "0001_test_diff",
        isBaseline: false,
      });
      expect(out[1].sql).toContain("ALTER TABLE");
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });
});

describe("readPendingMigrationFiles (v1 layout) ignores non-migration entries", () => {
  it("skips stray files and dirs not matching NNNN_<slug>", async () => {
    const workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-"),
    );
    try {
      const drizzleDir = path.join(workDir, "drizzle");
      await writeV1Migration(drizzleDir, [
        { tag: "0000_real", sql: BASELINE_SQL_BODY },
      ]);
      // Stray top-level file + stray dir without a leading numeric prefix —
      // must be ignored.
      await fs.writeFile(
        path.join(drizzleDir, "README.md"),
        "ignore me",
        "utf-8",
      );
      await fs.mkdir(path.join(drizzleDir, "scratch"), { recursive: true });

      const out = await readPendingMigrationFiles(workDir, 1);
      expect(out).toHaveLength(1);
      expect(out[0].name).toBe("0000_real");
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  it("reads v1 timestamp-prefixed names produced by real drizzle-kit", async () => {
    // Regression: drizzle-kit@1.0.0-rc.3 names migration directories with a
    // 14-digit timestamp (`YYYYMMDDhhmmss_<slug>`), not the 4-digit padded
    // index the mock emits. A `/^\d{4}_/` regex matches the mock but fails
    // on real output, dropping every migration and surfacing as "0
    // statements" despite a non-empty diff. Order is timestamp-ascending.
    const workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-"),
    );
    try {
      const drizzleDir = path.join(workDir, "drizzle");
      await writeV1Migration(drizzleDir, [
        {
          tag: "20260524001317_chemical_madripoor",
          sql: BASELINE_SQL_BODY,
        },
        {
          tag: "20260524001318_clear_thanos",
          sql: 'CREATE TABLE "users" ("id" serial);\n',
        },
      ]);

      const out = await readPendingMigrationFiles(workDir, 1);
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({
        name: "20260524001317_chemical_madripoor",
        isBaseline: true,
      });
      expect(out[1]).toMatchObject({
        name: "20260524001318_clear_thanos",
        isBaseline: false,
      });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  it("assertGenerateArtifactsComplete counts v1 timestamp-prefixed directories", async () => {
    const drizzleDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-"),
    );
    try {
      await writeV1Migration(drizzleDir, [
        {
          tag: "20260524001318_clear_thanos",
          sql: 'CREATE TABLE "x" ("id" serial);\n',
        },
      ]);
      const count = await assertGenerateArtifactsComplete(
        drizzleDir,
        { terminatedReason: "exit", stderr: "" },
        1,
      );
      expect(count).toBe(1);
    } finally {
      await fs.rm(drizzleDir, { recursive: true, force: true });
    }
  });
});

describe("getInstalledDrizzleKitMajor", () => {
  async function makeAppPath(version: unknown): Promise<string> {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-app-"),
    );
    const pkgDir = path.join(appPath, "node_modules", "drizzle-kit");
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "drizzle-kit", version }),
      "utf-8",
    );
    return appPath;
  }

  // `getInstalledDrizzleKitMajor` short-circuits to 1 under E2E_TEST_BUILD
  // (so the mock drizzle-kit and the layout dispatcher agree). The unit
  // suite runs without that env var, so we read the real file from disk.
  it("returns 0 for pre-v1 stable like 0.31.10", async () => {
    const appPath = await makeAppPath("0.31.10");
    try {
      expect(await getInstalledDrizzleKitMajor(appPath)).toBe(0);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("returns 1 for v1 RC pre-releases like 1.0.0-rc.3", async () => {
    const appPath = await makeAppPath("1.0.0-rc.3");
    try {
      expect(await getInstalledDrizzleKitMajor(appPath)).toBe(1);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("returns 1 for stable 1.0.0", async () => {
    const appPath = await makeAppPath("1.0.0");
    try {
      expect(await getInstalledDrizzleKitMajor(appPath)).toBe(1);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("throws DyadError when the version field cannot be parsed", async () => {
    const appPath = await makeAppPath(42);
    try {
      await expect(getInstalledDrizzleKitMajor(appPath)).rejects.toBeInstanceOf(
        DyadError,
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("throws DyadError when drizzle-kit is not installed", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-app-"),
    );
    try {
      await expect(getInstalledDrizzleKitMajor(appPath)).rejects.toBeInstanceOf(
        DyadError,
      );
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });
});

describe("areMigrationDepsInstalled", () => {
  async function makeAppWithDeps(
    kit: { version: string } | null,
    orm: { version: string } | null,
  ): Promise<string> {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-app-"),
    );
    if (kit) {
      const dir = path.join(appPath, "node_modules", "drizzle-kit");
      await fs.mkdir(dir, { recursive: true });
      // areMigrationDepsInstalled checks bin.cjs presence via getDrizzleKitPath.
      await fs.writeFile(path.join(dir, "bin.cjs"), "// mock\n", "utf-8");
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "drizzle-kit", version: kit.version }),
        "utf-8",
      );
    }
    if (orm) {
      const dir = path.join(appPath, "node_modules", "drizzle-orm");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "drizzle-orm", version: orm.version }),
        "utf-8",
      );
    }
    return appPath;
  }

  it("returns true when both packages share a major (v1 / v1)", async () => {
    const appPath = await makeAppWithDeps(
      { version: "1.0.0-rc.3" },
      { version: "1.0.0-rc.3" },
    );
    try {
      expect(await areMigrationDepsInstalled(appPath)).toBe(true);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("returns true when both packages share a major (v0 / v0)", async () => {
    const appPath = await makeAppWithDeps(
      { version: "0.31.10" },
      { version: "0.45.2" },
    );
    try {
      expect(await areMigrationDepsInstalled(appPath)).toBe(true);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("returns false when drizzle-kit is v1 but drizzle-orm is still v0", async () => {
    // Real-world repro: a previous unpinned install left drizzle-orm@0.45.2
    // on disk. A later install of drizzle-kit@1.0.0-rc.3 (alone, or via a
    // partial reinstall) left the workspace mismatched. drizzle-kit v1
    // imports `drizzle-orm/_relations`, which v0 drizzle-orm does not
    // export, so we want to detect this and force a reinstall.
    const appPath = await makeAppWithDeps(
      { version: "1.0.0-rc.3" },
      { version: "0.45.2" },
    );
    try {
      expect(await areMigrationDepsInstalled(appPath)).toBe(false);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("returns false when only one of the two packages is present", async () => {
    const appPath = await makeAppWithDeps({ version: "1.0.0-rc.3" }, null);
    try {
      expect(await areMigrationDepsInstalled(appPath)).toBe(false);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("returns false when neither package is present", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-app-"),
    );
    try {
      expect(await areMigrationDepsInstalled(appPath)).toBe(false);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });
});

describe("deriveDestructiveReasons", () => {
  it("returns a unique reason code per destructive statement", () => {
    const reasons = deriveDestructiveReasons([
      { index: 0, reason: "drop_table" },
      { index: 1, reason: "drop_column" },
      { index: 2, reason: "drop_column" }, // duplicate reason
      { index: 3, reason: "alter_column_type" },
    ]);

    expect(reasons).toEqual(["drop_table", "drop_column", "alter_column_type"]);
  });

  it("returns empty when there are no destructive statements", () => {
    expect(deriveDestructiveReasons([])).toEqual([]);
  });
});
