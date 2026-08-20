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

async function resolvePreCommitHookPath(
  appPath: string,
): Promise<string | null> {
  try {
    const result = await execGit(
      ["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-commit"],
      appPath,
      { maxBuffer: 64_000 },
    );
    if (result.exitCode !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function isPreCommitHookAvailable(
  appPath: string,
): Promise<boolean> {
  const hookPath = await resolvePreCommitHookPath(appPath);
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

export function formatPreCommitOutput(stdout: string, stderr: string): string {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  if (!combined) return "The hook produced no output.";
  return combined.length > MAX_RESULT_OUTPUT_CHARS
    ? `[Earlier output truncated]\n${combined.slice(-MAX_RESULT_OUTPUT_CHARS)}`
    : combined;
}
