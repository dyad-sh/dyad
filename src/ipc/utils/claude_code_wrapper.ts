import { spawn } from "child_process";
import { writeFileSync, unlinkSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import log from "electron-log/main";

const logger = log.scope("claude-code-wrapper");

// Clean up old Claude temp files on startup (older than 1 hour)
export function cleanupOldTempFiles(): void {
  try {
    const tempDir = tmpdir();
    const files = readdirSync(tempDir);
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    files.forEach(file => {
      if (file.startsWith("claude-prompt-") && file.endsWith(".txt")) {
        const filePath = join(tempDir, file);
        try {
          const stats = statSync(filePath);
          if (stats.mtimeMs < oneHourAgo) {
            unlinkSync(filePath);
            logger.info(`Cleaned up old temp file: ${file}`);
          }
        } catch (err) {
          // File might have been deleted already or we don't have permission
          logger.debug(`Could not clean up temp file ${file}: ${err}`);
        }
      }
    });
  } catch (err) {
    logger.warn(`Failed to clean up old temp files: ${err}`);
  }
}

export interface ClaudeCodeOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // Timeout in milliseconds, default 300000 (5 minutes)
}

export async function executeClaudeCode(
  prompt: string,
  options: ClaudeCodeOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { cwd = process.cwd(), env = process.env, timeout = 300000 } = options;
    
    logger.info("Executing Claude Code with prompt length:", prompt.length);
    
    // Create a temporary file to store the prompt to avoid Windows command line length limitations
    const tempFileName = `claude-prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`;
    const tempFilePath = join(tmpdir(), tempFileName);
    
    try {
      // Write prompt to temporary file
      writeFileSync(tempFilePath, prompt, 'utf8');
      logger.info(`Created temporary prompt file: ${tempFilePath}`);
      
      // Setup cleanup function
      const cleanup = () => {
        try {
          unlinkSync(tempFilePath);
          logger.info(`Cleaned up temporary file: ${tempFilePath}`);
        } catch (cleanupError) {
          logger.warn(`Failed to clean up temporary file: ${cleanupError}`);
        }
      };

      // Execute Claude Code with the temporary file
      // Security: Validate tempFilePath to prevent command injection
      if (tempFilePath.includes(';') || tempFilePath.includes('&') || tempFilePath.includes('|')) {
        throw new Error("Invalid characters in temp file path");
      }
      
      const childProcess = spawn("claude", [
        "--continue",
        "--print", 
        "--dangerously-skip-permissions",
        tempFilePath
      ], {
        cwd,
        shell: false, // SECURITY: Disable shell to prevent command injection
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...env }
      });

      let stdout = "";
      let stderr = "";
      let isFinished = false;

      // Add timeout to kill hanging processes
      const processTimeout = setTimeout(() => {
        if (!isFinished) {
          logger.warn("Claude Code process timeout, killing...");
          childProcess.kill('SIGKILL');
          cleanup();
          reject(new Error("Claude Code process timeout"));
        }
      }, timeout); // Configurable timeout

      childProcess.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on("close", (code: number | null) => {
        if (isFinished) return; // Prevent double execution
        isFinished = true;
        clearTimeout(processTimeout);
        cleanup();
        
        if (code === 0) {
          logger.info("Claude Code executed successfully");
          resolve(stdout.trim());
        } else {
          logger.error(`Claude Code failed with exit code ${code}`);
          logger.error("STDERR:", stderr);
          reject(new Error(`Claude Code failed (exit code ${code}): ${stderr}`));
        }
      });

      childProcess.on("error", (err: Error) => {
        if (isFinished) return; // Prevent double execution
        isFinished = true;
        clearTimeout(processTimeout);
        cleanup();
        logger.error("Failed to spawn Claude Code:", err);
        reject(new Error(`Failed to execute Claude Code: ${err.message}`));
      });
      
      // Also handle process termination signals
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
      
    } catch (fileError) {
      logger.error("Failed to create temporary prompt file:", fileError);
      reject(new Error(`Failed to create temporary file: ${fileError}`));
    }
  });
}

export async function checkClaudeCodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const childProcess = spawn("claude", ["--version"], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let hasResolved = false;

    const timeout = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        childProcess.kill();
        resolve(false);
      }
    }, 5000); // 5 second timeout

    childProcess.on("close", (code: number | null) => {
      if (!hasResolved) {
        hasResolved = true;
        clearTimeout(timeout);
        resolve(code === 0);
      }
    });

    childProcess.on("error", () => {
      if (!hasResolved) {
        hasResolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}