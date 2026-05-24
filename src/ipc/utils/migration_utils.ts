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
  commitPnpmAllowBuildsConfigIfChanged,
  detectPreferredPackageManager,
  ensureSocketFirewallInstalled,
  runCommand,
} from "./socket_firewall";

export const logger = log.scope("migration_handlers");

// Pin to the latest drizzle-kit/drizzle-orm v1 RC so new auto-installs land on
// the v1 migration layout (per-migration directories with migration.sql +
// snapshot.json). Users who already have <1.0.0 installed are detected at
// runtime and read via the pre-v1 journal+meta layout instead — see
// `getInstalledDrizzleKitMajor`.
export const MIGRATION_DRIZZLE_KIT_VERSION = "1.0.0-rc.3";
export const MIGRATION_DRIZZLE_ORM_VERSION = "1.0.0-rc.3";

const MIGRATION_DEPS = [
  `drizzle-kit@${MIGRATION_DRIZZLE_KIT_VERSION}`,
  `drizzle-orm@${MIGRATION_DRIZZLE_ORM_VERSION}`,
] as const;

// =============================================================================
// Constants
// =============================================================================

export const BASELINE_NAME = "baseline";

// No-op SQL body. The body produces zero statements when fed to
// `parseDrizzleMigrationFile` (comment-only chunks are stripped), so the
// baseline file never contributes to the apply plan. The exact constant also
// gives `readPendingMigrationFiles` an unambiguous content-equality check to
// recognize the baseline regardless of the random tag drizzle-kit chose for it.
export const BASELINE_SQL_BODY =
  "-- Baseline: prod schema captured at bootstrap. Intentionally no-op; the snapshot\n" +
  "-- file is the authoritative anchor for diffing.\n";

const PROD_INTROSPECT_TTL_MS = 5 * 60 * 1000;

// =============================================================================
// Branch resolution
// =============================================================================

/**
 * Finds the production (default) branch for a Neon project. `updatedAt` is
 * the branch's `updated_at` timestamp from Neon — captured at preview time
 * and re-checked at apply time to reject stale plans (see migration_plan_store).
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
// drizzle-kit dep management (in user app)
// =============================================================================

/**
 * Resolves the path to the drizzle-kit bin.cjs inside the user's app.
 */
export function getDrizzleKitPath(appPath: string): string {
  return path.join(appPath, "node_modules", "drizzle-kit", "bin.cjs");
}

/**
 * Semver major of drizzle-kit. `0` for the pre-v1 layout (journal +
 * `meta/<idx>_snapshot.json` + `<tag>.sql`), `1` for the v1+ layout
 * (per-migration directories with `migration.sql` + `snapshot.json`).
 */
export type DrizzleKitMajor = 0 | 1;

/**
 * Reads the `version` field from a package's installed `package.json` and
 * returns its semver major as a number. Throws `DyadError` when the file is
 * missing or the version string can't be parsed.
 */
async function readInstalledPackageMajor(
  appPath: string,
  packageName: string,
): Promise<number> {
  const pkgPath = path.join(
    appPath,
    "node_modules",
    packageName,
    "package.json",
  );
  let version: string;
  try {
    const parsed = JSON.parse(await fs.readFile(pkgPath, "utf-8")) as {
      version?: string;
    };
    if (typeof parsed.version !== "string") {
      throw new Error("missing or non-string version field");
    }
    version = parsed.version;
  } catch (err) {
    throw new DyadError(
      `Could not read ${packageName} version from ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`,
      DyadErrorKind.Internal,
    );
  }
  // Pre-release versions like "1.0.0-rc.3" still expose the major as the
  // leading int. Split on any non-digit to capture both stable ("1.2.3") and
  // pre-release ("1.0.0-rc.3", "1.0.0+build.7") forms.
  const major = parseInt(version.split(/[^0-9]/)[0], 10);
  if (Number.isNaN(major)) {
    throw new DyadError(
      `Could not parse ${packageName} version "${version}" in ${pkgPath}`,
      DyadErrorKind.Internal,
    );
  }
  return major;
}

/**
 * Returns true only when drizzle-kit and drizzle-orm are both installed AND
 * agree on their semver major. A split state (e.g. drizzle-kit@1.x with
 * drizzle-orm@0.x left over from a previous unpinned install) returns false
 * so `installMigrationDeps` runs and re-syncs both packages to the v1 RC
 * pin — otherwise drizzle-kit crashes with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED: './_relations'` because v1 drizzle-kit
 * imports a v1-only subpath of drizzle-orm.
 */
export async function areMigrationDepsInstalled(
  appPath: string,
): Promise<boolean> {
  try {
    await fs.access(getDrizzleKitPath(appPath));
    await fs.access(path.join(appPath, "node_modules", "drizzle-orm"));
  } catch {
    return false;
  }
  let kitMajor: number;
  let ormMajor: number;
  try {
    kitMajor = await readInstalledPackageMajor(appPath, "drizzle-kit");
    ormMajor = await readInstalledPackageMajor(appPath, "drizzle-orm");
  } catch (err) {
    logger.warn(
      `Could not read installed drizzle versions; will reinstall. Reason: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
  if (kitMajor !== ormMajor) {
    logger.warn(
      `Installed drizzle-kit major (${kitMajor}) does not match drizzle-orm major (${ormMajor}); reinstalling to align with ${MIGRATION_DRIZZLE_KIT_VERSION} / ${MIGRATION_DRIZZLE_ORM_VERSION}.`,
    );
    return false;
  }
  return true;
}

/**
 * Reads the installed drizzle-kit version from the user's `node_modules` and
 * returns the semver major. We never reinstall on top of an existing copy
 * when both packages are in sync, so a user who's already on drizzle-kit
 * <1.0.0 keeps the pre-v1 layout and readers branch accordingly; new
 * installs land on `MIGRATION_DRIZZLE_KIT_VERSION` (currently a 1.x RC) and
 * use the v1 layout.
 */
export async function getInstalledDrizzleKitMajor(
  appPath: string,
): Promise<DrizzleKitMajor> {
  if (IS_TEST_BUILD) return 1;
  const major = await readInstalledPackageMajor(appPath, "drizzle-kit");
  return major >= 1 ? 1 : 0;
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
  if (packageManager === "pnpm") {
    await commitPnpmAllowBuildsConfigIfChanged(appPath);
  }
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

// =============================================================================
// Work directory (per-app, stable path so preview→migrate can share state)
// =============================================================================

export function getMigrationWorkDir(appId: number): string {
  return path.join(os.tmpdir(), `dyad-migration-app-${appId}`);
}

export async function ensureFreshWorkDir(workDir: string): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(workDir, { recursive: true });
  if (process.platform !== "win32") {
    await fs.chmod(workDir, 0o700);
  }
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true }).catch((err) => {
    logger.warn(`Failed to clean up work directory ${workDir}: ${err}`);
  });
}

// =============================================================================
// Drizzle config writers
// =============================================================================

/**
 * Writes a drizzle.config.js file. The DB URL is referenced via
 * process.env.DRIZZLE_DATABASE_URL so credentials never touch disk; the
 * actual value is passed via spawnDrizzleKit's `connectionUri` param.
 *
 * Paths are emitted RELATIVE to workDir. drizzle-kit's internal helpers do
 * `path.join(".", out)` in some code paths, which on macOS produces broken
 * paths like `.//var/folders/...` when given an absolute `out` — leading to
 * ENOENT on snapshot reads. We always spawn drizzle-kit with `cwd: workDir`,
 * so a relative `out` resolves cleanly.
 */
export async function createDrizzleConfig({
  workDir,
  configName,
  outDir,
  schemaPath,
}: {
  workDir: string;
  configName: string;
  outDir: string;
  schemaPath?: string;
}): Promise<string> {
  const relOut = toRelative(workDir, outDir);
  const relSchema = schemaPath ? toRelative(workDir, schemaPath) : undefined;
  const configContent = `module.exports = {
  dialect: "postgresql",
  out: ${JSON.stringify(relOut)},
  dbCredentials: {
    url: process.env.DRIZZLE_DATABASE_URL,
  },${relSchema ? `\n  schema: ${JSON.stringify(relSchema)},` : ""}
};
`;
  const configPath = path.join(workDir, configName);
  await fs.writeFile(configPath, configContent, {
    encoding: "utf-8",
    mode: 0o600,
  });
  return configPath;
}

function toRelative(from: string, target: string): string {
  const rel = path.relative(from, target).replace(/\\/g, "/");
  return rel.length === 0 ? "." : rel;
}

// =============================================================================
// drizzle-kit utility-process spawning
// =============================================================================

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
    return mockDrizzleKitRun({ args, cwd });
  }

  const { drizzleKitBin, forkOptions } = await prepareDrizzleKitForkOptions({
    appPath,
    cwd,
    connectionUri,
    serviceName: "drizzle-kit",
  });

  return new Promise((resolve, reject) => {
    logger.info(`Running drizzle-kit: ${drizzleKitBin} ${args.join(" ")}`);

    let proc;
    try {
      proc = utilityProcess.fork(drizzleKitBin, args, forkOptions);
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

interface SpawnDrizzleKitWithEarlyTerminationParams {
  args: string[];
  cwd: string;
  appPath: string;
  connectionUri: string;
  /** Hard ceiling — also catches a hung introspect/generate. */
  maxWaitMs?: number;
  /**
   * After drizzle-kit emits its first stdout chunk, settle "idle" if the
   * stream has been silent for this long. drizzle-kit + the
   * @neondatabase/serverless driver can leave a websocket open that prevents
   * the utility process from emitting 'exit' even after the command has
   * finished its work, so an idle fallback is needed for commands that
   * don't have observable side-effects beyond stdout/disk. Set to 0 or
   * undefined to disable.
   */
  idleMs?: number;
  /** If returns true on a chunk, terminate immediately. */
  shouldTerminateEarly?: (cumulativeStdout: string) => boolean;
}

interface SpawnDrizzleKitWithEarlyTerminationResult {
  stdout: string;
  stderr: string;
  terminatedReason: "shouldTerminateEarly" | "exit" | "timeout" | "idle";
  /** Process exit code. `null` when we settled before the child exited. */
  exitCode: number | null;
}

interface DrizzleKitForkSetup {
  drizzleKitBin: string;
  forkOptions: Parameters<typeof utilityProcess.fork>[2];
}

/**
 * Builds the drizzle-kit utility-process fork options used by both spawn
 * variants: minimal env (no leaked secrets), DRIZZLE_DATABASE_URL injection,
 * and a node_modules symlink under cwd so generated schema files can resolve
 * drizzle-orm via standard Node module resolution.
 */
async function prepareDrizzleKitForkOptions({
  appPath,
  cwd,
  connectionUri,
  serviceName,
}: {
  appPath: string;
  cwd: string;
  connectionUri: string;
  serviceName: string;
}): Promise<DrizzleKitForkSetup> {
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

  return {
    drizzleKitBin,
    forkOptions: {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      serviceName,
      env: Object.fromEntries(
        Object.entries({
          // Minimal env for Node.js / drizzle-kit to function. Deliberately
          // NOT spreading process.env to avoid leaking secrets (OAuth tokens,
          // API keys, etc.) to the subprocess.
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
    },
  };
}

export async function spawnDrizzleKitWithEarlyTermination({
  args,
  cwd,
  appPath,
  connectionUri,
  maxWaitMs = 120_000,
  idleMs,
  shouldTerminateEarly,
}: SpawnDrizzleKitWithEarlyTerminationParams): Promise<SpawnDrizzleKitWithEarlyTerminationResult> {
  if (IS_TEST_BUILD) {
    const mock = await mockDrizzleKitRun({ args, cwd });
    return {
      stdout: mock.stdout,
      stderr: mock.stderr,
      terminatedReason: "exit",
      exitCode: mock.exitCode,
    };
  }

  const { drizzleKitBin, forkOptions } = await prepareDrizzleKitForkOptions({
    appPath,
    cwd,
    connectionUri,
    serviceName: "drizzle-kit-early",
  });

  return new Promise((resolve, reject) => {
    logger.info(
      `Running drizzle-kit (early-termination): ${drizzleKitBin} ${args.join(" ")}`,
    );

    let proc: ReturnType<typeof utilityProcess.fork>;
    try {
      proc = utilityProcess.fork(drizzleKitBin, args, forkOptions);
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
    let settled = false;
    let idleTimer: NodeJS.Timeout | null = null;
    let exitCode: number | null = null;

    const settle = (
      reason: SpawnDrizzleKitWithEarlyTerminationResult["terminatedReason"],
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(maxTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (reason !== "exit") {
        try {
          proc.kill();
        } catch {
          // best-effort
        }
      }
      resolve({ stdout, stderr, terminatedReason: reason, exitCode });
    };

    const maxTimer = setTimeout(() => settle("timeout"), maxWaitMs);

    const armOrResetIdle = () => {
      if (!idleMs || idleMs <= 0) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => settle("idle"), idleMs);
    };

    proc.stdout?.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      logger.info(`drizzle-kit (early) stdout: ${chunk}`);

      armOrResetIdle();

      if (shouldTerminateEarly && shouldTerminateEarly(stdout)) {
        settle("shouldTerminateEarly");
      }
    });

    proc.stderr?.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      logger.warn(`drizzle-kit (early) stderr: ${chunk}`);
    });

    proc.on("exit", (code) => {
      exitCode = code;
      settle("exit");
    });

    proc.on("error", (type, location, report) => {
      if (settled) return;
      settled = true;
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

// =============================================================================
// IS_TEST_BUILD shims
// =============================================================================

async function mockDrizzleKitRun({
  args,
  cwd,
}: {
  args: string[];
  cwd: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const drizzleCommand = args[0];

  if (drizzleCommand === "introspect") {
    // Find the --config arg and parse the out dir from the file. Fall back to
    // a conventional path under cwd when we cannot read the config.
    const outDir = await resolveOutDirFromConfig({ args, cwd });
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "schema.ts"), "export {};\n", {
      encoding: "utf-8",
    });
    return {
      stdout: "Mock drizzle-kit introspection completed.\n",
      stderr: "",
      exitCode: 0,
    };
  }

  if (drizzleCommand === "generate") {
    // `getInstalledDrizzleKitMajor` returns 1 under IS_TEST_BUILD, so the
    // mock has to emit the v1 layout: each migration is a `<tag>/`
    // directory containing migration.sql + snapshot.json. No journal.
    const outDir = await resolveOutDirFromConfig({ args, cwd });
    await fs.mkdir(outDir, { recursive: true });
    const isBaseline = args.some(
      (a) => a === `--name=${BASELINE_NAME}` || a === BASELINE_NAME,
    );

    // Track the next idx by counting existing migration directories. drizzle-kit
    // numbers each new generate sequentially regardless of prior names.
    let existing: import("node:fs").Dirent[] = [];
    try {
      existing = await fs.readdir(outDir, { withFileTypes: true });
    } catch {
      // outDir was just created; treat as empty.
    }
    const existingTags = existing
      .filter((d) => d.isDirectory() && MIGRATION_NAME_RE.test(d.name))
      .map((d) => d.name);
    const idx = existingTags.length;
    const tag = isBaseline
      ? `${String(idx).padStart(4, "0")}_${BASELINE_NAME}`
      : `${String(idx).padStart(4, "0")}_test_diff`;

    const migrationDir = path.join(outDir, tag);
    await fs.mkdir(migrationDir, { recursive: true });

    // Mirror real drizzle-kit: write a "real" CREATE TABLE for the baseline
    // file. runBaselineGenerate then overwrites it with BASELINE_SQL_BODY.
    // For the diff, write a multi-statement migration so the parser tests
    // exercise the breakpoint splitter.
    await fs.writeFile(
      path.join(migrationDir, "migration.sql"),
      isBaseline
        ? 'CREATE TABLE "mock_baseline" ("id" serial);\n'
        : 'CREATE TABLE "mock" ("id" serial);\n--> statement-breakpoint\nALTER TABLE "mock" ADD COLUMN "name" text;\n',
      "utf-8",
    );
    await fs.writeFile(
      path.join(migrationDir, "snapshot.json"),
      JSON.stringify({}, null, 2),
      "utf-8",
    );

    return {
      stdout: "Mock drizzle-kit generate completed.\n",
      stderr: "",
      exitCode: 0,
    };
  }

  throw new Error(
    `Unsupported drizzle-kit command in test build: ${drizzleCommand}`,
  );
}

async function resolveOutDirFromConfig({
  args,
  cwd,
}: {
  args: string[];
  cwd: string;
}): Promise<string> {
  const configArg = args.find((a) => a.startsWith("--config="));
  if (!configArg) {
    return path.join(cwd, "schema-out");
  }
  const configPath = configArg.slice("--config=".length);
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const match = content.match(/out:\s*"([^"]+)"/);
    if (match) {
      // createDrizzleConfig writes paths relative to workDir (the spawn cwd).
      // Resolve against cwd so callers (and downstream readers like
      // introspectBranch) all see the same absolute path.
      return path.resolve(cwd, match[1]);
    }
  } catch {
    // fall through
  }
  return path.join(cwd, "schema-out");
}

// =============================================================================
// Destructive change detection
// =============================================================================

const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-ntqry=><]/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}

// Matches drizzle-kit's interactive prompts (rename detection during generate,
// any hanji selector).
const PROMPT_MARKER_RE =
  /Are you sure|\(y\/N\)|❯|Yes,\s*I want|Is column\s+|created or renamed/i;

// Idle window after first stdout chunk before we conclude drizzle-kit has
// finished its work. drizzle-kit's pg dialect imports the
// @neondatabase/serverless driver, which leaves a websocket open and
// prevents the Node utility process from emitting 'exit' even when the
// command's work is complete. Idle detection is content-agnostic: it
// doesn't matter what drizzle-kit prints, only that it stops printing.
const GENERATE_IDLE_MS = 3000;

function shouldTerminateOnPromptOnly(cumulativeStdout: string): boolean {
  return PROMPT_MARKER_RE.test(stripAnsi(cumulativeStdout));
}

// Patterns that, if present in drizzle-kit's stderr, indicate the command
// failed even when the process never emitted a clean non-zero exit. The
// idle-settlement path resolves with `exitCode: null` whenever something
// keeps the Node utility process alive past drizzle-kit's own work — e.g.
// esbuild's service subprocess after a transform error, or a websocket
// connection from @neondatabase/serverless. In those cases the existing
// "exit + non-zero code" gate is skipped, so we'd otherwise treat a hard
// failure as a successful no-op generate and tell the user the schemas are
// already in sync. Scanning stderr for these markers turns any such failure
// into a DyadError regardless of how the spawn settled.
const DRIZZLE_KIT_STDERR_FAILURE_PATTERNS: RegExp[] = [
  // Matches `Error:` and any subclass like `TypeError:`, `ReferenceError:`,
  // `SyntaxError:` — drizzle-kit re-throws Node runtime errors verbatim when
  // the introspected schema.ts references an unmapped type (the user's
  // column produces e.g. `unknown is not defined`).
  /^\w*Error:/m,
  /Transform failed/,
  /at failureErrorWithLog/,
];

export function detectDrizzleKitFailureInStderr(stderr: string): string | null {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) return null;
  for (const pattern of DRIZZLE_KIT_STDERR_FAILURE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

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
// Migration file parsing
// =============================================================================

const STATEMENT_BREAKPOINT_RE = /-->\s*statement-breakpoint\s*$/m;

/**
 * Splits a drizzle-kit migration file's SQL on the `--> statement-breakpoint`
 * separator. The marker may sit on its own line OR follow a `;` on the same
 * line (drizzle-kit emits the latter form, e.g. `DROP COLUMN "x";--> statement-breakpoint`).
 * Anchoring to end-of-line keeps the marker inside a SQL string literal from
 * splitting mid-statement, since the literal continues past the marker text
 * with `'...);` and never reaches end-of-line at that position.
 * Strips comment-only chunks.
 */
export function parseDrizzleMigrationFile(sql: string): string[] {
  const cleaned = stripAnsi(sql);
  const pieces = cleaned.split(STATEMENT_BREAKPOINT_RE);
  const out: string[] = [];
  for (const raw of pieces) {
    const trimmed = stripCommentsAndTrim(raw);
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function stripCommentsAndTrim(piece: string): string {
  // Remove leading line-comments and blank lines. We do NOT strip comments
  // inside the body — only the leading whitespace/comments before the first
  // SQL token.
  const lines = piece.split(/\r?\n/);
  const meaningful: string[] = [];
  let started = false;
  for (const line of lines) {
    if (!started) {
      if (line.trim().length === 0) continue;
      if (/^\s*--/.test(line)) continue;
      started = true;
    }
    meaningful.push(line);
  }
  // Trim trailing whitespace and a single trailing semicolon's whitespace.
  return meaningful.join("\n").replace(/\s+$/, "");
}

interface PendingMigration {
  name: string;
  sql: string;
  isBaseline: boolean;
}

// Matches the leading numeric-prefix drizzle-kit uses for migration names in
// both layouts: a run of digits followed by `_<slug>`. v0 uses a 4-digit
// zero-padded index (`0001_<slug>.sql`); v1 uses a 14-digit timestamp
// (`20260524001318_<slug>/`). Both formats sort lexicographically into the
// order drizzle-kit generated them: 4-digit indices sort numerically by
// padding, and timestamps sort chronologically. A permissive `\d+_` matches
// both — anchoring to a specific width would silently drop every v1
// directory and surface as "0 statements" despite a non-empty diff.
const MIGRATION_NAME_RE = /^\d+_/;

/**
 * Reads the drizzle-kit-generated migrations under `<workDir>/drizzle` in
 * deterministic (idx-ordered) order. The `drizzleKitMajor` argument selects
 * the on-disk layout to read:
 *
 *   - 0 (pre-v1): journal at `meta/_journal.json` → `<tag>.sql` files at the
 *     top level. Order is taken from the journal entries.
 *   - 1 (v1+):   per-migration directories `<tag>/` containing
 *     `migration.sql` + `snapshot.json`. Order is the directory names sorted
 *     lexicographically — the `NNNN_` prefix makes that equivalent to idx
 *     ordering.
 *
 * The baseline file is identified by **content equality** to
 * `BASELINE_SQL_BODY`. `runBaselineGenerate` always overwrites the file
 * drizzle-kit produced for the baseline run with this exact constant, so
 * content comparison is unambiguous regardless of whatever filename
 * drizzle-kit chose (it ignores `--name=baseline` on some versions).
 */
export async function readPendingMigrationFiles(
  workDir: string,
  drizzleKitMajor: DrizzleKitMajor,
): Promise<PendingMigration[]> {
  const drizzleDir = path.join(workDir, "drizzle");

  if (drizzleKitMajor === 0) {
    const journalPath = path.join(drizzleDir, "meta", "_journal.json");
    let journal: { entries?: Array<{ idx: number; tag: string }> };
    try {
      journal = JSON.parse(await fs.readFile(journalPath, "utf-8"));
    } catch {
      return [];
    }

    const entries = journal.entries ?? [];
    const out: PendingMigration[] = [];
    for (const entry of entries) {
      const filePath = path.join(drizzleDir, `${entry.tag}.sql`);
      let sql: string;
      try {
        sql = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }
      out.push({
        name: entry.tag,
        sql,
        isBaseline: sql === BASELINE_SQL_BODY,
      });
    }
    return out;
  }

  // v1 layout: each migration is a directory `<tag>/` with migration.sql +
  // snapshot.json. Skip non-matching entries (e.g., stray files left by
  // drizzle-kit) and sort by name so order is deterministic.
  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await fs.readdir(drizzleDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const tags = dirents
    .filter((d) => d.isDirectory() && MIGRATION_NAME_RE.test(d.name))
    .map((d) => d.name)
    .sort();

  const out: PendingMigration[] = [];
  for (const tag of tags) {
    const sqlPath = path.join(drizzleDir, tag, "migration.sql");
    let sql: string;
    try {
      sql = await fs.readFile(sqlPath, "utf-8");
    } catch {
      continue;
    }
    out.push({
      name: tag,
      sql,
      isBaseline: sql === BASELINE_SQL_BODY,
    });
  }
  return out;
}

// =============================================================================
// Prod introspect cache
// =============================================================================

interface IntrospectCacheEntry {
  schemaTs: string;
  // Captured at the time the schema was introspected. A later preview that
  // sees a newer `updated_at` on the same branch must miss the cache —
  // otherwise it would diff against a stale prod snapshot while recording
  // the *current* timestamp on the plan, and the apply-time freshness check
  // would happily wave through SQL generated from a baseline that no longer
  // matches production.
  prodUpdatedAt: string;
  expiresAt: number;
}

const prodIntrospectCache = new Map<string, IntrospectCacheEntry>();

function makeCacheKey(appId: number, prodBranchId: string): string {
  return `${appId}:${prodBranchId}`;
}

export function invalidateProdIntrospectCache({
  appId,
  prodBranchId,
}: {
  appId: number;
  prodBranchId: string;
}): void {
  prodIntrospectCache.delete(makeCacheKey(appId, prodBranchId));
}

// =============================================================================
// Introspect helpers
// =============================================================================

interface IntrospectBranchParams {
  appPath: string;
  workDir: string;
  /** Subdirectory under workDir that drizzle-kit will write the schema.ts to. */
  subDir: string;
  connectionUri: string;
}

/**
 * Runs `drizzle-kit introspect` for a single branch, writing schema.ts (and
 * other introspect outputs) under `<workDir>/<subDir>`. Returns the absolute
 * path to schema.ts.
 */
export async function introspectBranch({
  appPath,
  workDir,
  subDir,
  connectionUri,
}: IntrospectBranchParams): Promise<string> {
  const outDir = path.join(workDir, subDir);
  await fs.mkdir(outDir, { recursive: true });

  const configPath = await createDrizzleConfig({
    workDir,
    configName: `${subDir}.introspect.config.js`,
    outDir,
  });

  const result = await spawnDrizzleKit({
    args: ["introspect", `--config=${configPath}`],
    cwd: workDir,
    appPath,
    connectionUri,
  });

  if (result.exitCode !== 0) {
    throw new DyadError(
      `Schema introspection failed: ${result.stderr || result.stdout}`,
      DyadErrorKind.External,
    );
  }

  let schemaFiles: string[];
  try {
    schemaFiles = await fs.readdir(outDir);
  } catch {
    throw new DyadError(
      "drizzle-kit introspect did not generate output. The database may have an unsupported schema.",
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

  const schemaPath = path.join(outDir, tsSchemaFile);
  // Temporary workaround until drizzle-kit@1.0.0 stable is released:
  // introspect can emit `.default(')` for empty-string defaults, which is
  // syntactically broken and fails the subsequent generate step. Repair the
  // malformed default in-place before handing the file back.
  const original = await fs.readFile(schemaPath, "utf-8");
  const repaired = original.split(".default(')").join(".default('')");
  if (repaired !== original) {
    await fs.writeFile(schemaPath, repaired, "utf-8");
  }

  return schemaPath;
}

/**
 * Introspects prod with a 5-minute in-memory cache keyed by appId+prodBranchId.
 * On a cache hit, writes the cached schema.ts to disk under the work dir
 * without re-running drizzle-kit. The cache is invalidated by every apply
 * attempt (success or failure) — see `invalidateProdIntrospectCache`.
 */
export async function introspectProdWithCache({
  appId,
  prodBranchId,
  prodUpdatedAt,
  appPath,
  workDir,
  prodConnectionUri,
}: {
  appId: number;
  prodBranchId: string;
  /**
   * The branch's `updated_at` captured for *this* preview. The cache is
   * bypassed and re-populated when this differs from the cached entry, so
   * an external schema change during the TTL window can never silently
   * resurface as a stale baseline.
   */
  prodUpdatedAt: string;
  appPath: string;
  workDir: string;
  prodConnectionUri: string;
}): Promise<string> {
  const subDir = "prod-schema-out";
  const outDir = path.join(workDir, subDir);
  const schemaPath = path.join(outDir, "schema.ts");
  const key = makeCacheKey(appId, prodBranchId);

  const cached = prodIntrospectCache.get(key);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.prodUpdatedAt === prodUpdatedAt
  ) {
    logger.info(`Prod introspect cache HIT for ${key}`);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(schemaPath, cached.schemaTs, "utf-8");
    return schemaPath;
  }

  if (cached && cached.prodUpdatedAt !== prodUpdatedAt) {
    logger.info(
      `Prod introspect cache evicted for ${key}: branch advanced ${cached.prodUpdatedAt}→${prodUpdatedAt}`,
    );
    prodIntrospectCache.delete(key);
  }

  logger.info(`Prod introspect cache MISS for ${key}; running introspect.`);
  let resolvedSchemaPath: string;
  try {
    resolvedSchemaPath = await introspectBranch({
      appPath,
      workDir,
      subDir,
      connectionUri: prodConnectionUri,
    });
  } catch (err) {
    prodIntrospectCache.delete(key);
    throw err;
  }

  try {
    const schemaTs = await fs.readFile(resolvedSchemaPath, "utf-8");
    prodIntrospectCache.set(key, {
      schemaTs,
      prodUpdatedAt,
      expiresAt: Date.now() + PROD_INTROSPECT_TTL_MS,
    });
  } catch (err) {
    logger.warn(`Failed to read introspected prod schema for caching: ${err}`);
  }

  return resolvedSchemaPath;
}

// =============================================================================
// drizzle-kit generate (baseline + diff)
// =============================================================================

/**
 * Verifies the on-disk artifacts produced by `drizzle-kit generate` are
 * complete. We can settle the spawn early on idle (drizzle-kit's neon driver
 * / esbuild service can leave handles open that prevent a clean process
 * exit), so we need a separate signal that the work actually finished. A
 * complete set of write-phase artifacts means drizzle-kit got past writing
 * before we killed it; a partial set means we settled too early and the plan
 * would be partial / incorrect.
 *
 * Per-layout completeness rules:
 *   - 0 (pre-v1): journal at `meta/_journal.json` whose every entry has a
 *     matching `<tag>.sql` + `meta/<idx>_snapshot.json`.
 *   - 1 (v1+):    one `<tag>/` directory per migration containing both
 *     `migration.sql` and `snapshot.json`.
 *
 * Returns the number of complete entries (0 means drizzle-kit reported "no
 * schema changes" and never wrote any migration artifacts).
 */
export async function assertGenerateArtifactsComplete(
  drizzleDir: string,
  spawnResult: Pick<
    SpawnDrizzleKitWithEarlyTerminationResult,
    "terminatedReason" | "stderr"
  >,
  drizzleKitMajor: DrizzleKitMajor,
): Promise<number> {
  // Shared "no artifacts but stderr after idle" guard. On a successful
  // generate, drizzle-kit always writes its journal/migration files before
  // going quiet — so seeing idle + stderr + zero artifacts means the command
  // crashed before producing anything; surface it instead of silently
  // returning "already in sync".
  const idleFailureWithoutArtifacts = (): never => {
    throw new DyadError(
      `drizzle-kit generate produced no migration artifacts but emitted stderr before going idle; the command likely failed before writing artifacts: ${spawnResult.stderr.trim()}`,
      DyadErrorKind.External,
    );
  };
  const noArtifactsIdleSuspicious =
    spawnResult.terminatedReason === "idle" &&
    spawnResult.stderr.trim().length > 0;

  if (drizzleKitMajor === 0) {
    const journalPath = path.join(drizzleDir, "meta", "_journal.json");
    let entries: Array<{ idx: number; tag: string }>;
    try {
      const journal = JSON.parse(await fs.readFile(journalPath, "utf-8")) as {
        entries?: Array<{ idx: number; tag: string }>;
      };
      entries = journal.entries ?? [];
    } catch {
      if (noArtifactsIdleSuspicious) idleFailureWithoutArtifacts();
      return 0;
    }

    for (const entry of entries) {
      const sqlPath = path.join(drizzleDir, `${entry.tag}.sql`);
      const snapshotPath = path.join(
        drizzleDir,
        "meta",
        `${String(entry.idx).padStart(4, "0")}_snapshot.json`,
      );
      try {
        await fs.access(sqlPath);
        await fs.access(snapshotPath);
      } catch {
        throw new DyadError(
          `drizzle-kit generate left an incomplete journal: entry ${entry.tag} is missing its SQL or snapshot file. The process likely settled before drizzle-kit finished writing artifacts.`,
          DyadErrorKind.External,
        );
      }
    }

    return entries.length;
  }

  // v1 layout: enumerate migration directories under drizzleDir.
  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await fs.readdir(drizzleDir, { withFileTypes: true });
  } catch {
    if (noArtifactsIdleSuspicious) idleFailureWithoutArtifacts();
    return 0;
  }

  const tags = dirents
    .filter((d) => d.isDirectory() && MIGRATION_NAME_RE.test(d.name))
    .map((d) => d.name)
    .sort();

  if (tags.length === 0) {
    if (noArtifactsIdleSuspicious) idleFailureWithoutArtifacts();
    return 0;
  }

  for (const tag of tags) {
    const sqlPath = path.join(drizzleDir, tag, "migration.sql");
    const snapshotPath = path.join(drizzleDir, tag, "snapshot.json");
    try {
      await fs.access(sqlPath);
      await fs.access(snapshotPath);
    } catch {
      throw new DyadError(
        `drizzle-kit generate left an incomplete migration: directory ${tag} is missing migration.sql or snapshot.json. The process likely settled before drizzle-kit finished writing artifacts.`,
        DyadErrorKind.External,
      );
    }
  }

  return tags.length;
}

/**
 * Runs `drizzle-kit generate --name=baseline` against an introspected prod
 * schema, then overwrites the produced baseline SQL file with a constant
 * comment so applying it is a no-op. The snapshot is left untouched — that
 * is the authoritative anchor for the next diff.
 *
 * drizzle-kit doesn't always honor --name=baseline (it falls back to a
 * random adjective+noun on some versions), so we look up the file path via
 * the journal's first entry rather than hardcoding it. Returns whether
 * drizzle-kit produced a journal entry at all (false for an empty prod
 * schema → "no schema changes").
 */
export async function runBaselineGenerate({
  workDir,
  appPath,
  prodSchemaPath,
  prodConnectionUri,
  drizzleKitMajor,
}: {
  workDir: string;
  appPath: string;
  prodSchemaPath: string;
  prodConnectionUri: string;
  drizzleKitMajor: DrizzleKitMajor;
}): Promise<{ baselineProduced: boolean }> {
  const drizzleDir = path.join(workDir, "drizzle");
  await fs.mkdir(drizzleDir, { recursive: true });

  const configPath = await createDrizzleConfig({
    workDir,
    configName: "bootstrap.config.js",
    outDir: drizzleDir,
    schemaPath: prodSchemaPath,
  });

  const result = await spawnDrizzleKitWithEarlyTermination({
    args: ["generate", `--config=${configPath}`, `--name=${BASELINE_NAME}`],
    cwd: workDir,
    appPath,
    connectionUri: prodConnectionUri,
    idleMs: GENERATE_IDLE_MS,
    shouldTerminateEarly: shouldTerminateOnPromptOnly,
  });

  if (result.terminatedReason === "shouldTerminateEarly") {
    throw new DyadError(
      "drizzle-kit prompted during baseline generation. The prod schema may have ambiguous renames; please resolve them manually.",
      DyadErrorKind.External,
    );
  }
  if (result.terminatedReason === "timeout") {
    throw new DyadError(
      "Baseline generation timed out. drizzle-kit produced no output for 2 minutes.",
      DyadErrorKind.External,
    );
  }
  if (
    result.terminatedReason === "exit" &&
    result.exitCode !== null &&
    result.exitCode !== 0
  ) {
    throw new DyadError(
      `drizzle-kit baseline generation failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || "no output"}`,
      DyadErrorKind.External,
    );
  }

  // Stderr-pattern check runs regardless of how the spawn settled. The
  // exit-code gate above only fires for clean non-zero exits, but a hung
  // child that we kill via idle/timeout resolves with `exitCode: null` —
  // any failure printed to stderr would otherwise be silently dropped.
  const baselineStderrFailure = detectDrizzleKitFailureInStderr(result.stderr);
  if (baselineStderrFailure) {
    throw new DyadError(
      `drizzle-kit baseline generation reported an error on stderr: ${baselineStderrFailure}`,
      DyadErrorKind.External,
    );
  }

  // Verify drizzle-kit finished writing its artifacts before we settled.
  // Idle-termination is a best-effort signal (the neon driver / esbuild
  // service can keep handles open after work completes), so artifacts with
  // missing files mean we killed the process mid-write and the plan would
  // be partial.
  const completeEntryCount = await assertGenerateArtifactsComplete(
    drizzleDir,
    result,
    drizzleKitMajor,
  );
  if (completeEntryCount === 0) {
    // drizzle-kit said "no schema changes" (empty prod). No baseline file
    // to neutralize; the next diff-generate will start fresh.
    return { baselineProduced: false };
  }

  // Locate the baseline file. drizzle-kit names it randomly on some
  // versions even with --name=baseline, so we can't hardcode a path. In
  // both layouts the first generated migration's name has the leading
  // `0000_` prefix, so we sort the discovered names and take the first.
  const baselineSqlPath = await locateBaselineSqlPath(
    drizzleDir,
    drizzleKitMajor,
  );
  if (!baselineSqlPath) {
    return { baselineProduced: false };
  }

  // Overwrite the baseline SQL with the constant no-op comment so it parses
  // to zero statements in `parseDrizzleMigrationFile` and never contributes
  // to the apply plan; the snapshot beside it is the real anchor for the
  // next diff.
  await fs.writeFile(baselineSqlPath, BASELINE_SQL_BODY, "utf-8");

  return { baselineProduced: true };
}

async function locateBaselineSqlPath(
  drizzleDir: string,
  drizzleKitMajor: DrizzleKitMajor,
): Promise<string | null> {
  if (drizzleKitMajor === 0) {
    const journalPath = path.join(drizzleDir, "meta", "_journal.json");
    let journal: { entries?: Array<{ idx: number; tag: string }> };
    try {
      journal = JSON.parse(await fs.readFile(journalPath, "utf-8"));
    } catch {
      return null;
    }
    const firstEntry = journal.entries?.[0];
    if (!firstEntry) return null;
    return path.join(drizzleDir, `${firstEntry.tag}.sql`);
  }

  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await fs.readdir(drizzleDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const tags = dirents
    .filter((d) => d.isDirectory() && MIGRATION_NAME_RE.test(d.name))
    .map((d) => d.name)
    .sort();
  if (tags.length === 0) return null;
  return path.join(drizzleDir, tags[0], "migration.sql");
}

/**
 * Runs `drizzle-kit generate` against the dev-introspected schema. If dev
 * differs from prod (the previously-written baseline snapshot), drizzle-kit
 * writes a 000N_<random>.sql file. If schemas match, no new file is written.
 */
export async function runDiffGenerate({
  workDir,
  appPath,
  devSchemaPath,
  devConnectionUri,
  drizzleKitMajor,
}: {
  workDir: string;
  appPath: string;
  devSchemaPath: string;
  devConnectionUri: string;
  drizzleKitMajor: DrizzleKitMajor;
}): Promise<void> {
  const drizzleDir = path.join(workDir, "drizzle");
  const configPath = await createDrizzleConfig({
    workDir,
    configName: "generate.config.js",
    outDir: drizzleDir,
    schemaPath: devSchemaPath,
  });

  const result = await spawnDrizzleKitWithEarlyTermination({
    args: ["generate", `--config=${configPath}`],
    cwd: workDir,
    appPath,
    connectionUri: devConnectionUri,
    idleMs: GENERATE_IDLE_MS,
    shouldTerminateEarly: shouldTerminateOnPromptOnly,
  });

  if (result.terminatedReason === "shouldTerminateEarly") {
    throw new DyadError(
      "drizzle-kit prompted for a column rename. Drop and re-add the column instead, or run drizzle-kit generate manually.",
      DyadErrorKind.External,
    );
  }
  if (result.terminatedReason === "timeout") {
    throw new DyadError(
      "Migration plan generation timed out.",
      DyadErrorKind.External,
    );
  }
  if (
    result.terminatedReason === "exit" &&
    result.exitCode !== null &&
    result.exitCode !== 0
  ) {
    throw new DyadError(
      `drizzle-kit migration plan generation failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || "no output"}`,
      DyadErrorKind.External,
    );
  }

  // Catch failures the exit-code gate misses: when something keeps the
  // process alive past drizzle-kit's own work (esbuild's service after a
  // Transform error, neon driver websocket, etc.) the spawn settles via
  // idle with `exitCode: null`. Without this scan, an esbuild Transform
  // error on the introspected dev schema flows through as a clean run with
  // an empty journal — and the user is told their schemas are already in
  // sync even though the diff never executed.
  const diffStderrFailure = detectDrizzleKitFailureInStderr(result.stderr);
  if (diffStderrFailure) {
    throw new DyadError(
      `drizzle-kit migration plan generation reported an error on stderr: ${diffStderrFailure}`,
      DyadErrorKind.External,
    );
  }

  // Same idle-termination guard as the baseline run: verify every migration
  // artifact is on disk before letting the caller read the pending
  // migrations.
  await assertGenerateArtifactsComplete(drizzleDir, result, drizzleKitMajor);
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
  appPath: string;
  workDir: string;
  drizzleKitMajor: DrizzleKitMajor;
}

export async function prepareMigrationContext({
  appId,
}: {
  appId: number;
}): Promise<MigrationContext> {
  // 1. Resolve branches
  const { appData, branchId: devBranchId } = await getAppWithNeonBranch(appId);
  const projectId = appData.neonProjectId!;
  const { branchId: prodBranchId, updatedAt: prodUpdatedAt } =
    await getProductionBranchId(projectId);

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
  const depsAlreadyInstalled = await areMigrationDepsInstalled(appPath);
  if (!depsAlreadyInstalled) {
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

  // 5. Detect installed drizzle-kit major to pick the right on-disk migration
  // layout downstream. Run after the install step so we read whichever
  // version is now on disk (either user-pinned existing copy or the v1 RC we
  // just installed).
  const drizzleKitMajor = await getInstalledDrizzleKitMajor(appPath);
  logger.info(
    `Detected drizzle-kit major ${drizzleKitMajor} in ${appPath} (${depsAlreadyInstalled ? "pre-existing" : "freshly installed"})`,
  );

  // 6. Work directory — preview always starts from a clean slate. The
  // migrate handler does not call prepareMigrationContext; it consumes the
  // SQL plan from the in-memory plan store instead.
  const workDir = getMigrationWorkDir(appId);
  await ensureFreshWorkDir(workDir);

  return {
    projectId,
    devBranchId,
    prodBranchId,
    prodUpdatedAt,
    devUri,
    prodUri,
    appPath,
    workDir,
    drizzleKitMajor,
  };
}
