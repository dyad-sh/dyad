import { eq } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { migrationContracts } from "../types/migration";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import {
  logger,
  prepareMigrationContext,
  areMigrationDepsInstalled,
  introspectProdWithCache,
  introspectBranch,
  runBaselineGenerate,
  runDiffGenerate,
  readPendingMigrationFiles,
  parseDrizzleMigrationFile,
  detectDestructiveStatements,
  deriveDestructiveReasons,
  invalidateProdIntrospectCache,
  cleanupWorkDir,
  getProductionBranchId,
} from "../utils/migration_utils";
import { getAppWithNeonBranch } from "../utils/neon_utils";
import { executeNeonStatementsInTransaction } from "../../neon_admin/neon_context";
import {
  storePreview,
  peekPreview,
  deletePreview,
} from "../utils/migration_plan_store";

// =============================================================================
// Handler Registration
// =============================================================================

export function registerMigrationHandlers() {
  // -------------------------------------------------------------------------
  // migration:dependencies-status
  // -------------------------------------------------------------------------
  createTypedHandler(
    migrationContracts.dependenciesStatus,
    async (_, params) => {
      const { appId } = params;
      if (IS_TEST_BUILD) {
        return { installed: true };
      }
      const rows = await db
        .select()
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);
      if (rows.length === 0) {
        throw new DyadError(
          `App with ID ${appId} not found`,
          DyadErrorKind.NotFound,
        );
      }
      const appPath = getDyadAppPath(rows[0].path);
      return { installed: await areMigrationDepsInstalled(appPath) };
    },
  );

  // -------------------------------------------------------------------------
  // migration:preview
  //
  // 1. Resolve dev/prod branches, ensure deps, wipe+recreate work dir.
  // 2. Introspect prod (cached, 5 min TTL) → write a baseline snapshot.
  // 3. Introspect dev (always fresh) → run diff generate.
  // 4. Read pending migration files; the baseline file is hidden from the UI.
  // 5. Stash the SQL statements in the in-memory plan store keyed by a fresh
  //    migrationId; the work dir is then discarded — apply will execute
  //    statements directly via Neon's HTTP transaction.
  // -------------------------------------------------------------------------
  createTypedHandler(migrationContracts.preview, async (_, params) => {
    const { appId } = params;
    logger.info(`Computing migration preview for app ${appId}`);

    const ctx = await prepareMigrationContext({ appId });
    try {
      const prodSchemaPath = await introspectProdWithCache({
        appId,
        prodBranchId: ctx.prodBranchId,
        prodUpdatedAt: ctx.prodUpdatedAt,
        appPath: ctx.appPath,
        workDir: ctx.workDir,
        prodConnectionUri: ctx.prodUri,
      });

      await runBaselineGenerate({
        workDir: ctx.workDir,
        appPath: ctx.appPath,
        prodSchemaPath,
        prodConnectionUri: ctx.prodUri,
      });

      const devSchemaPath = await introspectBranch({
        appPath: ctx.appPath,
        workDir: ctx.workDir,
        subDir: "dev-schema-out",
        connectionUri: ctx.devUri,
      });

      await runDiffGenerate({
        workDir: ctx.workDir,
        appPath: ctx.appPath,
        devSchemaPath,
        devConnectionUri: ctx.devUri,
      });

      const pending = await readPendingMigrationFiles(ctx.workDir);
      const userVisible = pending.filter((p) => !p.isBaseline);

      const statements: string[] = [];
      for (const entry of userVisible) {
        statements.push(...parseDrizzleMigrationFile(entry.sql));
      }

      const destructiveStatements = detectDestructiveStatements(statements);
      const warningReasons = deriveDestructiveReasons(destructiveStatements);
      const hasDataLoss = destructiveStatements.length > 0;

      const migrationId = storePreview(appId, statements, {
        projectId: ctx.projectId,
        prodBranchId: ctx.prodBranchId,
        prodUpdatedAt: ctx.prodUpdatedAt,
      });

      logger.info(
        `Migration preview ${migrationId} for app ${appId}: ${statements.length} statements, ${destructiveStatements.length} destructive`,
      );

      return {
        migrationId,
        statements,
        hasDataLoss,
        warningReasons,
        destructiveStatements,
      };
    } finally {
      await cleanupWorkDir(ctx.workDir);
    }
  });

  // -------------------------------------------------------------------------
  // migration:migrate
  //
  // Looks up the previously-previewed plan by migrationId and executes its
  // statements directly against prod inside a single Neon HTTP transaction.
  // -------------------------------------------------------------------------
  createTypedHandler(migrationContracts.migrate, async (_, params) => {
    const { appId, migrationId } = params;
    logger.info(`Applying migration ${migrationId} for app ${appId}`);

    // Peek first so a failed apply (e.g., transient network error during the
    // Neon HTTP transaction) leaves the plan in the store; the user can retry
    // without redoing the preview workflow. We only delete after the
    // transaction commits successfully (or after we determine the plan is a
    // no-op / does not belong to this app).
    const stored = peekPreview(migrationId);
    if (!stored) {
      throw new DyadError(
        "Migration plan expired or already applied. Please start a new migration preview.",
        DyadErrorKind.Precondition,
      );
    }
    if (stored.appId !== appId) {
      throw new DyadError(
        "Migration plan does not belong to this app.",
        DyadErrorKind.Precondition,
      );
    }

    if (stored.statements.length === 0) {
      logger.info(
        `Schemas already in sync for app ${appId}, nothing to migrate.`,
      );
      deletePreview(migrationId);
      return { success: true, noChanges: true };
    }

    const { appData } = await getAppWithNeonBranch(appId);
    const projectId = appData.neonProjectId!;
    const { branchId: prodBranchId, updatedAt: prodUpdatedAt } =
      await getProductionBranchId(projectId);

    // Reject the apply if the production target drifted between preview and
    // confirm: a different Neon project, a different default branch, or a
    // newer `updated_at` on that branch all mean the SQL the user reviewed
    // may not match what would run now.
    const target = stored.target;
    const projectChanged = target.projectId !== projectId;
    const branchChanged = target.prodBranchId !== prodBranchId;
    const branchAdvanced = target.prodUpdatedAt !== prodUpdatedAt;
    if (projectChanged || branchChanged || branchAdvanced) {
      logger.warn(
        `Migration ${migrationId} for app ${appId} rejected: production target changed since preview (` +
          `project ${target.projectId}→${projectId}, branch ${target.prodBranchId}→${prodBranchId}, ` +
          `updatedAt ${target.prodUpdatedAt}→${prodUpdatedAt})`,
      );
      throw new DyadError(
        "The production database changed since this migration was previewed. Please regenerate the preview before applying.",
        DyadErrorKind.Precondition,
      );
    }

    try {
      await executeNeonStatementsInTransaction({
        projectId,
        branchId: prodBranchId,
        statements: stored.statements,
      });
      deletePreview(migrationId);
      logger.info(
        `Migration ${migrationId} applied successfully for app ${appId}`,
      );
      return { success: true };
    } finally {
      invalidateProdIntrospectCache({ appId, prodBranchId });
    }
  });
}
