import log from "electron-log";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "child_process";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "../utils/test_utils";

export const logger = log.scope("migration_handlers");

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
 * Resolves the path to the drizzle-kit bin.cjs file.
 */
export function getDrizzleKitPath(): string {
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
  out: "${outDir}",
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
 * Spawns drizzle-kit as a child process via system node.
 */
export async function spawnDrizzleKit({
  args,
  cwd,
  connectionUri,
  timeoutMs = 120_000,
}: {
  args: string[];
  cwd: string;
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
  }

  const drizzleKitBin = getDrizzleKitPath();

  return new Promise((resolve, reject) => {
    logger.info(`Running: node ${drizzleKitBin} ${args.join(" ")}`);

    // Set NODE_PATH so that schema files in the temp dir can resolve
    // drizzle-orm and other dependencies.
    // In packaged builds, node_modules lives inside app.asar which spawned
    // node processes cannot read. drizzle-orm is copied to resources/ via
    // extraResource in forge.config.ts, so we point NODE_PATH there instead.
    const nodeModulesPath = app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), "node_modules");
    const proc = spawn("node", [drizzleKitBin, ...args], {
      cwd,
      stdio: "pipe",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_PATH: nodeModulesPath,
        DRIZZLE_DATABASE_URL: connectionUri,
      },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutError: DyadError | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutError = new DyadError(
        `drizzle-kit timed out after ${timeoutMs}ms. The database endpoint may be suspended or unreachable.`,
        DyadErrorKind.External,
      );
      proc.kill();
      forceKillTimer = setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5_000);
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
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (timedOut && timeoutError) {
        reject(timeoutError);
        return;
      }
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
