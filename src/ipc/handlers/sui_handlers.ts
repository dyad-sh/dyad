import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { getDyadAppPath } from "../../paths/paths";

const logger = log.scope("sui_handlers");
const handle = createLoggedHandler(logger);

/**
 * Strip ANSI color codes from string
 */
function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Parse and format Move compiler errors into a more readable format
 * @param rawOutput - Raw compiler output
 * @param truncate - If true, limit to first 5 errors for UI display
 */
function formatCompilerErrors(rawOutput: string, truncate = true): string {
  // First strip ANSI color codes
  const cleanOutput = stripAnsiCodes(rawOutput);
  const lines = cleanOutput.split('\n');

  // Extract structured errors
  interface CompileIssue {
    type: 'error' | 'warning';
    code: string;
    message: string;
    location?: string;
    lineContent?: string;
    explanation?: string;
  }

  const issues: CompileIssue[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Match error or warning line
    const errorMatch = line.match(/error\[([^\]]+)\]: (.+)/);
    const warningMatch = line.match(/warning\[([^\]]+)\]: (.+)/);

    if (errorMatch || warningMatch) {
      const isError = !!errorMatch;
      const match = isError ? errorMatch : warningMatch;
      const code = match![1];
      const message = match![2];

      const issue: CompileIssue = {
        type: isError ? 'error' : 'warning',
        code,
        message,
      };

      // Collect all context lines for this error (everything until next error or blank line)
      const contextLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];

        // Stop at next error/warning
        if (nextLine.match(/^(error|warning)\[/)) {
          break;
        }

        // Stop at blank line after we've collected some content
        if (contextLines.length > 0 && nextLine.trim() === '') {
          break;
        }

        // Collect this line if it has content
        if (nextLine.trim()) {
          contextLines.push(nextLine);

          // Extract file location from ┌─ line
          if (nextLine.includes('┌─') && nextLine.includes('.move:')) {
            const locMatch = nextLine.match(/\.\/sources\/[^:]+:(\d+)/);
            if (locMatch) {
              issue.location = `Line ${locMatch[1]}`;
            }
          }

          // Extract code snippet (lines with │ containing actual code)
          if (nextLine.includes('│') && !nextLine.includes('┌') && !nextLine.includes('└')) {
            const codeMatch = nextLine.match(/\d+\s*│\s*(.+)/);
            if (codeMatch && !issue.lineContent) {
              issue.lineContent = codeMatch[1].trim();
            }
          }

          // Extract explanation lines that come after the caret
          // These are lines with │ but without line numbers or carets
          if (nextLine.includes('│') && (nextLine.includes('^') || nextLine.includes('│'))) {
            // Start collecting explanation from after the caret line
            let foundCaret = nextLine.includes('^');
            let k = foundCaret ? j + 1 : j;
            const explanationParts: string[] = [];

            while (k < lines.length && k < j + 10) {
              const explainLine = lines[k];

              // Stop at next error/warning or blank line
              if (explainLine.match(/^(error|warning)\[/)) break;
              if (explainLine.trim() === '' && explanationParts.length > 0) break;

              // Extract explanation text from lines with │ but no line numbers
              if (explainLine.includes('│')) {
                // Skip lines with caret or line numbers
                if (explainLine.includes('^')) {
                  foundCaret = true;
                  k++;
                  continue;
                }
                if (explainLine.match(/\d+\s*│/)) {
                  k++;
                  continue;
                }

                // Extract the text after │
                const content = explainLine.replace(/.*│\s*/, '').trim();
                if (content && foundCaret) {
                  explanationParts.push(content);
                }
              }

              k++;
            }

            if (explanationParts.length > 0) {
              issue.explanation = explanationParts.join(' ');
            }
          }
        }

        j++;
      }

      issues.push(issue);
      i = j - 1;
    }

    i++;
  }

  // Format output
  if (issues.length === 0) {
    // No structured errors found, but there might still be compilation failures
    // Look for common error patterns
    const hasError = cleanOutput.toLowerCase().includes('error') ||
                     cleanOutput.toLowerCase().includes('failed to build');

    if (hasError) {
      // Filter out warnings and log prefixes, extract meaningful error content
      const meaningfulLines = lines
        .map(l => {
          // Remove logger timestamps/prefixes (contains ›)
          if (l.includes('›')) {
            const parts = l.split('›');
            return parts.length > 1 ? parts[1].trim() : l;
          }
          return l;
        })
        .filter(l => {
          const lower = l.toLowerCase();
          // Skip warnings, empty lines, and log markers
          if (lower.includes('[warning]') || l.trim() === '' || l.includes('[sui build')) return false;
          // Include lines with error indicators or explanations
          return lower.includes('error') ||
                 lower.includes('failed') ||
                 lower.includes('caused by') ||
                 lower.includes('invalid') ||
                 lower.includes('unsupported') ||
                 l.trim().startsWith('at ') ||
                 l.includes(':');
        });

      if (meaningfulLines.length > 0) {
        const limit = truncate ? 15 : meaningfulLines.length;
        return '❌ Compilation failed:\n\n' + meaningfulLines.slice(0, limit).join('\n');
      }
    }

    // If still nothing meaningful, return the cleaned output
    return cleanOutput;
  }

  const errors = issues.filter(i => i.type === 'error');
  const warnings = issues.filter(i => i.type === 'warning');

  let output = '';

  // Show errors
  if (errors.length > 0) {
    output += `❌ ${errors.length} Compilation Error${errors.length > 1 ? 's' : ''}:\n\n`;

    const errorsToShow = truncate ? errors.slice(0, 5) : errors;
    errorsToShow.forEach((err, idx) => {
      output += `${idx + 1}. [${err.code}] ${err.message}`;
      if (err.location) output += ` (${err.location})`;
      output += '\n';
      if (err.lineContent) {
        output += `   Code: ${err.lineContent}\n`;
      }
      if (err.explanation) {
        output += `   Info: ${err.explanation}\n`;
      }
      output += '\n';
    });

    if (truncate && errors.length > 5) {
      output += `... and ${errors.length - 5} more error${errors.length - 5 > 1 ? 's' : ''}\n`;
    }
  }

  // Show warnings
  if (warnings.length > 0) {
    if (output) output += '\n';
    if (truncate) {
      output += `⚠️  ${warnings.length} Warning${warnings.length > 1 ? 's' : ''} (non-blocking)\n`;
    } else {
      output += `⚠️  ${warnings.length} Warning${warnings.length > 1 ? 's' : ''}:\n\n`;
      warnings.forEach((warn, idx) => {
        output += `${idx + 1}. [${warn.code}] ${warn.message}`;
        if (warn.location) output += ` (${warn.location})`;
        output += '\n';
        if (warn.lineContent) {
          output += `   Code: ${warn.lineContent}\n`;
        }
        if (warn.explanation) {
          output += `   Info: ${warn.explanation}\n`;
        }
        output += '\n';
      });
    }
  }

  return output.trim();
}

export interface SuiCompileParams {
  appPath: string;
}

export interface SuiCompileResult {
  success: boolean;
  output: string;
  error?: string;
  fullError?: string; // Full formatted errors for AI (not truncated)
}

export interface SuiDeployParams {
  appPath: string;
  gasBudget?: number;
}

export interface SuiDeployResult {
  success: boolean;
  packageId?: string;
  transactionDigest?: string;
  output: string;
  error?: string;
}

export interface SuiTestParams {
  appPath: string;
}

export interface SuiTestResult {
  success: boolean;
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
   * Find the first directory in src/ that contains Move files or Move.toml
   */
  function findMovePackageDir(appPath: string): string | null {
    const srcPath = path.join(appPath, "src");

    if (!fs.existsSync(srcPath)) {
      return null;
    }

    const entries = fs.readdirSync(srcPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(srcPath, entry.name);
        const moveTomlPath = path.join(dirPath, "Move.toml");
        const sourcesPath = path.join(dirPath, "sources");

        // Check if this directory has Move.toml or a sources/ subdirectory with .move files
        if (fs.existsSync(moveTomlPath)) {
          return dirPath;
        }

        if (fs.existsSync(sourcesPath)) {
          const sourceFiles = fs.readdirSync(sourcesPath);
          if (sourceFiles.some(f => f.endsWith('.move'))) {
            return dirPath;
          }
        }
      }
    }

    return null;
  }

  /**
   * Compile a Move package using sui move build
   */
  handle(
    "sui-compile",
    async (_, params: SuiCompileParams): Promise<SuiCompileResult> => {
      const appPath = getDyadAppPath(params.appPath);

      // Find the Move package directory dynamically
      const movePath = findMovePackageDir(appPath);

      if (!movePath) {
        return {
          success: false,
          output: "No Move package found in src/ directory",
          error: "Could not find a directory with Move.toml or .move files",
        };
      }

      const packageName = path.basename(movePath);
      logger.info(`Compiling Move package at: ${movePath} (${packageName})`);

      // Ensure Move.toml exists before compiling
      try {
        ensureMoveToml(movePath, packageName);
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
              output: "✅ Compilation successful! Move modules built.",
            });
          } else {
            logger.error(`Move compilation failed with code ${code}`);
            // Combine stderr and stdout (errors can be in either or both)
            // Stderr typically has warnings, stdout has actual build errors
            const combinedOutput = [stderr, stdout].filter(s => s.trim()).join('\n\n');
            const rawErrorOutput = combinedOutput || "Compilation failed";
            // Truncated version for UI display (first 5 errors)
            const formattedErrorsTruncated = formatCompilerErrors(rawErrorOutput, true);
            // Full version for AI (all errors)
            const formattedErrorsFull = formatCompilerErrors(rawErrorOutput, false);
            resolve({
              success: false,
              output: formattedErrorsTruncated,
              // Return full formatted errors for AI (clean, structured, complete)
              fullError: formattedErrorsFull,
              // Also keep raw for backwards compatibility
              error: stripAnsiCodes(rawErrorOutput),
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
      const { appPath, gasBudget = 100000000 } = params;
      const fullPath = getDyadAppPath(appPath);

      // Find the Move package directory dynamically
      const movePath = findMovePackageDir(fullPath);

      if (!movePath) {
        return {
          success: false,
          output: "No Move package found in src/ directory",
          error: "Could not find a directory with Move.toml or .move files",
        };
      }

      const packageName = path.basename(movePath);
      logger.info(`Deploying Move package at: ${movePath} (${packageName})`);

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        // Build the command (network is configured via sui client config)
        // Note: We don't need to specify gas address - Sui CLI uses the active address automatically
        const args = ["client", "publish", "--json", "--gas-budget", gasBudget.toString()];

        /// @note no need to pass this anymore with sui cli v 1.61
        // if (gasAddress) {
        //   args.push("--gas", gasAddress);
        // }

        args.push("--gas-budget", gasBudget.toString());
        logger.info(`Running: sui ${args.join(" ")}`);
        logger.info(`Note: Using network configured in Sui CLI (should be testnet)`);

        logger.log(`FULL command: sui ${args.join(" ")}`)

        const suiProcess = spawn("sui", args, {
          cwd: movePath,
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

            const formattedOutput = formatDeployOutput(packageId, transactionDigest, stdout);
            // Note: Assuming testnet for explorer URL (most common for development)
            const explorerUrl = transactionDigest
              ? `\n\nView on Sui Explorer (testnet):\nhttps://suiscan.xyz/testnet/tx/${transactionDigest}`
              : "";

            resolve({
              success: true,
              packageId,
              transactionDigest,
              output: formattedOutput + explorerUrl,
            });
          } else {
            logger.error(`Move deployment failed with code ${code}`);

            // Check for common errors and provide helpful messages
            let errorMessage = stderr || stdout || "Deployment failed";

            if (errorMessage.includes("Insufficient gas") || errorMessage.includes("insufficient")) {
              errorMessage = "❌ Deployment failed: Insufficient SUI tokens for gas.\n\n" +
                "To get testnet SUI tokens:\n" +
                "1. Run: sui client faucet\n" +
                "2. Or visit: https://discord.com/channels/916379725201563759/971488439931392130\n\n" +
                "Original error:\n" + errorMessage;
            } else if (errorMessage.includes("No active address") || errorMessage.includes("no address")) {
              errorMessage = "❌ Deployment failed: No Sui address configured.\n\n" +
                "Please configure Sui CLI:\n" +
                "1. Run: sui client\n" +
                "2. Follow prompts to create/import a wallet\n\n" +
                "Original error:\n" + errorMessage;
            }

            resolve({
              success: false,
              output: errorMessage,
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
   * Run tests for a Move package using sui move test
   */
  handle(
    "sui-test",
    async (_, params: SuiTestParams): Promise<SuiTestResult> => {
      const appPath = getDyadAppPath(params.appPath);

      // Find the Move package directory dynamically
      const movePath = findMovePackageDir(appPath);

      if (!movePath) {
        return {
          success: false,
          output: "No Move package found in src/ directory",
          error: "Could not find a directory with Move.toml or .move files",
        };
      }

      const packageName = path.basename(movePath);
      logger.info(`Running tests for Move package at: ${movePath} (${packageName})`);

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        const suiProcess = spawn("sui", ["move", "test"], {
          cwd: movePath,
          shell: true,
        });

        suiProcess.stdout.on("data", (data) => {
          const output = data.toString();
          stdout += output;
          logger.info(`[sui test stdout]: ${output}`);
        });

        suiProcess.stderr.on("data", (data) => {
          const output = data.toString();
          stderr += output;
          logger.warn(`[sui test stderr]: ${output}`);
        });

        suiProcess.on("close", (code) => {
          if (code === 0) {
            logger.info("Move tests completed successfully");
            const cleanOutput = stripAnsiCodes(stdout);
            resolve({
              success: true,
              output: "✅ Tests passed!\n\n" + cleanOutput,
            });
          } else {
            logger.error(`Move tests failed with code ${code}`);
            const combinedOutput = [stderr, stdout].filter(s => s.trim()).join('\n\n');
            const cleanOutput = stripAnsiCodes(combinedOutput || "Tests failed");
            resolve({
              success: false,
              output: "❌ Tests failed:\n\n" + cleanOutput,
              error: cleanOutput,
            });
          }
        });

        suiProcess.on("error", (err) => {
          logger.error("Failed to start sui test process:", err);
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

  /**
   * Get Sui balance for active address
   */
  handle(
    "sui-get-balance",
    async (): Promise<{ balance: string | null; formattedBalance: string | null }> => {
      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";

        logger.info("Fetching Sui balance...");
        const suiProcess = spawn("sui", ["client", "gas", "--json"], {
          shell: true,
        });

        suiProcess.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        suiProcess.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        suiProcess.on("close", (code) => {
          logger.info(`Sui gas command completed with code ${code}`);

          if (stderr) {
            logger.warn(`Sui gas stderr: ${stderr}`);
          }

          if (code === 0 && stdout.trim()) {
            try {
              logger.info(`Parsing gas output: ${stdout.substring(0, 200)}...`);
              const gasObjects = JSON.parse(stdout);

              // Sum up all gas object balances
              let totalBalance = 0;
              if (Array.isArray(gasObjects)) {
                logger.info(`Found ${gasObjects.length} gas objects`);
                gasObjects.forEach((obj: any) => {
                  if (obj.mistBalance) {
                    const bal = parseInt(obj.mistBalance, 10);
                    totalBalance += bal;
                    logger.info(`Gas object balance: ${bal} MIST`);
                  }
                });
              } else {
                logger.warn("Gas output is not an array");
              }

              // Convert from MIST to SUI (1 SUI = 1,000,000,000 MIST)
              const balanceInSui = (totalBalance / 1_000_000_000).toFixed(4);
              logger.info(`Total balance: ${totalBalance} MIST = ${balanceInSui} SUI`);

              resolve({
                balance: totalBalance.toString(),
                formattedBalance: balanceInSui,
              });
            } catch (e) {
              logger.error("Failed to parse gas JSON:", e);
              logger.error("Raw stdout:", stdout);
              resolve({ balance: null, formattedBalance: null });
            }
          } else {
            logger.warn(`Failed to get balance. Code: ${code}, stdout: ${stdout}, stderr: ${stderr}`);
            resolve({ balance: null, formattedBalance: null });
          }
        });

        suiProcess.on("error", (err) => {
          logger.error("Failed to execute sui client gas:", err);
          resolve({ balance: null, formattedBalance: null });
        });
      });
    }
  );
}
