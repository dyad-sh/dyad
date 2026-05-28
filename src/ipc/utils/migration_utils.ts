import log from "electron-log";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import {
  getConnectionUri,
  executeNeonSql,
} from "../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { getAppWithNeonBranch } from "./neon_utils";
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
export async function getProductionBranchId(
  projectId: string,
): Promise<{ branchId: string; updatedAt: string }> {
  const neonClient = await getNeonClient();
  const response = await neonClient.listProjectBranches({ projectId });

  if (!response.data.branches) {
    throw new DyadError(
      "Failed to list branches: No branch data returned.",
      DyadErrorKind.External,
    );
  }

  const prodBranch = response.data.branches.find((b) => b.default);
  if (!prodBranch) {
    throw new DyadError(
      "No production (default) branch found for this Neon project.",
      DyadErrorKind.Precondition,
    );
  }

  return { branchId: prodBranch.id, updatedAt: prodBranch.updated_at };
}

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

  try {
    const diff = await generateSchemaDiff({
      currentDatabaseUrl,
      desiredDatabaseUrl,
      includeSchemas: MIGRATION_SCHEMA_DIFF_INCLUDE_SCHEMAS,
      noConcurrentIndexOperations: true,
      connection: MIGRATION_SCHEMA_DIFF_CONNECTION_OPTIONS,
    });
    return diff.statements;
  } catch (error) {
    throw toMigrationDiffDyadError(error);
  }
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
  return new DyadError(
    `Failed to compute migration plan: ${message}`,
    DyadErrorKind.External,
  );
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
  });
  const prodUri = await getConnectionUri({
    projectId,
    branchId: prodBranchId,
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
