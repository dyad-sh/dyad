import fs, { promises as fsPromises } from "node:fs";

import {
  execGit,
  getGitProcessEnvironment,
  withGitAuthorConfig,
} from "@/ipc/utils/git_utils";
import { getGitAuthor, type GitAuthor } from "@/ipc/utils/git_author";
import {
  runBufferedProcess,
  type BufferedProcessResult,
} from "@/ipc/utils/buffered_process";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";

export const PRE_COMMIT_TIMEOUT_MS = 10 * 60_000;
export const PRE_COMMIT_STAGING_TIMEOUT_MS = 60_000;
/**
 * The message hooks only ever see a commit message, so they finish in seconds
 * even when they shell out to a linter. They run inside the same coordinator
 * claim as `pre-commit` (`rules/app-operation-coordination.md`), and that queue
 * has no timeout, so giving them the full `PRE_COMMIT_TIMEOUT_MS` would let one
 * manual commit hold the app's repository write lock for half an hour with
 * every other operation for that app queued silently behind it. Two minutes
 * still absorbs a cold `npx commitlint` start and bounds the worst case.
 */
export const COMMIT_MESSAGE_HOOK_TIMEOUT_MS = 2 * 60_000;
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

/** Git's raw date format, e.g. `@1700000000 +0100`. */
function formatGitRawDate(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = String(Math.trunc(absoluteOffset / 60)).padStart(2, "0");
  const minutes = String(absoluteOffset % 60).padStart(2, "0");
  return `@${Math.floor(date.getTime() / 1000)} ${sign}${hours}${minutes}`;
}

/**
 * Reproduces the environment `git commit` hands to its hooks, which
 * `git hook run` does not supply.
 *
 * Verified against Git 2.43: a native commit exports `GIT_AUTHOR_NAME`,
 * `GIT_AUTHOR_EMAIL`, `GIT_AUTHOR_DATE`, `GIT_INDEX_FILE` and `GIT_EDITOR` to
 * every hook, while the standalone runner exports none of them. Passing the
 * identity through `-c user.*` only reaches hooks that ask Git for its
 * configuration; a hook that reads these variables directly would otherwise see
 * them unset and could reject a valid commit or inspect the wrong index.
 */
async function getCommitHookEnvironment(
  appPath: string,
  author: GitAuthor,
): Promise<NodeJS.ProcessEnv> {
  const indexFile = await resolveGitPath(appPath, "index");
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    // Git stamps this when the commit starts, which is what this hook run
    // stands in for. The commit itself is created moments later.
    GIT_AUTHOR_DATE: formatGitRawDate(new Date()),
    // Every commit Dyad creates is non-interactive (`gitCommit` always uses
    // `-m`), so a hook that opens an editor must no-op instead of waiting on a
    // terminal that does not exist.
    GIT_EDITOR: ":",
    ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}),
  };
}

/**
 * Runs one of Git's commit hooks the way `git commit` would: with the author
 * identity in configuration and the native commit-hook environment in place.
 */
async function runCommitHook({
  path,
  hookArgs,
  signal,
  timeoutMs,
}: {
  path: string;
  hookArgs: string[];
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<BufferedProcessResult> {
  const author = await getGitAuthor();
  const { env: gitEnv, gitLocation } = getGitProcessEnvironment();
  return runBufferedProcess({
    command: gitLocation,
    args: withGitAuthorConfig(author, ["hook", "run", ...hookArgs]),
    cwd: path,
    env: {
      ...getPackageManagerCommandEnv(gitEnv),
      ...(await getCommitHookEnvironment(path, author)),
    },
    signal,
    timeoutMs,
    maxOutputBytes: 256_000,
    waitForCloseAfterForceKill: true,
  });
}

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
  return runCommitHook({
    path,
    hookArgs: ["pre-commit"],
    signal,
    timeoutMs: PRE_COMMIT_TIMEOUT_MS,
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
  const result = await runCommitHook({
    path,
    hookArgs: [hookName, "--", ...hookArgs(messagePath)],
    signal,
    timeoutMs: COMMIT_MESSAGE_HOOK_TIMEOUT_MS,
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
