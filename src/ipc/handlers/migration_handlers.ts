import { createTypedHandler } from "./base";
import { migrationContracts } from "../types/migration";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  logger,
  prepareMigrationContext,
  generateNeonMigrationStatements,
  detectDestructiveStatements,
  deriveDestructiveReasons,
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
  createTypedHandler(migrationContracts.dependenciesStatus, async () => ({
    installed: true,
  }));

  // -------------------------------------------------------------------------
  // migration:preview
  //
  // 1. Resolve dev/prod branches and connection URLs.
  // 2. Diff prod (current) against dev (desired) via ts-pg-schema-diff.
  // 3. Stash the SQL statements in the in-memory plan store keyed by a fresh
  //    migrationId; apply will execute statements directly via Neon's HTTP
  //    transaction.
  // -------------------------------------------------------------------------
  createTypedHandler(migrationContracts.preview, async (_, params) => {
    const { appId } = params;
    logger.info(`Computing migration preview for app ${appId}`);

    const ctx = await prepareMigrationContext({ appId });
    const statements = await generateNeonMigrationStatements({
      currentDatabaseUrl: ctx.prodUri,
      desiredDatabaseUrl: ctx.devUri,
    });

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
  });
}
