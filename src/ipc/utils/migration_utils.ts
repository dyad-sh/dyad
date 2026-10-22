import log from "electron-log";
import {
  getConnectionUri,
  executeNeonSql,
} from "../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { getAppWithNeonBranch, getProductionBranchId } from "./neon_utils";
import type {
  DestructiveStatement,
  DestructiveStatementReason,
} from "../types/migration";
import {
  generateSchemaDiff,
  NotImplementedMigrationError,
  PgSchemaDiffError,
  UnsupportedPostgresVersionError,
  type DatabaseConnectionOptions,
  type SchemaDiffStatement,
} from "ts-pg-schema-diff";

export const logger = log.scope("migration_handlers");

export const MIGRATION_SCHEMA_DIFF_INCLUDE_SCHEMAS = ["public"] as const;
export const MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS = {
  ssl: true,
  maxConnections: 1,
  connectionTimeoutMs: 30_000,
  queryTimeoutMs: 120_000,
  statementTimeoutMs: 120_000,
  lockTimeoutMs: 30_000,
} as const satisfies DatabaseConnectionOptions;

// =============================================================================
// Branch resolution
// =============================================================================

/**
 * Finds the production (default) branch for a Neon project. `updatedAt` is
 * the branch's `updated_at` timestamp from Neon, captured at preview time
 * and re-checked at apply time to reject stale plans.
 */
// =============================================================================
// Destructive statement detection
// =============================================================================

const DESTRUCTIVE_PATTERNS: Array<{
  regex: RegExp;
  reason: DestructiveStatementReason;
}> = [
  { regex: /\bDROP\s+TABLE\b/i, reason: "drop_table" },
  { regex: /\bDROP\s+SCHEMA\b/i, reason: "drop_schema" },
  { regex: /\bTRUNCATE\b/i, reason: "truncate" },
  {
    regex: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+COLUMN\b/i,
    reason: "drop_column",
  },
  {
    regex:
      /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\b(SET\s+DATA\s+)?TYPE\b/i,
    reason: "alter_column_type",
  },
];

export function detectDestructiveStatements(
  statements: readonly SchemaDiffStatement[],
): DestructiveStatement[] {
  const out: DestructiveStatement[] = [];
  statements.forEach((statement, index) => {
    const regexReason = destructiveReasonForSql(statement.sql);
    if (regexReason !== null) {
      out.push({ index, reason: regexReason });
      return;
    }
    if (
      statement.type === "destructive" &&
      !isRoutineIndexCreation(statement.sql)
    ) {
      out.push({ index, reason: "schema_hazard" });
    }
  });
  return out;
}

function destructiveReasonForSql(
  sql: string,
): DestructiveStatementReason | null {
  for (const { regex, reason } of DESTRUCTIVE_PATTERNS) {
    if (regex.test(sql)) {
      return reason;
    }
  }
  return null;
}

function isRoutineIndexCreation(sql: string): boolean {
  return /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?/iu.test(sql);
}

/**
 * De-dupes destructive statements by reason. Reason codes are translated on
 * the frontend so warnings respect the user's locale rather than being
 * hardcoded English on the server.
 */
export function deriveDestructiveReasons(
  destructive: DestructiveStatement[],
): DestructiveStatementReason[] {
  const seen = new Set<DestructiveStatementReason>();
  const out: DestructiveStatementReason[] = [];
  for (const d of destructive) {
    if (seen.has(d.reason)) continue;
    seen.add(d.reason);
    out.push(d.reason);
  }
  return out;
}

// =============================================================================
// ts-pg-schema-diff generation
// =============================================================================

export async function generateNeonMigrationStatements({
  currentDatabaseUrl,
  desiredDatabaseUrl,
}: {
  currentDatabaseUrl: string;
  desiredDatabaseUrl: string;
}): Promise<readonly SchemaDiffStatement[]> {
  if (IS_TEST_BUILD) {
    return [
      { sql: 'CREATE TABLE "mock" ("id" serial)', type: "additive" },
      { sql: 'ALTER TABLE "mock" ADD COLUMN "name" text', type: "additive" },
      { sql: 'DROP TABLE "mock_legacy"', type: "destructive" },
      {
        sql: 'GRANT SELECT ON TABLE "mock" TO "app_user"',
        type: "destructive",
      },
    ];
  }

  let statements: readonly SchemaDiffStatement[];
  try {
    const diff = await generateSchemaDiff({
      currentDatabaseUrl,
      desiredDatabaseUrl,
      includeSchemas: MIGRATION_SCHEMA_DIFF_INCLUDE_SCHEMAS,
      noConcurrentIndexOperations: true,
      connection: MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS,
    });
    statements = diff.statements;
  } catch (error) {
    throw toMigrationDiffDyadError(error);
  }
  assertNoSamePlanEnumValueUse(statements);
  return statements;
}

// =============================================================================
// New enum value usage detection
// =============================================================================

const ADD_ENUM_VALUE_REGEX =
  /^\s*ALTER\s+TYPE\s+((?:(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)\.)?("(?:[^"]|"")+"|[A-Za-z_][\w$]*))\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?('(?:[^']|'')*')/iu;

const IDENTIFIER_PATTERN = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;

/**
 * PostgreSQL rejects using an enum label added by `ALTER TYPE ... ADD VALUE`
 * until the adding transaction commits. Migrations are applied in a single
 * Neon transaction, so a plan that adds a label and then uses it (e.g. in a
 * column default or check constraint) would always fail on apply. Reject it
 * up front with an actionable message instead.
 */
export function assertNoSamePlanEnumValueUse(
  statements: readonly SchemaDiffStatement[],
): void {
  statements.forEach((statement, index) => {
    const match = ADD_ENUM_VALUE_REGEX.exec(statement.sql);
    if (!match) {
      return;
    }
    const [, typeName, typeIdentifier, labelLiteral] = match;
    const usageRegex = enumValueUsageRegex(typeIdentifier, labelLiteral);
    const usedLater = statements
      .slice(index + 1)
      .some((later) => usageRegex.test(later.sql));
    if (usedLater) {
      throw new DyadError(
        `This migration adds the value ${labelLiteral} to enum ${typeName} and uses it in the same migration, which PostgreSQL does not allow in a single transaction. Apply the enum value change to production first (without the changes that use it), then regenerate the migration preview.`,
        DyadErrorKind.Precondition,
      );
    }
  });
}

function enumValueUsageRegex(
  typeIdentifier: string,
  labelLiteral: string,
): RegExp {
  const unquotedName = typeIdentifier.startsWith('"')
    ? typeIdentifier.slice(1, -1).replaceAll('""', '"')
    : typeIdentifier.toLowerCase();
  const nameAlternatives = [
    escapeRegExp(`"${unquotedName.replaceAll('"', '""')}"`),
  ];
  if (/^[a-z_][a-z0-9_$]*$/u.test(unquotedName)) {
    nameAlternatives.push(`${escapeRegExp(unquotedName)}(?![\\w$])`);
  }
  // Matches the label literal cast to the enum type, optionally
  // schema-qualified, e.g. `'ok'::mood` or `'ok'::"public"."mood"`.
  return new RegExp(
    `${escapeRegExp(labelLiteral)}::(?:${IDENTIFIER_PATTERN}\\.)?(?:${nameAlternatives.join("|")})`,
    "u",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function toMigrationDiffDyadError(error: unknown): DyadError {
  const unsupportedChange = findErrorInCauseChain(
    error,
    (candidate) =>
      candidate instanceof NotImplementedMigrationError ||
      candidate.name === "NotImplementedMigrationError",
  );
  if (unsupportedChange) {
    return new DyadError(
      `Unsupported schema change: ${unsupportedChange.message}`,
      DyadErrorKind.Precondition,
    );
  }

  const unsupportedVersion = findErrorInCauseChain(
    error,
    (candidate) =>
      candidate instanceof UnsupportedPostgresVersionError ||
      candidate.name === "UnsupportedPostgresVersionError",
  );
  if (unsupportedVersion) {
    return new DyadError(
      unsupportedVersion.message,
      DyadErrorKind.Precondition,
    );
  }

  const message =
    error instanceof PgSchemaDiffError || error instanceof Error
      ? error.message
      : String(error);
  logger.error(
    "Failed to compute migration plan. Cause chain:",
    formatErrorCauseChain(error),
  );
  const causeSummary = formatErrorCauseSummary(error);
  return new DyadError(
    causeSummary
      ? `Failed to compute migration plan: ${message}: ${causeSummary}`
      : `Failed to compute migration plan: ${message}`,
    DyadErrorKind.External,
  );
}

function formatErrorCauseSummary(error: unknown): string | null {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  let current =
    error instanceof Error
      ? (error as Error & { cause?: unknown }).cause
      : undefined;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(`${current.name}: ${current.message}`);
    current = (current as Error & { cause?: unknown }).cause;
  }

  if (current !== undefined && !seen.has(current)) {
    messages.push(String(current));
  }

  return messages.length === 0 ? null : messages.join(": ");
}

function formatErrorCauseChain(error: unknown): string {
  const seen = new Set<unknown>();
  const lines: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    lines.push(formatErrorForLog(current));
    current = (current as Error & { cause?: unknown }).cause;
  }

  if (current !== undefined && !seen.has(current)) {
    lines.push(String(current));
  }

  return lines
    .map((line, index) => (index === 0 ? line : `caused by: ${line}`))
    .join("\n");
}

function formatErrorForLog(error: Error): string {
  const details = [
    error.name,
    error.message,
    error.stack ? `stack: ${error.stack}` : null,
  ].filter(Boolean);
  return details.join(": ");
}

function findErrorInCauseChain(
  error: unknown,
  predicate: (candidate: Error) => boolean,
): Error | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    if (predicate(current)) {
      return current;
    }
    seen.add(current);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return null;
}

// =============================================================================
// Migration context (shared setup for preview)
// =============================================================================

export interface MigrationContext {
  projectId: string;
  devBranchId: string;
  prodBranchId: string;
  prodUpdatedAt: string;
  devUri: string;
  prodUri: string;
}

export async function prepareMigrationContext({
  appId,
}: {
  appId: number;
}): Promise<MigrationContext> {
  const { appData, branchId: devBranchId } = await getAppWithNeonBranch(appId);
  const projectId = appData.neonProjectId!;
  const { branchId: prodBranchId, updatedAt: prodUpdatedAt } =
    await getProductionBranchId(projectId);

  logger.info(
    `Resolved branches - dev: ${devBranchId}, prod: ${prodBranchId}, project: ${projectId}`,
  );

  if (devBranchId === prodBranchId) {
    throw new DyadError(
      "Active branch is the production branch. Create a development branch first.",
      DyadErrorKind.Precondition,
    );
  }

  const devUri = await getConnectionUri({
    projectId,
    branchId: devBranchId,
    pooled: false,
  });
  const prodUri = await getConnectionUri({
    projectId,
    branchId: prodBranchId,
    pooled: false,
  });

  logger.info(
    `Connection URIs - dev host: ${new URL(devUri).hostname}, prod host: ${new URL(prodUri).hostname}`,
  );

  let tableCount: number;
  if (IS_TEST_BUILD) {
    tableCount = 1;
  } else {
    let parsed;
    try {
      parsed = JSON.parse(
        await executeNeonSql({
          projectId,
          branchId: devBranchId,
          query:
            "SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema = 'public'",
        }),
      );
    } catch {
      throw new DyadError(
        "Unable to verify development table count",
        DyadErrorKind.Precondition,
      );
    }
    tableCount = parseInt(parsed?.[0]?.cnt ?? "0", 10);
  }
  if (!tableCount || tableCount === 0) {
    throw new DyadError(
      "Development database has no tables. Create at least one table before migrating.",
      DyadErrorKind.Precondition,
    );
  }

  return {
    projectId,
    devBranchId,
    prodBranchId,
    prodUpdatedAt,
    devUri,
    prodUri,
  };
}
