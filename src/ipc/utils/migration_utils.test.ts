import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import {
  assertGenerateArtifactsComplete,
  detectDestructiveStatements,
  detectDrizzleKitFailureInStderr,
  parseDrizzleMigrationFile,
  deriveDestructiveReasons,
} from "./migration_utils";
import { DyadError } from "@/errors/dyad_error";

// Sample inputs are anchored to the format drizzle-kit `generate` writes:
// SQL files separated by `--> statement-breakpoint` markers on their own
// lines. Re-validate when MIGRATION_DEPS bumps drizzle-kit.

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

describe("assertGenerateArtifactsComplete", () => {
  // Behavior contract:
  //   1. Empty journal AND clean spawn  → return 0 (genuine no-op generate).
  //   2. Empty journal AND idle settle with stderr → throw (suspicious:
  //      drizzle-kit normally writes the journal before going quiet).
  //   3. Journal entry missing its SQL/snapshot → throw regardless of how
  //      we settled (caller would otherwise read a partial plan as success).

  async function makeTempDrizzleDir(): Promise<string> {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-migration-utils-test-"),
    );
    await fs.mkdir(path.join(dir, "meta"), { recursive: true });
    return dir;
  }

  it("returns 0 when there is no journal and the spawn settled cleanly", async () => {
    const dir = await makeTempDrizzleDir();
    try {
      const count = await assertGenerateArtifactsComplete(dir, {
        terminatedReason: "exit",
        stderr: "",
      });
      expect(count).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when the spawn went idle with stderr but no journal was written", async () => {
    // Real-world shape: an esbuild Transform error on the introspected
    // schema crashes drizzle-kit before it can write the journal, but the
    // esbuild service subprocess holds the parent open so the spawn
    // settles via idle (`exitCode: null`). Returning 0 here would let the
    // caller proudly report "already in sync" — exactly the user-visible
    // bug we're fixing.
    const dir = await makeTempDrizzleDir();
    try {
      await expect(
        assertGenerateArtifactsComplete(dir, {
          terminatedReason: "idle",
          stderr: "Error: Transform failed with 1 error:\n  schema.ts:18:35\n",
        }),
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
      const count = await assertGenerateArtifactsComplete(dir, {
        terminatedReason: "idle",
        stderr: "",
      });
      expect(count).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when a journal entry references a missing SQL file", async () => {
    const dir = await makeTempDrizzleDir();
    try {
      await fs.writeFile(
        path.join(dir, "meta", "_journal.json"),
        JSON.stringify({ entries: [{ idx: 0, tag: "0000_test" }] }),
        "utf-8",
      );
      // Snapshot exists but the referenced SQL file does not — this is the
      // shape we'd see if drizzle-kit was killed mid-write.
      await fs.writeFile(
        path.join(dir, "meta", "0000_snapshot.json"),
        "{}",
        "utf-8",
      );

      await expect(
        assertGenerateArtifactsComplete(dir, {
          terminatedReason: "exit",
          stderr: "",
        }),
      ).rejects.toBeInstanceOf(DyadError);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns the entry count when journal, SQL, and snapshot are all present", async () => {
    const dir = await makeTempDrizzleDir();
    try {
      await fs.writeFile(
        path.join(dir, "meta", "_journal.json"),
        JSON.stringify({ entries: [{ idx: 0, tag: "0000_test" }] }),
        "utf-8",
      );
      await fs.writeFile(
        path.join(dir, "0000_test.sql"),
        'CREATE TABLE "x" ("id" serial);\n',
        "utf-8",
      );
      await fs.writeFile(
        path.join(dir, "meta", "0000_snapshot.json"),
        "{}",
        "utf-8",
      );

      const count = await assertGenerateArtifactsComplete(dir, {
        terminatedReason: "exit",
        stderr: "",
      });
      expect(count).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
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
