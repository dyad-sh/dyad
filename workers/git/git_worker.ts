/**
 * Git Worker Thread
 *
 * This worker handles git operations (push, pull, etc.) in a separate thread
 * to prevent blocking the main Electron process event loop.
 *
 * This is important because git operations can take a long time, and blocking
 * the main process would prevent IPC messages (like chat input) from being processed.
 *
 * Note: We use child_process.spawn directly instead of dugite because dugite
 * has module resolution issues in worker threads within packaged Electron apps.
 */

import { parentPort } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import type {
  GitWorkerInput,
  GitWorkerOutput,
  GitPushWorkerInput,
  GitPullWorkerInput,
  GitSetRemoteUrlWorkerInput,
} from "../../shared/git_worker_types";

const execFileAsync = promisify(execFile);

/**
 * Get the Windows git subfolder based on architecture.
 */
function getWin32GitSubfolder(): string {
  if (process.arch === "x64") {
    return "mingw64";
  } else if (process.arch === "arm64") {
    return "clangarm64";
  } else {
    return "mingw32";
  }
}

/**
 * Setup git environment including executable path and helper paths.
 * This mirrors what dugite does in git-environment.js
 */
function setupGitEnvironment(): {
  gitPath: string;
  env: Record<string, string | undefined>;
} {
  const localGitDir = process.env.LOCAL_GIT_DIRECTORY;
  const env: Record<string, string | undefined> = { ...process.env };

  if (!localGitDir || !fs.existsSync(localGitDir)) {
    // Fall back to system git
    return { gitPath: "git", env };
  }

  const platform = process.platform;
  let gitPath: string;
  let gitExecPath: string;

  if (platform === "win32") {
    const subfolder = getWin32GitSubfolder();
    gitPath = path.join(localGitDir, "cmd", "git.exe");
    gitExecPath = path.join(localGitDir, subfolder, "libexec", "git-core");
    // Add Windows-specific PATH entries
    env.PATH = `${localGitDir}\\${subfolder}\\bin;${localGitDir}\\${subfolder}\\usr\\bin;${env.PATH ?? ""}`;
  } else {
    // macOS or Linux
    gitPath = path.join(localGitDir, "bin", "git");
    gitExecPath = path.join(localGitDir, "libexec", "git-core");

    // Set template dir for macOS/Linux
    env.GIT_TEMPLATE_DIR = path.join(
      localGitDir,
      "share",
      "git-core",
      "templates",
    );

    if (platform === "linux") {
      // Set PREFIX for Linux builds
      env.PREFIX = localGitDir;
    }
  }

  // Set GIT_EXEC_PATH so git can find its helper commands (like git-remote-http)
  env.GIT_EXEC_PATH = gitExecPath;

  // Set system gitconfig on non-Windows platforms
  if (platform !== "win32") {
    env.GIT_CONFIG_SYSTEM = path.join(localGitDir, "etc", "gitconfig");
  }

  return { gitPath: fs.existsSync(gitPath) ? gitPath : "git", env };
}

const { gitPath: GIT_PATH, env: GIT_ENV } = setupGitEnvironment();

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a git command
 */
async function execGit(
  args: string[],
  cwd: string,
  additionalEnv?: Record<string, string | undefined>,
): Promise<ExecResult> {
  try {
    // Merge the git environment with any additional environment variables
    const env = additionalEnv ? { ...GIT_ENV, ...additionalEnv } : GIT_ENV;
    const { stdout, stderr } = await execFileAsync(GIT_PATH, args, {
      cwd,
      env,
      maxBuffer: 100 * 1024 * 1024, // 100MB
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    // execFile throws on non-zero exit code
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
      exitCode: error.code || 1,
    };
  }
}

/**
 * Handle git push operation
 */
async function handlePush(input: GitPushWorkerInput): Promise<GitWorkerOutput> {
  const {
    appPath,
    branch,
    force,
    forceWithLease,
    enableNativeGit,
    sanitizedEnv,
  } = input;
  const targetBranch = branch || "main";

  try {
    if (!enableNativeGit) {
      // For non-native git, we fall back to an error since isomorphic-git
      // can't be easily used in a worker without complex bundling
      return {
        success: false,
        error:
          "Git worker requires native git to be enabled. Please enable native git in settings.",
      };
    }

    const args = ["push", "origin", `${targetBranch}:${targetBranch}`];
    if (forceWithLease) {
      args.push("--force-with-lease");
    } else if (force) {
      args.push("--force");
    }

    const result = await execGit(args, appPath, sanitizedEnv);
    if (result.exitCode !== 0) {
      const errorMsg = result.stderr || result.stdout;
      return { success: false, error: `Git push failed: ${errorMsg}` };
    }
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Handle git pull operation
 */
async function handlePull(input: GitPullWorkerInput): Promise<GitWorkerOutput> {
  const { appPath, branch, remote, enableNativeGit, sanitizedEnv } = input;

  try {
    if (!enableNativeGit) {
      return {
        success: false,
        error:
          "Git worker requires native git to be enabled. Please enable native git in settings.",
      };
    }

    const args = ["pull", remote, branch];
    const result = await execGit(args, appPath, sanitizedEnv);
    if (result.exitCode !== 0) {
      const errorMsg = result.stderr || result.stdout;

      // Check for merge conflicts
      if (
        errorMsg.includes("CONFLICT") ||
        errorMsg.includes("Merge conflict") ||
        errorMsg.includes("merge conflict")
      ) {
        return {
          success: false,
          error: `Merge conflict detected during pull: ${errorMsg}`,
          name: "GitConflictError",
        };
      }

      return { success: false, error: `Git pull failed: ${errorMsg}` };
    }
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : undefined;
    return { success: false, error: errorMessage, name: errorName };
  }
}

/**
 * Handle git remote URL setting
 */
async function handleSetRemoteUrl(
  input: GitSetRemoteUrlWorkerInput,
): Promise<GitWorkerOutput> {
  const { appPath, remoteUrl, enableNativeGit, sanitizedEnv } = input;

  try {
    if (!enableNativeGit) {
      return {
        success: false,
        error:
          "Git worker requires native git to be enabled. Please enable native git in settings.",
      };
    }

    // Try to set the remote URL, or add it if it doesn't exist
    const setResult = await execGit(
      ["remote", "set-url", "origin", remoteUrl],
      appPath,
      sanitizedEnv,
    );

    if (setResult.exitCode !== 0) {
      // Remote might not exist, try adding it
      const addResult = await execGit(
        ["remote", "add", "origin", remoteUrl],
        appPath,
        sanitizedEnv,
      );

      if (addResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to set remote URL: ${addResult.stderr || addResult.stdout}`,
        };
      }
    }
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Process incoming git operation requests
 */
async function processGitOperation(
  input: GitWorkerInput,
): Promise<GitWorkerOutput> {
  switch (input.type) {
    case "push":
      return handlePush(input);
    case "pull":
      return handlePull(input);
    case "setRemoteUrl":
      return handleSetRemoteUrl(input);
    default:
      return { success: false, error: `Unknown operation type` };
  }
}

// Handle messages from main thread
parentPort?.on("message", async (input: GitWorkerInput) => {
  const output = await processGitOperation(input);
  parentPort?.postMessage(output);
});
