import log from "electron-log";
import { utilityProcess } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { readEffectiveSettings } from "@/main/settings";
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
