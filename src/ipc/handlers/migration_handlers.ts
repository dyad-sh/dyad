import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createTypedHandler } from "./base";
import { migrationContracts } from "../types/migration";
import {
  getConnectionUri,
  executeNeonSql,
} from "../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAppWithNeonBranch } from "../utils/neon_utils";
import { IS_TEST_BUILD } from "../utils/test_utils";
import {
  logger,
  getProductionBranchId,
  createTempDrizzleConfig,
  spawnDrizzleKit,
} from "../utils/migration_utils";

// =============================================================================
// Handler Registration
// =============================================================================

export function registerMigrationHandlers() {
  // -------------------------------------------------------------------------
  // migration:push
  // -------------------------------------------------------------------------
  createTypedHandler(migrationContracts.push, async (_, params) => {
    const { appId } = params;
    logger.info(`Pushing migration for app ${appId}`);

    // 1. Get app data and resolve branches
    const { appData, branchId: devBranchId } =
      await getAppWithNeonBranch(appId);
    const projectId = appData.neonProjectId!;
    const { branchId: prodBranchId } = await getProductionBranchId(projectId);

    logger.info(
      `Resolved branches — dev: ${devBranchId}, prod: ${prodBranchId}, project: ${projectId}`,
    );

    // 2. Guard: dev and prod must be different branches
    if (devBranchId === prodBranchId) {
      throw new DyadError(
        "Active branch is the production branch. Create a development branch first.",
        DyadErrorKind.Precondition,
      );
    }

    // 3. Get connection URIs for both branches
    const devUri = await getConnectionUri({
      projectId,
      branchId: devBranchId,
    });
    const prodUri = await getConnectionUri({
      projectId,
      branchId: prodBranchId,
    });

    logger.info(
      `Connection URIs — dev host: ${new URL(devUri).hostname}, prod host: ${new URL(prodUri).hostname}`,
    );

    // 4. Validate dev schema has at least one table
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

    // 5. Create temp directory with restricted permissions
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-migration-"));

    try {
      if (process.platform !== "win32") {
        await fs.chmod(tmpDir, 0o700);
      }

      // 6. Write introspect config pointing at dev branch
      const introspectConfigPath = await createTempDrizzleConfig({
        tmpDir,
        configName: "drizzle-introspect.config.js",
      });

      // 7. Run drizzle-kit introspect to generate schema files
      const introspectResult = await spawnDrizzleKit({
        args: ["introspect", `--config=${introspectConfigPath}`],
        cwd: tmpDir,
        connectionUri: devUri,
      });

      if (introspectResult.exitCode !== 0) {
        throw new DyadError(
          `Schema introspection failed: ${introspectResult.stderr || introspectResult.stdout}`,
          DyadErrorKind.External,
        );
      }

      // 8. Find the generated schema file
      const schemaOutDir = path.join(tmpDir, "schema-out");
      let schemaFiles: string[];
      try {
        schemaFiles = await fs.readdir(schemaOutDir);
      } catch {
        throw new DyadError(
          "drizzle-kit introspect did not generate output. Your development database may have an unsupported schema.",
          DyadErrorKind.Internal,
        );
      }

      const tsSchemaFile =
        schemaFiles.find((f) => f === "schema.ts") ??
        schemaFiles.find((f) => f.endsWith(".ts") && f !== "relations.ts");
      if (!tsSchemaFile) {
        throw new DyadError(
          "drizzle-kit introspect did not generate any schema files.",
          DyadErrorKind.Internal,
        );
      }

      logger.info(`Using introspected schema file: ${tsSchemaFile}`);

      // 9. Write push config pointing introspected schema at prod branch
      const pushConfigPath = await createTempDrizzleConfig({
        tmpDir,
        configName: "drizzle-push.config.js",
        schemaPath: path.join(schemaOutDir, tsSchemaFile),
      });

      // 10. Run drizzle-kit push directly against production (--force skips
      //    interactive prompts).
      // TODO: In a follow-up PR, we should add a warning for destructive changes.
      const pushResult = await spawnDrizzleKit({
        args: ["push", "--force", `--config=${pushConfigPath}`],
        cwd: tmpDir,
        connectionUri: prodUri,
      });

      if (pushResult.exitCode !== 0) {
        throw new DyadError(
          `Migration push failed: ${pushResult.stderr || pushResult.stdout}`,
          DyadErrorKind.External,
        );
      }

      // drizzle-kit does not expose a machine-readable "already in sync" flag.
      const noChanges = /no\s+changes\s+detected/i.test(pushResult.stdout);
      logger.info(
        noChanges
          ? `Schemas already in sync for app ${appId}, nothing to migrate.`
          : `Migration push completed successfully for app ${appId}`,
      );
      return { success: true, noChanges };
    } finally {
      // 11. Always clean up temp directory
      await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
        logger.warn(`Failed to clean up temp directory ${tmpDir}: ${err}`);
      });
    }
  });
}
