import { ipcMain } from "electron";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { getDyadAppPath } from "../../paths/paths";

const logger = log.scope("sui_handlers");
const handle = createLoggedHandler(logger);

export interface SuiCompileParams {
  appPath: string;
}

export interface SuiCompileResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface SuiDeployParams {
  appPath: string;
  gasAddress?: string;
  gasBudget?: number;
}

export interface SuiDeployResult {
  success: boolean;
  packageId?: string;
  transactionDigest?: string;
  output: string;
  error?: string;
}

function formatDeployOutput(
  packageId: string | undefined,
  transactionDigest: string | undefined,
  rawOutput: string
): string {
  let output = "✓ Deployment successful!\n\n";

  if (packageId) {
    output += `Package ID: ${packageId}\n`;
  }

  if (transactionDigest) {
    output += `Transaction Digest: ${transactionDigest}\n`;
  }

  if (!packageId && !transactionDigest) {
    output += "Raw output:\n" + rawOutput;
  }

  return output;
}

/**
 * Ensure Move.toml exists in the contract directory
 */
function ensureMoveToml(contractPath: string, packageName: string): void {
  const moveTomlPath = path.join(contractPath, "Move.toml");
  const sourcesPath = path.join(contractPath, "sources");

  // Create sources directory if it doesn't exist
  if (!fs.existsSync(sourcesPath)) {
    fs.mkdirSync(sourcesPath, { recursive: true });
  }

  // Move any .move files to sources/ directory
  const files = fs.readdirSync(contractPath);
  for (const file of files) {
    if (file.endsWith(".move")) {
      const oldPath = path.join(contractPath, file);
      const newPath = path.join(sourcesPath, file);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(oldPath, newPath);
        logger.info(`Moved ${file} to sources/ directory`);
      }
    }
  }

  // Create Move.toml if it doesn't exist
  if (!fs.existsSync(moveTomlPath)) {
    const tomlContent = `[package]
name = "${packageName}"
version = "0.0.1"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.55.0" }

[addresses]
${packageName} = "0x0"
`;
    fs.writeFileSync(moveTomlPath, tomlContent);
    logger.info(`Created Move.toml at ${moveTomlPath}`);
  }
}

export function registerSuiHandlers() {
  /**
   * Compile a Move package using sui move build
   */
  handle(
    "sui-compile",
    async (_, params: SuiCompileParams): Promise<SuiCompileResult> => {
      const appPath = getDyadAppPath(params.appPath);
      // Look for Move.toml in src/erc20_token or other contract directories
      const movePath = path.join(appPath, "src", "erc20_token");
      logger.info(`Compiling Move package at: ${movePath}`);

      // Ensure Move.toml exists before compiling
      try {
        ensureMoveToml(movePath, "erc20_token");
      } catch (err) {
        logger.error("Failed to setup Move package:", err);
        return {
          success: false,
          output: "Failed to setup Move package structure",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Clean build directory to avoid cached artifacts causing conflicts
      const buildPath = path.join(movePath, "build");
      if (fs.existsSync(buildPath)) {
        try {
          fs.rmSync(buildPath, { recursive: true, force: true });
          logger.info(`Cleaned build directory at ${buildPath}`);
        } catch (err) {
          logger.warn("Failed to clean build directory:", err);
        }
      }

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        const suiProcess = spawn("sui", ["move", "build", "--dump-bytecode-as-base64"], {
          cwd: movePath,
          shell: true,
        });

        suiProcess.stdout.on("data", (data) => {
          const output = data.toString();
          stdout += output;
          logger.info(`[sui build stdout]: ${output}`);
        });

        suiProcess.stderr.on("data", (data) => {
          const output = data.toString();
          stderr += output;
          logger.warn(`[sui build stderr]: ${output}`);
        });

        suiProcess.on("close", (code) => {
          if (code === 0) {
            logger.info("Move compilation successful");
            resolve({
              success: true,
              output: stdout || "Compilation successful! Move modules built.",
            });
          } else {
            logger.error(`Move compilation failed with code ${code}`);
            resolve({
              success: false,
              output: stderr || stdout || "Compilation failed",
              error: stderr || `Process exited with code ${code}`,
            });
          }
        });

        suiProcess.on("error", (err) => {
          logger.error("Failed to start sui process:", err);
          resolve({
            success: false,
            output: "Failed to start sui CLI. Make sure sui is installed and in PATH.",
            error: err.message,
          });
        });
      });
    }
  );

  /**
   * Deploy a compiled Move package to Sui network
   */
  handle(
    "sui-deploy",
    async (_, params: SuiDeployParams): Promise<SuiDeployResult> => {
      const { appPath, gasAddress, gasBudget = 100000000 } = params;
      const fullPath = getDyadAppPath(appPath);
      logger.info(`Deploying Move package at: ${fullPath}`);

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        const args = ["client", "publish", "--json"];

        /// @note no need to pass this anymore with sui cli v 1.61
        // if (gasAddress) {
        //   args.push("--gas", gasAddress);
        // }

        args.push("--gas-budget", gasBudget.toString());

        logger.log(`FULL command: sui ${args.join(" ")}`)

        const suiProcess = spawn("sui", args, {
          cwd: fullPath,
          shell: true,
        });

        suiProcess.stdout.on("data", (data) => {
          const output = data.toString();
          stdout += output;
          logger.info(`[sui publish stdout]: ${output}`);
        });

        suiProcess.stderr.on("data", (data) => {
          const output = data.toString();
          stderr += output;
          logger.warn(`[sui publish stderr]: ${output}`);
        });

        suiProcess.on("close", (code) => {
          if (code === 0) {
            logger.info("Move package deployed successfully");

            // Try to parse JSON output to extract package ID and transaction digest
            let packageId: string | undefined;
            let transactionDigest: string | undefined;

            try {
              const jsonOutput = JSON.parse(stdout);
              transactionDigest = jsonOutput.digest;

              // Extract package ID from created objects
              const createdObjects = jsonOutput.objectChanges?.filter(
                (obj: any) => obj.type === "published"
              );
              if (createdObjects && createdObjects.length > 0) {
                packageId = createdObjects[0].packageId;
              }
            } catch (e) {
              logger.warn("Could not parse JSON output from sui publish");
            }

            resolve({
              success: true,
              packageId,
              transactionDigest,
              output: formatDeployOutput(packageId, transactionDigest, stdout),
            });
          } else {
            logger.error(`Move deployment failed with code ${code}`);
            resolve({
              success: false,
              output: stderr || stdout || "Deployment failed",
              error: stderr || `Process exited with code ${code}`,
            });
          }
        });

        suiProcess.on("error", (err) => {
          logger.error("Failed to start sui process:", err);
          resolve({
            success: false,
            output: "Failed to start sui CLI. Make sure sui is installed and in PATH.",
            error: err.message,
          });
        });
      });
    }
  );

  /**
   * Get Sui active address (for gas payment)
   */
  handle(
    "sui-get-address",
    async (): Promise<{ address: string | null }> => {
      return new Promise((resolve) => {
        let stdout = "";

        const suiProcess = spawn("sui", ["client", "active-address"], {
          shell: true,
        });

        suiProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        suiProcess.on("close", (code) => {
          if (code === 0) {
            const address = stdout.trim();
            resolve({ address });
          } else {
            resolve({ address: null });
          }
        });

        suiProcess.on("error", () => {
          resolve({ address: null });
        });
      });
    }
  );
}
