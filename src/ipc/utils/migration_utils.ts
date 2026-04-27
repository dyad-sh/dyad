import log from "electron-log";
import { utilityProcess } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import {
  getConnectionUri,
  executeNeonSql,
} from "../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { readEffectiveSettings } from "@/main/settings";
import { getDyadAppPath } from "../../paths/paths";
import { getAppWithNeonBranch } from "./neon_utils";
import { gitAdd, gitCommit } from "./git_utils";
import {
  DestructiveStatement,
  DestructiveStatementReason,
} from "../types/migration";
import {
  ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
  buildAddDependencyCommand,
  CommandExecutionError,
  detectPreferredPackageManager,
  ensureSocketFirewallInstalled,
  runCommand,
} from "./socket_firewall";

export const logger = log.scope("migration_handlers");

const MIGRATION_DEPS = ["drizzle-kit", "drizzle-orm"] as const;

/**
 * Finds the production (default) branch for a Neon project.
 */
export async function getProductionBranchId(
  projectId: string,
): Promise<{ branchId: string }> {
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

  return { branchId: prodBranch.id };
}

/**
 * Resolves the path to the drizzle-kit bin.cjs inside the user's app.
 */
export function getDrizzleKitPath(appPath: string): string {
  return path.join(appPath, "node_modules", "drizzle-kit", "bin.cjs");
}

export async function areMigrationDepsInstalled(
  appPath: string,
): Promise<boolean> {
  try {
    await fs.access(getDrizzleKitPath(appPath));
    await fs.access(path.join(appPath, "node_modules", "drizzle-orm"));
    return true;
  } catch {
    return false;
  }
}

export async function installMigrationDeps(appPath: string): Promise<void> {
  if (IS_TEST_BUILD) {
    return;
  }

  const settings = await readEffectiveSettings();
  let useSocketFirewall = settings.blockUnsafeNpmPackages !== false;
  if (useSocketFirewall) {
    const sfw = await ensureSocketFirewallInstalled();
    if (!sfw.available) {
      useSocketFirewall = false;
      if (sfw.warningMessage) {
        logger.warn(sfw.warningMessage);
      }
    }
  }

  const packageManager = await detectPreferredPackageManager();
  const command = buildAddDependencyCommand(
    [...MIGRATION_DEPS],
    packageManager,
    useSocketFirewall,
  );

  logger.info(
    `Installing migration deps in ${appPath}: ${command.command} ${command.args.join(" ")}`,
  );

  try {
    await runCommand(command.command, command.args, {
      cwd: appPath,
      timeoutMs: ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
    });
  } catch (error) {
    const detail =
      error instanceof CommandExecutionError
        ? error.stderr.trim() || error.stdout.trim() || error.message
        : error instanceof Error
          ? error.message
          : String(error);
    throw new DyadError(
      `Failed to install migration dependencies: ${detail}`,
      DyadErrorKind.External,
    );
  }
}

/**
 * Writes a temporary drizzle config file (.js) for introspect or push.
 */
export async function createTempDrizzleConfig({
  tmpDir,
  configName,
  schemaPath,
}: {
  tmpDir: string;
  configName: string;
  schemaPath?: string;
}): Promise<string> {
  const outDir = path.join(tmpDir, "schema-out").replace(/\\/g, "/");
  // Reference an env var instead of writing the connection URI to disk.
  // The actual value is passed via spawnDrizzleKit's `connectionUri` param.
  const configContent = `module.exports = {
  dialect: "postgresql",
  out: ${JSON.stringify(outDir)},
  dbCredentials: {
    url: process.env.DRIZZLE_DATABASE_URL,
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
 * Spawns drizzle-kit in an Electron utility process so packaged builds do not
 * rely on a separate system Node.js binary.
 */
export async function spawnDrizzleKit({
  args,
  cwd,
  appPath,
  connectionUri,
  timeoutMs = 120_000,
}: {
  args: string[];
  cwd: string;
  /** Path to the user's app — drizzle-kit and drizzle-orm resolve from here. */
  appPath: string;
  /** Passed as DRIZZLE_DATABASE_URL env var so credentials never touch disk. */
  connectionUri: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (IS_TEST_BUILD) {
    const drizzleCommand = args[0];

    if (drizzleCommand === "introspect") {
      const schemaOutDir = path.join(cwd, "schema-out");
      await fs.mkdir(schemaOutDir, { recursive: true });
      await fs.writeFile(path.join(schemaOutDir, "schema.ts"), "export {};\n", {
        encoding: "utf-8",
      });
      return {
        stdout: "Mock drizzle-kit introspection completed.\n",
        stderr: "",
        exitCode: 0,
      };
    }

    if (drizzleCommand === "push") {
      return {
        stdout: "Mock drizzle-kit push completed.\n",
        stderr: "",
        exitCode: 0,
      };
    }

    throw new Error(
      `Unsupported drizzle-kit command in test build: ${drizzleCommand}`,
    );
  }

  const drizzleKitBin = getDrizzleKitPath(appPath);

  // Create a node_modules symlink in the working directory so that generated
  // schema files can resolve drizzle-orm and other dependencies through
  // standard Node.js module resolution (walking up to find node_modules),
  // in addition to the NODE_PATH env var set below.
  const nodeModulesPath = path.join(appPath, "node_modules");
  const symlinkTarget = path.join(cwd, "node_modules");
  try {
    await fs.symlink(nodeModulesPath, symlinkTarget, "junction");
  } catch (symlinkErr) {
    logger.warn(
      `Failed to create node_modules symlink: ${symlinkErr}. Falling back to NODE_PATH.`,
    );
  }

  return new Promise((resolve, reject) => {
    logger.info(`Running drizzle-kit: ${drizzleKitBin} ${args.join(" ")}`);

    let proc;
    try {
      proc = utilityProcess.fork(drizzleKitBin, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        serviceName: "drizzle-kit",
        env: Object.fromEntries(
          Object.entries({
            // Minimal env for Node.js / drizzle-kit to function.
            // Deliberately NOT spreading process.env to avoid leaking
            // secrets (OAuth tokens, API keys, etc.) to the subprocess.
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            USERPROFILE: process.env.USERPROFILE,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            TMPDIR: process.env.TMPDIR,
            NODE_PATH: nodeModulesPath,
            DRIZZLE_DATABASE_URL: connectionUri,
          }).filter(([, v]) => v !== undefined),
        ),
      });
    } catch (error) {
      reject(
        new DyadError(
          `Failed to spawn drizzle-kit: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Internal,
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutError: DyadError | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutError = new DyadError(
        `drizzle-kit timed out after ${timeoutMs}ms. The database endpoint may be suspended or unreachable.`,
        DyadErrorKind.External,
      );
      proc.kill();
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

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (timedOut && timeoutError) {
        reject(timeoutError);
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    });

    proc.on("error", (type, location, report) => {
      if (timedOut) return;
      clearTimeout(timer);
      reject(
        new DyadError(
          `drizzle-kit utility process failed (${type}) at ${location}. ${report}`,
          DyadErrorKind.Internal,
        ),
      );
    });
  });
}

// =============================================================================
// Migration preview (drizzle-kit push --verbose --strict, killed before apply)
// =============================================================================

const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-ntqry=><]/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}

// `m` flag is required because the cumulative-stdout check in
// spawnDrizzleKitWithEarlyTermination tests this against a multi-line buffer
// (`Pulling schema...\n` precedes the first SQL line). Without it, `^` only
// matches the start of the buffer and the idle-timer fallback never arms.
const SQL_START_RE =
  /^\s*(CREATE|ALTER|DROP|TRUNCATE|COMMENT|INSERT|UPDATE|DELETE)\b/im;

const PROMPT_MARKER_RE = /Are you sure|\(y\/N\)|❯|Yes,\s*I want/i;

const WARNING_PREFIX_RE = /^\s*[·•]\s+/;

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
  statements: string[],
): DestructiveStatement[] {
  const out: DestructiveStatement[] = [];
  statements.forEach((stmt, index) => {
    for (const { regex, reason } of DESTRUCTIVE_PATTERNS) {
      if (regex.test(stmt)) {
        out.push({ index, reason });
        break;
      }
    }
  });
  return out;
}

// Parses drizzle-kit's `push --verbose` stdout. Format anchored to drizzle-kit
// 0.30.x — must be re-validated if MIGRATION_DEPS bumps to a new major.
export function parseDrizzlePushVerboseOutput(rawStdout: string): {
  statements: string[];
  warnings: string[];
} {
  const cleaned = stripAnsi(rawStdout);
  const lines = cleaned.split(/\r?\n/);

  const statements: string[] = [];
  const warnings: string[] = [];
  let buf = "";
  let inSql = false;

  const flush = () => {
    const trimmed = buf.trim().replace(/;\s*$/, "").trim();
    if (trimmed.length > 0) {
      statements.push(trimmed + ";");
    }
    buf = "";
    inSql = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");

    if (PROMPT_MARKER_RE.test(line)) {
      flush();
      // Everything after the prompt marker is hanji UI noise.
      buf = "";
      inSql = false;
      break;
    }

    // drizzle-kit emits data-loss warnings as bullet lines like
    //   "· You're about to delete column X in Y table"
    // before any SQL appears.
    if (!inSql && WARNING_PREFIX_RE.test(line)) {
      warnings.push(line.replace(WARNING_PREFIX_RE, "").trim());
      continue;
    }

    if (SQL_START_RE.test(line)) {
      flush();
      buf = line + "\n";
      inSql = true;
      if (/;\s*$/.test(line)) {
        flush();
      }
      continue;
    }

    if (inSql) {
      buf += line + "\n";
      if (/;\s*$/.test(line)) {
        flush();
      }
    }
  }

  flush();
  return { statements, warnings };
}

interface SpawnDrizzleKitWithEarlyTerminationParams {
  args: string[];
  cwd: string;
  appPath: string;
  connectionUri: string;
  /** Resolve when stdout idles for this long after first SQL line. */
  idleMs?: number;
  /** Hard ceiling — also catches a hung introspect. */
  maxWaitMs?: number;
  /** If returns true on a chunk, terminate immediately. */
  shouldTerminateEarly?: (cumulativeStdout: string) => boolean;
}

interface SpawnDrizzleKitWithEarlyTerminationResult {
  stdout: string;
  stderr: string;
  terminatedReason: "idle" | "shouldTerminateEarly" | "exit" | "timeout";
}

export async function spawnDrizzleKitWithEarlyTermination({
  args,
  cwd,
  appPath,
  connectionUri,
  idleMs = 2500,
  maxWaitMs = 90_000,
  shouldTerminateEarly,
}: SpawnDrizzleKitWithEarlyTerminationParams): Promise<SpawnDrizzleKitWithEarlyTerminationResult> {
  if (IS_TEST_BUILD) {
    return {
      stdout: 'CREATE TABLE "mock" ();\n',
      stderr: "",
      terminatedReason: "exit",
    };
  }

  const drizzleKitBin = getDrizzleKitPath(appPath);

  const nodeModulesPath = path.join(appPath, "node_modules");
  const symlinkTarget = path.join(cwd, "node_modules");
  try {
    await fs.symlink(nodeModulesPath, symlinkTarget, "junction");
  } catch (symlinkErr) {
    logger.warn(
      `Failed to create node_modules symlink: ${symlinkErr}. Falling back to NODE_PATH.`,
    );
  }

  return new Promise((resolve, reject) => {
    logger.info(
      `Running drizzle-kit (preview): ${drizzleKitBin} ${args.join(" ")}`,
    );

    let proc: ReturnType<typeof utilityProcess.fork>;
    try {
      proc = utilityProcess.fork(drizzleKitBin, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        serviceName: "drizzle-kit-preview",
        env: Object.fromEntries(
          Object.entries({
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            USERPROFILE: process.env.USERPROFILE,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            TMPDIR: process.env.TMPDIR,
            NODE_PATH: nodeModulesPath,
            DRIZZLE_DATABASE_URL: connectionUri,
          }).filter(([, v]) => v !== undefined),
        ),
      });
    } catch (error) {
      reject(
        new DyadError(
          `Failed to spawn drizzle-kit: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Internal,
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let armed = false;
    let settled = false;
    let idleTimer: NodeJS.Timeout | null = null;

    const settle = (
      reason: SpawnDrizzleKitWithEarlyTerminationResult["terminatedReason"],
    ) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      if (reason !== "exit") {
        try {
          proc.kill();
        } catch {
          // best-effort
        }
      }
      resolve({ stdout, stderr, terminatedReason: reason });
    };

    const armOrResetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => settle("idle"), idleMs);
    };

    const maxTimer = setTimeout(() => settle("timeout"), maxWaitMs);

    proc.stdout?.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      logger.info(`drizzle-kit (preview) stdout: ${chunk}`);

      const cleaned = stripAnsi(stdout);

      if (!armed && SQL_START_RE.test(cleaned)) {
        armed = true;
      }
      if (armed) {
        armOrResetIdle();
      }

      if (shouldTerminateEarly && shouldTerminateEarly(stdout)) {
        settle("shouldTerminateEarly");
      }
    });

    proc.stderr?.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      logger.warn(`drizzle-kit (preview) stderr: ${chunk}`);
    });

    proc.on("exit", () => {
      settle("exit");
    });

    proc.on("error", (type, location, report) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      reject(
        new DyadError(
          `drizzle-kit utility process failed (${type}) at ${location}. ${report}`,
          DyadErrorKind.Internal,
        ),
      );
    });
  });
}

export async function runDrizzleKitPushPreview({
  appPath,
  cwd,
  prodConnectionUri,
  pushConfigPath,
}: {
  appPath: string;
  cwd: string;
  prodConnectionUri: string;
  pushConfigPath: string;
}): Promise<{
  statements: string[];
  warnings: string[];
  hasDataLoss: boolean;
}> {
  if (IS_TEST_BUILD) {
    return {
      statements: ['CREATE TABLE "mock" ();'],
      warnings: [],
      hasDataLoss: false,
    };
  }

  const result = await spawnDrizzleKitWithEarlyTermination({
    args: ["push", "--verbose", "--strict", `--config=${pushConfigPath}`],
    cwd,
    appPath,
    connectionUri: prodConnectionUri,
    idleMs: 2500,
    maxWaitMs: 90_000,
    shouldTerminateEarly: (cum) => PROMPT_MARKER_RE.test(stripAnsi(cum)),
  });

  const { statements, warnings } = parseDrizzlePushVerboseOutput(result.stdout);

  // Empty parse + clean exit usually means "no changes detected".
  if (statements.length === 0 && result.terminatedReason === "exit") {
    return { statements: [], warnings, hasDataLoss: warnings.length > 0 };
  }

  // Empty parse but drizzle-kit clearly did real work — assume parser drift.
  if (
    statements.length === 0 &&
    result.stdout.length > 1024 &&
    /Pulling schema/i.test(stripAnsi(result.stdout))
  ) {
    throw new DyadError(
      "Could not parse drizzle-kit migration plan output. The drizzle-kit version may have changed format.",
      DyadErrorKind.Internal,
    );
  }

  if (result.terminatedReason === "timeout") {
    logger.warn(
      `drizzle-kit preview hit max-wait timeout — returning whatever was parsed.`,
    );
  }

  const destructive = detectDestructiveStatements(statements);
  return {
    statements,
    warnings,
    hasDataLoss: destructive.length > 0 || warnings.length > 0,
  };
}

// =============================================================================
// Shared migration setup (used by both `migration:preview` and `migration:push`)
// =============================================================================

export interface MigrationContext {
  projectId: string;
  devBranchId: string;
  prodBranchId: string;
  devUri: string;
  prodUri: string;
  appPath: string;
  tmpDir: string;
  pushConfigPath: string;
  cleanup: () => Promise<void>;
}

export async function prepareMigrationContext({
  appId,
}: {
  appId: number;
}): Promise<MigrationContext> {
  // 1. Resolve branches
  const { appData, branchId: devBranchId } = await getAppWithNeonBranch(appId);
  const projectId = appData.neonProjectId!;
  const { branchId: prodBranchId } = await getProductionBranchId(projectId);

  logger.info(
    `Resolved branches — dev: ${devBranchId}, prod: ${prodBranchId}, project: ${projectId}`,
  );

  if (devBranchId === prodBranchId) {
    throw new DyadError(
      "Active branch is the production branch. Create a development branch first.",
      DyadErrorKind.Precondition,
    );
  }

  // 2. Connection URIs
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

  // 4. Ensure migration deps are installed in the user's app
  const appPath = getDyadAppPath(appData.path);
  if (!(await areMigrationDepsInstalled(appPath))) {
    logger.info(
      `Migration dependencies not installed in ${appPath}; installing now.`,
    );
    await installMigrationDeps(appPath);

    try {
      await gitAdd({ path: appPath, filepath: "package.json" });
      for (const lockfile of [
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
      ]) {
        await gitAdd({ path: appPath, filepath: lockfile }).catch(() => {});
      }
      await gitCommit({
        path: appPath,
        message: "[dyad] install drizzle-kit and drizzle-orm for migrations",
      });
      logger.info(`Committed migration dependency install in ${appPath}`);
    } catch (err) {
      logger.warn(
        `Failed to commit migration dependency install. This may happen if the project is not in a git repository, or if there are no changes to commit.`,
        err,
      );
    }
  }

  // 5. Temp directory with restricted permissions
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-migration-"));
  if (process.platform !== "win32") {
    await fs.chmod(tmpDir, 0o700);
  }

  const cleanup = async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
      logger.warn(`Failed to clean up temp directory ${tmpDir}: ${err}`);
    });
  };

  try {
    // 6. Introspect dev schema
    const introspectConfigPath = await createTempDrizzleConfig({
      tmpDir,
      configName: "drizzle-introspect.config.js",
    });

    const introspectResult = await spawnDrizzleKit({
      args: ["introspect", `--config=${introspectConfigPath}`],
      cwd: tmpDir,
      appPath,
      connectionUri: devUri,
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

    // 8. Push config pointing at the introspected schema
    const pushConfigPath = await createTempDrizzleConfig({
      tmpDir,
      configName: "drizzle-push.config.js",
      schemaPath: path.join(schemaOutDir, tsSchemaFile),
    });

    return {
      projectId,
      devBranchId,
      prodBranchId,
      devUri,
      prodUri,
      appPath,
      tmpDir,
      pushConfigPath,
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
