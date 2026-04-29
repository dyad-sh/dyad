import { describe, expect, it } from "vitest";
import {
  detectDestructiveStatements,
  parseDrizzlePushVerboseOutput,
} from "./migration_utils";

// Sample inputs are anchored to drizzle-kit 0.30.x `push --verbose --strict`
// stdout. Re-validate when MIGRATION_DEPS bumps drizzle-kit.

const NORMAL_OUTPUT = `\
✓ Pulling schema from database...
ALTER TABLE "users" ADD COLUMN "email" text;
CREATE TABLE "posts" (
\t"id" serial PRIMARY KEY NOT NULL,
\t"title" text NOT NULL
);

[i] Are you sure you want to push these changes to the database? (y/N)
`;

const DESTRUCTIVE_OUTPUT = `\
✓ Pulling schema from database...
· You're about to delete column "legacy_id" in "users" table
· You're about to delete "old_things" table
ALTER TABLE "users" DROP COLUMN "legacy_id";
DROP TABLE "old_things";
ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE bigint;
[i] ❯ Yes, I want to apply destructive changes
`;

const NO_CHANGES_OUTPUT = `\
✓ Pulling schema from database...
[i] No changes detected.
`;

const ANSI_COLOURED_OUTPUT =
  // ANSI blue + reset around each line — drizzle-kit's actual coloring style.
  '\x1b[34mALTER TABLE "users" ADD COLUMN "email" text;\x1b[0m\n' +
  '\x1b[34mDROP TABLE "old";\x1b[0m\n' +
  "Are you sure you want to push these changes? (y/N)\n";

describe("parseDrizzlePushVerboseOutput", () => {
  it("parses single- and multi-line statements", () => {
    const { statements, warnings } =
      parseDrizzlePushVerboseOutput(NORMAL_OUTPUT);

    expect(warnings).toEqual([]);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('ALTER TABLE "users" ADD COLUMN "email" text;');
    expect(statements[1]).toContain('CREATE TABLE "posts"');
    expect(statements[1]).toContain('"title" text NOT NULL');
    expect(statements[1].endsWith(";")).toBe(true);
  });

  it("captures bullet warnings and destructive statements", () => {
    const { statements, warnings } =
      parseDrizzlePushVerboseOutput(DESTRUCTIVE_OUTPUT);

    expect(warnings).toEqual([
      `You're about to delete column "legacy_id" in "users" table`,
      `You're about to delete "old_things" table`,
    ]);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/DROP COLUMN/);
    expect(statements[1]).toMatch(/^DROP TABLE/);
    expect(statements[2]).toMatch(/SET DATA TYPE/);
  });

  it("returns empty when drizzle-kit reports no changes", () => {
    const { statements, warnings } =
      parseDrizzlePushVerboseOutput(NO_CHANGES_OUTPUT);

    expect(statements).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("strips ANSI codes and stops at the prompt marker", () => {
    const { statements } = parseDrizzlePushVerboseOutput(ANSI_COLOURED_OUTPUT);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('ALTER TABLE "users" ADD COLUMN "email" text;');
    expect(statements[1]).toBe('DROP TABLE "old";');
    // Prompt line must not leak into output.
    expect(statements.join("\n")).not.toMatch(/Are you sure/i);
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
