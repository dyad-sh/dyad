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
  spawnDrizzleKit,
  areMigrationDepsInstalled,
  runDrizzleKitPushPreview,
  detectDestructiveStatements,
} from "../utils/migration_utils";

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
  // Runs `drizzle-kit push --verbose --strict` and kills the process before
  // any statement is applied (the hanji prompt blocks without a TTY). Returns
  // the SQL drizzle-kit would run, plus destructive-change metadata.
  // -------------------------------------------------------------------------
  createTypedHandler(migrationContracts.preview, async (_, params) => {
    const { appId } = params;
    logger.info(`Computing migration preview for app ${appId}`);

    const ctx = await prepareMigrationContext({ appId });
    try {
      const result = await runDrizzleKitPushPreview({
        appPath: ctx.appPath,
        cwd: ctx.tmpDir,
        prodConnectionUri: ctx.prodUri,
        pushConfigPath: ctx.pushConfigPath,
      });

      const destructiveStatements = detectDestructiveStatements(
        result.statements,
      );

      logger.info(
        `Migration preview for app ${appId}: ${result.statements.length} statements, ${destructiveStatements.length} destructive, hasDataLoss=${result.hasDataLoss}`,
      );

      return {
        statements: result.statements,
        hasDataLoss: result.hasDataLoss,
        warnings: result.warnings,
        destructiveStatements,
      };
    } finally {
      await ctx.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // migration:push
  // -------------------------------------------------------------------------
  createTypedHandler(migrationContracts.push, async (_, params) => {
    const { appId } = params;
    logger.info(`Pushing migration for app ${appId}`);

    const ctx = await prepareMigrationContext({ appId });
    try {
      const pushResult = await spawnDrizzleKit({
        args: ["push", "--force", `--config=${ctx.pushConfigPath}`],
        cwd: ctx.tmpDir,
        appPath: ctx.appPath,
        connectionUri: ctx.prodUri,
      });

      if (pushResult.exitCode !== 0) {
        throw new DyadError(
          `Migration push failed: ${pushResult.stderr || pushResult.stdout}`,
          DyadErrorKind.External,
        );
      }

      const noChanges = /no\s+changes\s+detected/i.test(pushResult.stdout);
      logger.info(
        noChanges
          ? `Schemas already in sync for app ${appId}, nothing to migrate.`
          : `Migration push completed successfully for app ${appId}`,
      );
      return { success: true, noChanges };
    } finally {
      await ctx.cleanup();
    }
  });
}
