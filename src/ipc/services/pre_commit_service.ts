import fs, { promises as fsPromises } from "node:fs";

import { execGit, getGitProcessEnvironment } from "@/ipc/utils/git_utils";
import {
  runBufferedProcess,
  type BufferedProcessResult,
} from "@/ipc/utils/buffered_process";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";

export const PRE_COMMIT_TIMEOUT_MS = 10 * 60_000;
export const PRE_COMMIT_STAGING_TIMEOUT_MS = 60_000;
const MAX_RESULT_OUTPUT_CHARS = 12_000;

async function resolveGitPath(
  appPath: string,
  gitPath: string,
): Promise<string | null> {
  try {
    const result = await execGit(
      ["rev-parse", "--path-format=absolute", "--git-path", gitPath],
      appPath,
      { maxBuffer: 64_000 },
    );
    if (result.exitCode !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

type GitHookName = "pre-commit" | "prepare-commit-msg" | "commit-msg";

async function isGitHookAvailable(
  appPath: string,
  hookName: GitHookName,
): Promise<boolean> {
  const hookPath = await resolveGitPath(appPath, `hooks/${hookName}`);
  if (!hookPath) return false;

  try {
    const stat = await fsPromises.stat(hookPath);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    await fsPromises.access(hookPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isPreCommitHookAvailable(
  appPath: string,
): Promise<boolean> {
  return isGitHookAvailable(appPath, "pre-commit");
}

export async function isCommitMsgHookAvailable(
  appPath: string,
): Promise<boolean> {
  return isGitHookAvailable(appPath, "commit-msg");
}

export async function isPrepareCommitMsgHookAvailable(
  appPath: string,
): Promise<boolean> {
  return isGitHookAvailable(appPath, "prepare-commit-msg");
}

export async function runPreCommitHook({
  path,
  signal,
}: {
  path: string;
  signal?: AbortSignal;
}): Promise<BufferedProcessResult> {
  const { env: gitEnv, gitLocation } = getGitProcessEnvironment();
  return runBufferedProcess({
    command: gitLocation,
    args: ["hook", "run", "pre-commit"],
    cwd: path,
    env: getPackageManagerCommandEnv(gitEnv),
    signal,
    timeoutMs: PRE_COMMIT_TIMEOUT_MS,
    maxOutputBytes: 256_000,
    waitForCloseAfterForceKill: true,
  });
}

/**
 * Runs one of Git's commit-message hooks against `message` and reads back
 * whatever the hook left in `COMMIT_EDITMSG`, so a hook that rewrites the
 * message (rather than only validating it) is honored.
 */
async function runMessageHook({
  path,
  message,
  signal,
  hookName,
  hookArgs,
}: {
  path: string;
  message: string;
  signal?: AbortSignal;
  hookName: "prepare-commit-msg" | "commit-msg";
  hookArgs: (messagePath: string) => string[];
}): Promise<BufferedProcessResult & { message: string }> {
  const messagePath = await resolveGitPath(path, "COMMIT_EDITMSG");
  if (!messagePath) {
    throw new Error("Could not resolve Git's commit message file");
  }

  await fsPromises.writeFile(messagePath, `${message}\n`, "utf8");
  const { env: gitEnv, gitLocation } = getGitProcessEnvironment();
  const result = await runBufferedProcess({
    command: gitLocation,
    args: ["hook", "run", hookName, "--", ...hookArgs(messagePath)],
    cwd: path,
    env: getPackageManagerCommandEnv(gitEnv),
    signal,
    timeoutMs: PRE_COMMIT_TIMEOUT_MS,
    maxOutputBytes: 256_000,
    waitForCloseAfterForceKill: true,
  });

  return {
    ...result,
    message: (await fsPromises.readFile(messagePath, "utf8")).replace(
      /\r?\n$/,
      "",
    ),
  };
}

/**
 * Runs `prepare-commit-msg`, which Git invokes after `pre-commit` and before
 * `commit-msg` to let a hook rewrite the message (adding a ticket ID or a
 * Gerrit Change-Id, for example). Running it here keeps Git's ordering intact
 * so `commit-msg` validates the same text that actually gets committed.
 *
 * The `message` source argument matches what Git passes for a `-m` commit,
 * which is how `gitCommit` always creates commits.
 */
export async function runPrepareCommitMsgHook({
  path,
  message,
  signal,
}: {
  path: string;
  message: string;
  signal?: AbortSignal;
}): Promise<BufferedProcessResult & { message: string }> {
  return runMessageHook({
    path,
    message,
    signal,
    hookName: "prepare-commit-msg",
    hookArgs: (messagePath) => [messagePath, "message"],
  });
}

export async function runCommitMsgHook({
  path,
  message,
  signal,
}: {
  path: string;
  message: string;
  signal?: AbortSignal;
}): Promise<BufferedProcessResult & { message: string }> {
  return runMessageHook({
    path,
    message,
    signal,
    hookName: "commit-msg",
    hookArgs: (messagePath) => [messagePath],
  });
}

export function formatPreCommitOutput(stdout: string, stderr: string): string {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  if (!combined) return "The hook produced no output.";
  return combined.length > MAX_RESULT_OUTPUT_CHARS
    ? `[Earlier output truncated]\n${combined.slice(-MAX_RESULT_OUTPUT_CHARS)}`
    : combined;
}
