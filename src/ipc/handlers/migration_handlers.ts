import log from "electron-log";
import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "child_process";
import { createTypedHandler } from "./base";
import { migrationContracts } from "../types/migration";
import type { MigrationStatement } from "../types/migration";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import {
  getConnectionUri,
  executeNeonSql,
} from "../../neon_admin/neon_context";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("migration_handlers");

// =============================================================================
// Helper Functions
// =============================================================================

type AppRow = typeof apps.$inferSelect;

/**
 * Fetches an app record and validates it has a Neon project and dev branch.
 */
async function getAppWithNeonProject(appId: number): Promise<{
  appData: AppRow;
  projectId: string;
  devBranchId: string;
}> {
  const result = await db
    .select()
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);

  if (result.length === 0) {
    throw new DyadError(
      `App with ID ${appId} not found`,
      DyadErrorKind.NotFound,
    );
  }

  const appData = result[0];
  if (!appData.neonProjectId) {
    throw new DyadError(
      `No Neon project found for app ${appId}. Connect a Neon database first.`,
      DyadErrorKind.Precondition,
    );
  }

  const devBranchId =
    appData.neonDevelopmentBranchId ?? appData.neonActiveBranchId;
  if (!devBranchId) {
    throw new DyadError(
      `No development branch found for app ${appId}`,
      DyadErrorKind.Precondition,
    );
  }

  return { appData, projectId: appData.neonProjectId, devBranchId };
}

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
  await fs.writeFile(configPath, configContent, "utf-8");
  return configPath;
}

/**
 * Spawns drizzle-kit as a child process via system node.
 */
async function spawnDrizzleKit({
  args,
  cwd,
  stdinData,
  timeoutMs = 60_000,
}: {
  args: string[];
  cwd: string;
  stdinData?: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const drizzleKitBin = getDrizzleKitPath();
  const command = `node "${drizzleKitBin}" ${args.join(" ")}`;

  return new Promise((resolve, reject) => {
    logger.info(`Running: ${command}`);

    // Set NODE_PATH so that schema files in the temp dir can resolve
    // drizzle-orm and other dependencies from the project's node_modules.
    const nodeModulesPath = path.join(app.getAppPath(), "node_modules");
    const proc = spawn(command, {
      cwd,
      shell: true,
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

    if (stdinData) {
      // Write to stdin after a brief delay to ensure the process is ready
      setTimeout(() => {
        proc.stdin?.write(stdinData);
        proc.stdin?.end();
      }, 500);
    }

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
// SQL Statement Analysis
// =============================================================================

/**
 * Strips ANSI escape codes from a string.
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Parses SQL statements from drizzle-kit push --verbose output.
 */
export function parseDrizzleKitPushOutput(rawOutput: string): string[] {
  const output = stripAnsi(rawOutput);
  const lines = output.split("\n");

  const statements: string[] = [];
  let currentStatement = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and drizzle-kit UI noise
    if (!trimmed) {
      // Empty line might separate statements — flush if we have content
      if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
        currentStatement = "";
      }
      continue;
    }

    // Skip known non-SQL lines
    if (
      trimmed.startsWith("[") ||
      trimmed.startsWith("~") ||
      trimmed.startsWith(">") ||
      trimmed.startsWith("---") ||
      trimmed.startsWith("Warning:") ||
      trimmed.startsWith("drizzle-kit:") ||
      /^Do you want to apply/i.test(trimmed) ||
      /^Yes,? I want/i.test(trimmed) ||
      /^No,? abort/i.test(trimmed) ||
      /^Reading schema/i.test(trimmed) ||
      /^Pulling schema/i.test(trimmed) ||
      /^Changes applied/i.test(trimmed) ||
      /^No changes/i.test(trimmed) ||
      /^Your schema/i.test(trimmed) ||
      /^\d+ (tables?|columns?|indexes?|enums?)/i.test(trimmed)
    ) {
      // Flush current statement before skipping
      if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
        currentStatement = "";
      }
      continue;
    }

    // Check if this line starts a new SQL statement
    if (
      /^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SET|DO|BEGIN|COMMIT|TRUNCATE|GRANT|REVOKE)\s/i.test(
        trimmed,
      )
    ) {
      // Flush previous statement
      if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
      }
      currentStatement = trimmed;
    } else if (currentStatement) {
      // Continuation of current statement
      currentStatement += "\n" + trimmed;
    }
    // If no current statement and line doesn't look like SQL start, skip it
  }

  // Flush final statement
  if (currentStatement.trim()) {
    statements.push(currentStatement.trim());
  }

  // Post-process: remove trailing semicolons (we add them back when executing)
  return statements
    .map((s) => s.replace(/;\s*$/, "").trim())
    .filter((s) => s.length > 0);
}

/**
 * Classifies a SQL statement by its DDL type.
 */
export function classifyStatement(
  sql: string,
): "create" | "alter" | "drop" | "other" {
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith("CREATE ")) return "create";
  if (trimmed.startsWith("ALTER ")) return "alter";
  if (trimmed.startsWith("DROP ")) return "drop";
  return "other";
}

/**
 * Extracts the table name from a DDL statement.
 */
export function extractTableName(sql: string): string | null {
  const match = sql.match(
    /(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:"([^"]+)"|(\w+))/i,
  );
  return match?.[1] ?? match?.[2] ?? null;
}

/**
 * Returns true if the SQL statement is destructive (data loss risk).
 */
export function isDestructiveStatement(sql: string): boolean {
  const upper = sql.toUpperCase();
  if (/^\s*DROP\s+TABLE/i.test(sql)) return true;
  if (/^\s*TRUNCATE/i.test(sql)) return true;
  if (upper.includes("DROP COLUMN")) return true;
  if (/ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE/i.test(sql)) return true;
  return false;
}

// =============================================================================
// Handler Registration
// =============================================================================

export function registerMigrationHandlers() {
  // -------------------------------------------------------------------------
  // migration:generate-diff
  // -------------------------------------------------------------------------
  createTypedHandler(migrationContracts.generateDiff, async (_, params) => {
    const { appId } = params;
    logger.info(`Generating migration diff for app ${appId}`);

    // 1. Get app data and resolve branches
    const { projectId, devBranchId } = await getAppWithNeonProject(appId);
    const { branchId: prodBranchId, branchName: prodBranchName } =
      await getProductionBranchId(projectId);

    logger.info(
      `Resolved branches — dev: ${devBranchId}, prod: ${prodBranchId}, project: ${projectId}`,
    );

    // Get dev branch name for the UI
    const neonClient = await getNeonClient();
    const branchesResponse = await neonClient.listProjectBranches({
      projectId,
    });
    const devBranch = branchesResponse.data.branches?.find(
      (b) => b.id === devBranchId,
    );
    const devBranchName = devBranch?.name ?? "development";

    // 2. Get connection URIs for both branches
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
        "Development database has no tables. Create at least one table before generating a migration.",
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

      // 7. Find the generated schema file(s)
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

      // Prefer schema.ts explicitly — relations.ts doesn't contain table definitions
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

      // 9. Run drizzle-kit push --verbose --strict against production
      //    Pipe "n\n" to stdin to abort actual execution
      const pushResult = await spawnDrizzleKit({
        args: ["push", `--config=${pushConfigPath}`, "--verbose", "--strict"],
        cwd: tmpDir,
        stdinData: "n\n",
      });

      // Exit code may be non-zero because we aborted — that's expected.
      // We only care about parsing SQL from the output.

      // 10. Parse SQL statements from push output
      const combinedOutput = pushResult.stdout + "\n" + pushResult.stderr;
      const rawStatements = parseDrizzleKitPushOutput(combinedOutput);

      if (rawStatements.length === 0) {
        return {
          hasChanges: false,
          statements: [],
          fullSql: "",
          summary: { added: [], altered: [], dropped: [] },
          hasDestructiveChanges: false,
          devBranchName,
          prodBranchName,
        };
      }

      // 11. Classify statements and build summary
      const statements: MigrationStatement[] = rawStatements.map((sql) => ({
        sql,
        type: classifyStatement(sql),
      }));

      const added = new Set<string>();
      const altered = new Set<string>();
      const dropped = new Set<string>();

      for (const stmt of statements) {
        const tableName = extractTableName(stmt.sql);
        if (!tableName) continue;
        switch (stmt.type) {
          case "create":
            added.add(tableName);
            break;
          case "alter":
            altered.add(tableName);
            break;
          case "drop":
            dropped.add(tableName);
            break;
        }
      }

      const hasDestructiveChanges = statements.some((s) =>
        isDestructiveStatement(s.sql),
      );

      return {
        hasChanges: true,
        statements,
        fullSql: rawStatements.join(";\n\n") + ";",
        summary: {
          added: [...added],
          altered: [...altered],
          dropped: [...dropped],
        },
        hasDestructiveChanges,
        devBranchName,
        prodBranchName,
      };
    } finally {
      // 12. Always clean up temp directory
      await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
        logger.warn(`Failed to clean up temp directory ${tmpDir}: ${err}`);
      });
    }
  });

  // -------------------------------------------------------------------------
  // migration:apply
  // -------------------------------------------------------------------------
  createTypedHandler(migrationContracts.apply, async (_, params) => {
    const { appId, statements } = params;
    logger.info(
      `Applying migration for app ${appId}: ${statements.length} statements`,
    );

    if (statements.length === 0) {
      throw new DyadError(
        "No migration statements to apply.",
        DyadErrorKind.Validation,
      );
    }

    const { projectId } = await getAppWithNeonProject(appId);
    const { branchId: prodBranchId } = await getProductionBranchId(projectId);

    // Execute each statement individually — Neon's serverless driver
    // uses prepared statements which don't support multiple commands.
    try {
      for (const stmt of statements) {
        const sql = stmt.endsWith(";") ? stmt : stmt + ";";
        logger.info(`Executing migration statement: ${sql.slice(0, 80)}...`);
        await executeNeonSql({
          projectId,
          branchId: prodBranchId,
          query: sql,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DyadError(
        `Migration failed. Some statements may have been applied. Error: ${message}`,
        DyadErrorKind.External,
      );
    }

    logger.info(
      `Migration applied successfully: ${statements.length} statements executed`,
    );
    return {
      success: true,
      statementsExecuted: statements.length,
    };
  });
}
