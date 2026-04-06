import log from "electron-log";
import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "child_process";
import { createTypedHandler } from "./base";
import { migrationContracts } from "../types/migration";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import {
  getConnectionUri,
  executeNeonSql,
} from "../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAppWithNeonBranch } from "./neon_handlers";

const logger = log.scope("migration_handlers");

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Finds the production (default) branch for a Neon project.
 */
async function getProductionBranchId(
  projectId: string,
): Promise<{ branchId: string; branchName: string }> {
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

  return { branchId: prodBranch.id, branchName: prodBranch.name };
}

/**
 * Resolves the path to the drizzle-kit bin.cjs file.
 */
function getDrizzleKitPath(): string {
  if (!app.isPackaged) {
    return path.join(
      app.getAppPath(),
      "node_modules",
      "drizzle-kit",
      "bin.cjs",
    );
  }
  return path.join(process.resourcesPath, "drizzle-kit", "bin.cjs");
}

/**
 * Writes a temporary drizzle config file (.js) for introspect or push.
 */
async function createTempDrizzleConfig({
  tmpDir,
  connectionUri,
  configName,
  schemaPath,
}: {
  tmpDir: string;
  connectionUri: string;
  configName: string;
  schemaPath?: string;
}): Promise<string> {
  const outDir = path.join(tmpDir, "schema-out").replace(/\\/g, "/");
  const configContent = `module.exports = {
  dialect: "postgresql",
  out: "${outDir}",
  dbCredentials: {
    url: ${JSON.stringify(connectionUri)},
  },${schemaPath ? `\n  schema: ${JSON.stringify(schemaPath.replace(/\\/g, "/"))},` : ""}
};
`;
  const configPath = path.join(tmpDir, configName);
  await fs.writeFile(configPath, configContent, {
    encoding: "utf-8",
    mode: 0o600,
  });
  return configPath;
}

/**
 * Spawns drizzle-kit as a child process via system node.
 */
async function spawnDrizzleKit({
  args,
  cwd,
  timeoutMs = 60_000,
}: {
  args: string[];
  cwd: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const drizzleKitBin = getDrizzleKitPath();

  return new Promise((resolve, reject) => {
    logger.info(`Running: node ${drizzleKitBin} ${args.join(" ")}`);

    // Set NODE_PATH so that schema files in the temp dir can resolve
    // drizzle-orm and other dependencies from the project's node_modules.
    const nodeModulesPath = path.join(app.getAppPath(), "node_modules");
    const proc = spawn("node", [drizzleKitBin, ...args], {
      cwd,
      stdio: "pipe",
      env: { ...process.env, NODE_PATH: nodeModulesPath },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(
        new DyadError(
          `drizzle-kit timed out after ${timeoutMs}ms. The database endpoint may be suspended or unreachable.`,
          DyadErrorKind.External,
        ),
      );
    }, timeoutMs);

    proc.stdout?.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      logger.info(`drizzle-kit stdout: ${output}`);
    });

    proc.stderr?.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      logger.warn(`drizzle-kit stderr: ${output}`);
    });

    proc.on("close", (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      reject(
        new DyadError(
          `Failed to spawn drizzle-kit: ${err.message}`,
          DyadErrorKind.Internal,
        ),
      );
    });
  });
}

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

    // 3. Validate dev schema has at least one table
    const tableCheckResult = await executeNeonSql({
      projectId,
      branchId: devBranchId,
      query:
        "SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema = 'public'",
    });
    const tableCount = JSON.parse(tableCheckResult);
    if (!tableCount?.[0]?.cnt || parseInt(tableCount[0].cnt) === 0) {
      throw new DyadError(
        "Development database has no tables. Create at least one table before migrating.",
        DyadErrorKind.Precondition,
      );
    }

    // 4. Create temp directory
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-migration-"));

    try {
      // 5. Write introspect config pointing at dev branch
      const introspectConfigPath = await createTempDrizzleConfig({
        tmpDir,
        connectionUri: devUri,
        configName: "drizzle-introspect.config.js",
      });

      // 6. Run drizzle-kit introspect to generate schema files
      const introspectResult = await spawnDrizzleKit({
        args: ["introspect", `--config=${introspectConfigPath}`],
        cwd: tmpDir,
      });

      if (introspectResult.exitCode !== 0) {
        throw new DyadError(
          `Schema introspection failed: ${introspectResult.stderr || introspectResult.stdout}`,
          DyadErrorKind.External,
        );
      }

      // 7. Find the generated schema file
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

      // 8. Write push config pointing introspected schema at prod branch
      const pushConfigPath = await createTempDrizzleConfig({
        tmpDir,
        connectionUri: prodUri,
        configName: "drizzle-push.config.js",
        schemaPath: path.join(schemaOutDir, tsSchemaFile),
      });

      // 9. Run drizzle-kit push directly against production
      const pushResult = await spawnDrizzleKit({
        args: ["push", `--config=${pushConfigPath}`],
        cwd: tmpDir,
      });

      if (pushResult.exitCode !== 0) {
        throw new DyadError(
          `Migration push failed: ${pushResult.stderr || pushResult.stdout}`,
          DyadErrorKind.External,
        );
      }

      logger.info(`Migration push completed successfully for app ${appId}`);
      return { success: true };
    } finally {
      // 10. Always clean up temp directory
      await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
        logger.warn(`Failed to clean up temp directory ${tmpDir}: ${err}`);
      });
    }
  });
}
