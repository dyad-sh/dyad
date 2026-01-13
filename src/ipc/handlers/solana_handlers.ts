import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { getDyadAppPath } from "../../paths/paths";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { runShellCommand } from "../utils/runShellCommand";

const logger = log.scope("solana_handlers");
const handle = createLoggedHandler(logger);

/**
 * Strip ANSI color codes from string
 */
function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Parse and format Anchor/Rust compiler errors
 */
function formatCompilerErrors(rawOutput: string, truncate = true): string {
  const cleanOutput = stripAnsiCodes(rawOutput);
  const lines = cleanOutput.split("\n");

  interface CompileIssue {
    type: "error" | "warning";
    message: string;
    location?: string;
    code?: string;
  }

  const issues: CompileIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match Rust error/warning pattern: error[E0xxx]: message
    const errorMatch = line.match(/error(?:\[([^\]]+)\])?: (.+)/);
    const warningMatch = line.match(/warning(?:\[([^\]]+)\])?: (.+)/);

    if (errorMatch || warningMatch) {
      const isError = !!errorMatch;
      const match = (isError ? errorMatch : warningMatch)!;

      issues.push({
        type: isError ? "error" : "warning",
        code: match[1],
        message: match[2],
      });

      // Try to find location in next few lines
      for (let j = i + 1; j < i + 5 && j < lines.length; j++) {
        const locMatch = lines[j].match(/-->\s*(.+):(\d+):(\d+)/);
        if (locMatch) {
          issues[issues.length - 1].location = `${locMatch[1]}:${locMatch[2]}`;
          break;
        }
      }
    }
  }

  if (issues.length === 0) {
    // No structured errors, return cleaned output
    const hasError = cleanOutput.toLowerCase().includes("error");
    if (hasError) {
      return "❌ Compilation failed:\n\n" + cleanOutput;
    }
    return cleanOutput;
  }

  const errors = issues.filter((i) => i.type === "error");
  const warnings = issues.filter((i) => i.type === "warning");

  let output = "";

  if (errors.length > 0) {
    output += `❌ ${errors.length} Compilation Error${errors.length > 1 ? "s" : ""}:\n\n`;
    const errorsToShow = truncate ? errors.slice(0, 5) : errors;

    errorsToShow.forEach((err, idx) => {
      output += `${idx + 1}. ${err.message}`;
      if (err.code) output += ` [${err.code}]`;
      if (err.location) output += `\n   Location: ${err.location}`;
      output += "\n\n";
    });

    if (truncate && errors.length > 5) {
      output += `... and ${errors.length - 5} more error${errors.length - 5 > 1 ? "s" : ""}\n`;
    }
  }

  if (warnings.length > 0) {
    if (output) output += "\n";
    output += `⚠️  ${warnings.length} Warning${warnings.length > 1 ? "s" : ""}\n`;
  }

  return output.trim();
}

export interface SolanaVersionResult {
  anchorVersion: string | null;
}

export interface SolanaCompileParams {
  appPath: string;
}

export interface SolanaCompileResult {
  success: boolean;
  output: string;
  error?: string;
  fullError?: string;
}

export interface SolanaDeployParams {
  appPath: string;
  network?: "localnet" | "devnet" | "testnet" | "mainnet-beta";
}

export interface SolanaDeployResult {
  success: boolean;
  programId?: string;
  transactionSignature?: string;
  output: string;
  error?: string;
}

export interface SolanaTestParams {
  appPath: string;
}

export interface SolanaTestResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Ensure Anchor project structure exists
 */
function ensureAnchorStructure(projectPath: string, programName: string): void {
  const anchorTomlPath = path.join(projectPath, "Anchor.toml");
  const programsPath = path.join(projectPath, "programs");
  const programPath = path.join(programsPath, programName);

  // Create programs directory if it doesn't exist
  if (!fs.existsSync(programsPath)) {
    fs.mkdirSync(programsPath, { recursive: true });
  }

  // Create Anchor.toml if it doesn't exist
  if (!fs.existsSync(anchorTomlPath)) {
    const tomlContent = `[toolchain]

[features]
seeds = false
skip-lint = false

[programs.localnet]
${programName} = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
`;
    fs.writeFileSync(anchorTomlPath, tomlContent);
    logger.info(`Created Anchor.toml at ${anchorTomlPath}`);
  }

  // Move any .rs files to programs/<program_name>/src/
  const srcFiles = fs.existsSync(path.join(projectPath, "src"))
    ? fs.readdirSync(path.join(projectPath, "src"))
    : [];

  for (const file of srcFiles) {
    if (file.endsWith(".rs")) {
      const oldPath = path.join(projectPath, "src", file);
      const newDir = path.join(programPath, "src");

      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      const newPath = path.join(newDir, file);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(oldPath, newPath);
        logger.info(`Moved ${file} to programs/${programName}/src/`);
      }
    }
  }
}

export function registerSolanaHandlers() {
  /**
   * Check Solana CLI version
   */
  handle("solana-version", async (): Promise<SolanaVersionResult> => {
    logger.info("IPC: solana-version called");
    let anchorVersion: string | null = null;
    try {
      anchorVersion = await runShellCommand(`anchor --version`);
    } catch (err) {
      console.error("Failed to get Solana CLI version:", err);
    }
    return {
      anchorVersion,
    };
  });

  /**
   * Compile an Anchor program using anchor build
   */
  handle(
    "solana-compile",
    async (_, params: SolanaCompileParams): Promise<SolanaCompileResult> => {
      const appPath = getDyadAppPath(params.appPath);
      const anchorPath = appPath;

      if (!anchorPath) {
        return {
          success: false,
          output: "No Anchor project found in src/ directory",
          error: "Could not find a directory with Anchor.toml",
        };
      }

      const programName = path.basename(anchorPath);
      logger.info(
        `Compiling Anchor program at: ${anchorPath} (${programName})`,
      );

      // Ensure Anchor structure
      try {
        ensureAnchorStructure(anchorPath, programName);
      } catch (err) {
        logger.error("Failed to setup Anchor project:", err);
        return {
          success: false,
          output: "Failed to setup Anchor project structure",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        const anchorProcess = spawn("anchor", ["build"], {
          cwd: anchorPath,
          shell: true,
        });

        anchorProcess.stdout.on("data", (data) => {
          const output = data.toString();
          stdout += output;
          logger.info(`[anchor build stdout]: ${output}`);
        });

        anchorProcess.stderr.on("data", (data) => {
          const output = data.toString();
          stderr += output;
          logger.warn(`[anchor build stderr]: ${output}`);
        });

        anchorProcess.on("close", (code) => {
          if (code === 0) {
            logger.info("Anchor compilation successful");
            resolve({
              success: true,
              output: "✅ Compilation successful! Anchor program built.",
            });
          } else {
            logger.error(`Anchor compilation failed with code ${code}`);
            const combinedOutput = [stderr, stdout]
              .filter((s) => s.trim())
              .join("\n\n");
            const rawErrorOutput = combinedOutput || "Compilation failed";

            const formattedErrorsTruncated = formatCompilerErrors(
              rawErrorOutput,
              true,
            );
            const formattedErrorsFull = formatCompilerErrors(
              rawErrorOutput,
              false,
            );

            resolve({
              success: false,
              output: formattedErrorsTruncated,
              fullError: formattedErrorsFull,
              error: stripAnsiCodes(rawErrorOutput),
            });
          }
        });

        anchorProcess.on("error", (err) => {
          logger.error("Failed to start anchor process:", err);
          resolve({
            success: false,
            output:
              "Failed to start Anchor CLI. Make sure Anchor is installed and in PATH.\n\nInstall: https://www.anchor-lang.com/docs/installation",
            error: err.message,
          });
        });
      });
    },
  );

  /**
   * Deploy an Anchor program
   */
  handle(
    "solana-deploy",
    async (_, params: SolanaDeployParams): Promise<SolanaDeployResult> => {
      const { appPath, network = "devnet" } = params;
      const fullPath = getDyadAppPath(appPath);
      const anchorPath = fullPath;

      if (!anchorPath) {
        return {
          success: false,
          output: "No Anchor project found in src/ directory",
          error: "Could not find a directory with Anchor.toml",
        };
      }

      const programName = path.basename(anchorPath);
      logger.info(
        `Deploying Anchor program at: ${anchorPath} (${programName})`,
      );

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        // Build deploy command with network provider
        const args = ["deploy"];

        // Set network via provider flag
        if (network !== "localnet") {
          args.push("--provider.cluster", network);
        }

        logger.info(`Running: anchor ${args.join(" ")}`);

        const anchorProcess = spawn("anchor", args, {
          cwd: anchorPath,
          shell: true,
        });

        anchorProcess.stdout.on("data", (data) => {
          const output = data.toString();
          stdout += output;
          logger.info(`[anchor deploy stdout]: ${output}`);
        });

        anchorProcess.stderr.on("data", (data) => {
          const output = data.toString();
          stderr += output;
          logger.warn(`[anchor deploy stderr]: ${output}`);
        });

        anchorProcess.on("close", (code) => {
          if (code === 0) {
            logger.info("Anchor program deployed successfully");

            // Extract program ID from output
            let programId: string | undefined;
            const programIdMatch = stdout.match(/Program Id: ([A-Za-z0-9]+)/);
            if (programIdMatch) {
              programId = programIdMatch[1];
            }

            let output = "✓ Deployment successful!\n\n";
            if (programId) {
              output += `Program ID: ${programId}\n`;
              output += `Network: ${network}\n\n`;

              // Add explorer link
              if (network === "devnet") {
                output += `View on Solana Explorer (devnet):\nhttps://explorer.solana.com/address/${programId}?cluster=devnet`;
              } else if (network === "testnet") {
                output += `View on Solana Explorer (testnet):\nhttps://explorer.solana.com/address/${programId}?cluster=testnet`;
              } else if (network === "mainnet-beta") {
                output += `View on Solana Explorer:\nhttps://explorer.solana.com/address/${programId}`;
              }
            } else {
              output += stdout;
            }

            resolve({
              success: true,
              programId,
              output,
            });
          } else {
            logger.error(`Anchor deployment failed with code ${code}`);

            let errorMessage = stderr || stdout || "Deployment failed";

            // Check for common errors
            if (
              errorMessage.includes("Insufficient funds") ||
              errorMessage.includes("insufficient")
            ) {
              errorMessage =
                "❌ Deployment failed: Insufficient SOL for deployment.\n\n" +
                "To get devnet SOL tokens:\n" +
                "1. Run: solana airdrop 2\n" +
                "2. Or visit: https://solfaucet.com\n\n" +
                "Original error:\n" +
                errorMessage;
            } else if (errorMessage.includes("No wallet configured")) {
              errorMessage =
                "❌ Deployment failed: No Solana wallet configured.\n\n" +
                "Please configure Solana CLI:\n" +
                "1. Run: solana-keygen new\n" +
                "2. Or set existing wallet: solana config set --keypair <path>\n\n" +
                "Original error:\n" +
                errorMessage;
            }

            resolve({
              success: false,
              output: errorMessage,
              error: stderr || `Process exited with code ${code}`,
            });
          }
        });

        anchorProcess.on("error", (err) => {
          logger.error("Failed to start anchor process:", err);
          resolve({
            success: false,
            output:
              "Failed to start Anchor CLI. Make sure Anchor is installed and in PATH.",
            error: err.message,
          });
        });
      });
    },
  );

  /**
   * Run tests for an Anchor program
   */
  handle(
    "solana-test",
    async (_, params: SolanaTestParams): Promise<SolanaTestResult> => {
      const appPath = getDyadAppPath(params.appPath);
      const anchorPath = appPath;

      if (!anchorPath) {
        return {
          success: false,
          output: "No Anchor project found in src/ directory",
          error: "Could not find a directory with Anchor.toml",
        };
      }

      const programName = path.basename(anchorPath);
      logger.info(
        `Running tests for Anchor program at: ${anchorPath} (${programName})`,
      );

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        const anchorProcess = spawn("anchor", ["test"], {
          cwd: anchorPath,
          shell: true,
        });

        anchorProcess.stdout.on("data", (data) => {
          const output = data.toString();
          stdout += output;
          logger.info(`[anchor test stdout]: ${output}`);
        });

        anchorProcess.stderr.on("data", (data) => {
          const output = data.toString();
          stderr += output;
          logger.warn(`[anchor test stderr]: ${output}`);
        });

        anchorProcess.on("close", (code) => {
          if (code === 0) {
            logger.info("Anchor tests completed successfully");
            const cleanOutput = stripAnsiCodes(stdout);
            resolve({
              success: true,
              output: "✅ Tests passed!\n\n" + cleanOutput,
            });
          } else {
            logger.error(`Anchor tests failed with code ${code}`);
            const combinedOutput = [stderr, stdout]
              .filter((s) => s.trim())
              .join("\n\n");
            const cleanOutput = stripAnsiCodes(
              combinedOutput || "Tests failed",
            );
            resolve({
              success: false,
              output: "❌ Tests failed:\n\n" + cleanOutput,
              error: cleanOutput,
            });
          }
        });

        anchorProcess.on("error", (err) => {
          logger.error("Failed to start anchor test process:", err);
          resolve({
            success: false,
            output:
              "Failed to start Anchor CLI. Make sure Anchor is installed and in PATH.",
            error: err.message,
          });
        });
      });
    },
  );

  /**
   * Get Solana wallet address
   */
  handle(
    "solana-get-address",
    async (): Promise<{ address: string | null }> => {
      return new Promise((resolve) => {
        let stdout = "";

        const solanaProcess = spawn("solana", ["address"], {
          shell: true,
        });

        solanaProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        solanaProcess.on("close", (code) => {
          if (code === 0) {
            const address = stdout.trim();
            resolve({ address });
          } else {
            resolve({ address: null });
          }
        });

        solanaProcess.on("error", () => {
          resolve({ address: null });
        });
      });
    },
  );

  /**
   * Get Solana balance
   */
  handle(
    "solana-get-balance",
    async (): Promise<{
      balance: string | null;
      formattedBalance: string | null;
    }> => {
      return new Promise((resolve) => {
        let stdout = "";

        logger.info("Fetching Solana balance...");
        const solanaProcess = spawn("solana", ["balance"], {
          shell: true,
        });

        solanaProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        solanaProcess.on("close", (code) => {
          if (code === 0 && stdout.trim()) {
            try {
              // Output format: "0.5 SOL" or "500000000 lamports"
              const balanceMatch = stdout.match(/([\d.]+)\s*SOL/);
              if (balanceMatch) {
                const balanceInSol = balanceMatch[1];
                const balanceInLamports = (
                  parseFloat(balanceInSol) * 1_000_000_000
                ).toString();

                logger.info(`Balance: ${balanceInSol} SOL`);
                resolve({
                  balance: balanceInLamports,
                  formattedBalance: balanceInSol,
                });
              } else {
                resolve({ balance: null, formattedBalance: null });
              }
            } catch (e) {
              logger.error("Failed to parse balance:", e);
              resolve({ balance: null, formattedBalance: null });
            }
          } else {
            logger.warn(
              `Failed to get balance. Code: ${code}, stdout: ${stdout}`,
            );
            resolve({ balance: null, formattedBalance: null });
          }
        });

        solanaProcess.on("error", (err) => {
          logger.error("Failed to execute solana balance:", err);
          resolve({ balance: null, formattedBalance: null });
        });
      });
    },
  );

  /**
   * Initialize a new Anchor project
   */
  handle(
    "solana-init-project",
    async (
      _,
      params: {
        projectName: string;
        parentPath: string;
        nlPrompt?: string;
        generationMetadata?: {
          model: string;
          generationTime: number;
          phasesCompleted: { document: boolean; plan: boolean; act: boolean };
          createdAt: string;
          targetBlockchain: string;
          promptLength: number;
        };
      },
    ): Promise<{
      success: boolean;
      output: string;
      error?: string;
      appId?: number;
    }> => {
      const { projectName, parentPath, nlPrompt, generationMetadata } = params;
      const fullParentPath = getDyadAppPath(parentPath);

      logger.info(
        `Initializing Anchor project: ${projectName} in ${fullParentPath}`,
      );

      // Ensure parent directory exists
      if (!fs.existsSync(fullParentPath)) {
        fs.mkdirSync(fullParentPath, { recursive: true });
      }

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        const anchorProcess = spawn("anchor", ["init", projectName], {
          cwd: fullParentPath,
          shell: true,
        });

        anchorProcess.stdout.on("data", (data) => {
          const output = data.toString();
          stdout += output;
          logger.info(`[anchor init stdout]: ${output}`);
        });

        anchorProcess.stderr.on("data", (data) => {
          const output = data.toString();
          stderr += output;
          logger.warn(`[anchor init stderr]: ${output}`);
        });

        anchorProcess.on("close", async (code) => {
          if (code === 0) {
            logger.info("Anchor project initialized successfully");

            const projectPath = path.join(parentPath, projectName);
            const fullProjectPath = path.join(fullParentPath, projectName);

            // Create an initial git commit so Dyad's version control works
            try {
              logger.info("Creating initial git commit for Anchor project");

              // Stage all files
              const gitAdd = spawn("git", ["add", "."], {
                cwd: fullProjectPath,
              });

              await new Promise<void>((resolveGit) => {
                let gitAddStderr = "";

                gitAdd.stderr?.on("data", (data) => {
                  gitAddStderr += data.toString();
                });

                gitAdd.on("close", (addCode) => {
                  if (addCode === 0) {
                    logger.info("Git add successful");

                    // Create initial commit using local git config
                    const gitCommit = spawn(
                      "git",
                      ["commit", "-m", "Initial Anchor project scaffold"],
                      {
                        cwd: fullProjectPath,
                      },
                    );

                    let gitCommitStderr = "";
                    let gitCommitStdout = "";

                    gitCommit.stdout?.on("data", (data) => {
                      gitCommitStdout += data.toString();
                    });

                    gitCommit.stderr?.on("data", (data) => {
                      gitCommitStderr += data.toString();
                    });

                    gitCommit.on("close", (commitCode) => {
                      if (commitCode === 0) {
                        logger.info("Initial commit created successfully");
                        resolveGit();
                      } else {
                        logger.warn(
                          `Failed to create initial commit (code ${commitCode})`,
                        );
                        logger.warn("Git commit stderr:", gitCommitStderr);
                        logger.warn("Git commit stdout:", gitCommitStdout);
                        resolveGit(); // Continue anyway
                      }
                    });

                    gitCommit.on("error", (err) => {
                      logger.warn("Git commit error:", err);
                      resolveGit(); // Continue anyway
                    });
                  } else {
                    logger.warn(`Git add failed with code ${addCode}`);
                    logger.warn("Git add stderr:", gitAddStderr);
                    resolveGit(); // Continue anyway
                  }
                });

                gitAdd.on("error", (err) => {
                  logger.warn("Git add error:", err);
                  resolveGit(); // Continue anyway
                });
              });
            } catch (gitError) {
              logger.warn("Git setup failed, but continuing:", gitError);
              // Continue even if git fails
            }

            // Create database entry for the app
            try {
              const [app] = await db
                .insert(apps)
                .values({
                  name: projectName,
                  path: projectPath,
                  isContractProject: true,
                  nlPrompt: nlPrompt || null,
                  generationMetadata: generationMetadata || null,
                })
                .returning();

              logger.info(`Created app in database with ID: ${app.id}`);

              resolve({
                success: true,
                output: `✓ Anchor project '${projectName}' initialized successfully!\n\nProject created at: ${projectPath}\n\n${stdout}`,
                appId: app.id,
              });
            } catch (dbError) {
              logger.error("Failed to create app in database:", dbError);
              resolve({
                success: false,
                output: `✗ Failed to register project in database\n\n${dbError}`,
                error: String(dbError),
              });
            }
          } else {
            logger.error(`Anchor init failed with code ${code}`);
            resolve({
              success: false,
              output: `✗ Failed to initialize Anchor project\n\n${stderr || stdout}`,
              error: stderr || stdout,
            });
          }
        });

        anchorProcess.on("error", (err) => {
          logger.error("Failed to start anchor init:", err);
          resolve({
            success: false,
            output:
              "Failed to run anchor init. Make sure Anchor is installed and in PATH.\n\nInstall: https://www.anchor-lang.com/docs/installation",
            error: err.message,
          });
        });
      });
    },
  );
}
