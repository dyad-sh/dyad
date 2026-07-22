import { getGitAuthor } from "./git_author";
import {
  exec,
  ExecError,
  type IGitStringExecutionOptions,
  type IGitStringResult,
} from "dugite";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import pathModule from "node:path";
import { platform } from "node:os";
import log from "electron-log";
import { normalizePath } from "../../../shared/normalizePath";
import { safeJoin } from "./path_utils";
import { ensureLibcurlShimOnLinux } from "./linux_libcurl_shim";
import { getPathEnvKey } from "./path_env";
import type { UncommittedFile, UncommittedFileStatus } from "@/ipc/types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  isDotenvFilePath,
  redactDotenvValues,
  selectTextLineRange,
} from "@/utils/dotenv_redaction";
const logger = log.scope("git_utils");

function isUserVisibleGitPath(filePath: string) {
  return !filePath.startsWith(".dyad/") && filePath !== "pnpm-workspace.yaml";
}

function isAgentGitPatchVisiblePath(filePath: string) {
  return isUserVisibleGitPath(filePath) || filePath === "pnpm-workspace.yaml";
}

// Single-character C-style escapes emitted by git's `quote_c_style` (see
// git's quote.c). Everything else is either a literal byte or an octal escape.
const PORCELAIN_C_ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

function splitQuotedPorcelainRename(filePath: string): [string, string] | null {
  if (!filePath.startsWith('"')) {
    return null;
  }

  let escaped = false;
  for (let index = 1; index < filePath.length; index++) {
    const char = filePath[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      const separator = " -> ";
      if (!filePath.startsWith(separator, index + 1)) {
        return null;
      }
      const oldPath = filePath.slice(0, index + 1);
      const newPath = filePath.slice(index + 1 + separator.length);
      return [unquoteGitPath(oldPath), unquoteGitPath(newPath)];
    }
  }

  return null;
}

function getPorcelainPaths(line: string): string[] {
  const statusCode = line.substring(0, 2);
  const filePath = line.slice(3).trim();
  if (!statusCode.includes("R")) {
    return [unquoteGitPath(filePath)];
  }

  const quotedRename = splitQuotedPorcelainRename(filePath);
  if (quotedRename) {
    return quotedRename;
  }

  const renameIndex = filePath.indexOf(" -> ");
  return renameIndex === -1
    ? [unquoteGitPath(filePath)]
    : [
        unquoteGitPath(filePath.slice(0, renameIndex)),
        unquoteGitPath(filePath.slice(renameIndex + 4)),
      ];
}

/**
 * Returns a sanitized environment for git commands on Windows.
 * Filters out WSL-related PATH entries that can cause WSL interop issues.
 * On non-Windows platforms, returns undefined (use default environment).
 *
 * Issue: https://github.com/dyad-sh/dyad/issues/2194
 * When WSL is installed on Windows, the PATH can contain entries that cause
 * git commands to be intercepted by WSL's relay system, resulting in errors
 * like "execvpe(/bin/bash) failed: No such file or directory".
 */
function getWindowsSanitizedEnv():
  | Record<string, string | undefined>
  | undefined {
  if (platform() !== "win32") {
    return undefined;
  }

  const pathKey = getPathEnvKey(process.env);
  const currentPath = process.env[pathKey] ?? "";
  const pathSeparator = ";";

  // Filter out PATH entries that could trigger WSL interop
  const sanitizedPathEntries = currentPath
    .split(pathSeparator)
    .filter((entry) => {
      const lowerEntry = entry.toLowerCase();
      // Filter out WSL-related paths:
      // - \\wsl$\ or \\wsl.localhost\ network paths
      // - Paths containing 'windowsapps' that might have WSL shims
      // - Linux-style paths that somehow got into Windows PATH
      if (
        lowerEntry.includes("\\wsl$\\") ||
        lowerEntry.includes("\\wsl.localhost\\") ||
        lowerEntry.includes("windowsapps") ||
        lowerEntry.startsWith("/mnt/") ||
        lowerEntry.startsWith("/usr/") ||
        lowerEntry.startsWith("/bin/") ||
        lowerEntry.startsWith("/home/")
      ) {
        logger.debug(`Filtering WSL-related PATH entry: ${entry}`);
        return false;
      }
      return true;
    });

  return {
    ...process.env,
    [pathKey]: sanitizedPathEntries.join(pathSeparator),
  };
}

/**
 * Wrapper around dugite's exec that uses a sanitized environment on Windows
 * to prevent WSL interop issues.
 */
async function execGit(
  args: string[],
  path: string,
  options?: IGitStringExecutionOptions,
): Promise<IGitStringResult> {
  const sanitizedEnv = getWindowsSanitizedEnv();

  // Only create execOptions if we need to modify the environment
  // On Windows: merge sanitized env with any caller-provided env, ensuring sanitized PATH takes precedence
  // On non-Windows: pass through options unchanged (dugite will use process.env by default)
  if (sanitizedEnv) {
    // Find the PATH key used in the sanitized env
    const pathKey = getPathEnvKey(sanitizedEnv);
    const execOptions: IGitStringExecutionOptions = {
      ...options,
      env: {
        ...sanitizedEnv,
        ...options?.env,
        // Ensure sanitized PATH always takes precedence to prevent WSL contamination
        [pathKey]: sanitizedEnv[pathKey],
      },
    };
    return exec(args, path, execOptions);
  }

  // On Linux, the bundled git http helpers are linked against
  // libcurl-gnutls.so.4, which RHEL-based distros don't ship. When needed,
  // prepend a shim directory to LD_LIBRARY_PATH that exposes the system
  // libcurl under that soname. No-op (returns undefined) on distros that
  // already have libcurl-gnutls.so.4.
  const shimDir = ensureLibcurlShimOnLinux();
  if (shimDir) {
    const existingLdPath =
      options?.env?.LD_LIBRARY_PATH ?? process.env.LD_LIBRARY_PATH;
    const ldLibraryPath = [shimDir, existingLdPath].filter(Boolean).join(":");
    return exec(args, path, {
      ...options,
      env: {
        ...process.env,
        ...options?.env,
        LD_LIBRARY_PATH: ldLibraryPath,
      },
    });
  }

  // On non-Windows without a shim, pass options through unchanged
  return exec(args, path, options);
}
import type {
  GitBaseParams,
  GitFileParams,
  GitListFilesParams,
  GitCheckoutParams,
  GitBranchRenameParams,
  GitCloneParams,
  GitCommitParams,
  GitLogParams,
  GitFileAtCommitParams,
  GitSetRemoteUrlParams,
  GitStageToRevertParams,
  GitInitParams,
  GitPushParams,
  GitCommit,
  GitFetchParams,
  GitPullParams,
  GitMergeParams,
  GitCreateBranchParams,
  GitDeleteBranchParams,
  AgentGitDiffScope,
  AgentGitStatus,
  AgentGitTextResult,
  GitChangedFile,
  GitChangedFileType,
  GitListChangedFilesParams,
} from "../git_types";

/**
 * Builds environment variables for native git network operations (clone,
 * fetch, pull, push).
 *
 * Credentials are passed per-invocation via `http.<url>.extraheader` instead
 * of being embedded in the remote URL, so tokens are never persisted to
 * .git/config or echoed back in git error messages. Credential helpers are
 * cleared and terminal prompting is disabled so git fails fast instead of
 * invoking system helpers or waiting for input that can never arrive.
 */
function getGitNetworkEnv(accessToken?: string): Record<string, string> {
  const configs: [key: string, value: string][] = [
    // An empty credential.helper entry resets the helper list, so helpers
    // from system/global config (osxkeychain, manager, etc.) never run.
    ["credential.helper", ""],
  ];
  if (accessToken) {
    const basicAuth = Buffer.from(`${accessToken}:x-oauth-basic`).toString(
      "base64",
    );
    configs.push([
      "http.https://github.com/.extraheader",
      `Authorization: Basic ${basicAuth}`,
    ]);
  }
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(configs.length),
  };
  configs.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

/**
 * Helper function that wraps exec and throws an error if the exit code is non-zero.
 *
 * Defaults to {@link DyadErrorKind.External} so unexpected failures (network, permissions,
 * corrupted repos) surface in telemetry. Use {@link DyadErrorKind.Conflict} only when the
 * dominant failure mode is genuinely merge/working-tree conflict (callers that detect
 * conflict state often rethrow {@link GitConflictError} instead).
 */
async function execOrThrow(
  args: string[],
  path: string,
  errorMessage?: string,
  kind: DyadErrorKind = DyadErrorKind.External,
  options?: IGitStringExecutionOptions,
): Promise<void> {
  const result = await execGit(args, path, options);
  if (result.exitCode !== 0) {
    const errorDetails = result.stderr.trim() || result.stdout.trim();
    const error = errorMessage
      ? `${errorMessage}. ${errorDetails}`
      : `Git command failed: ${args.join(" ")}. ${errorDetails}`;
    throw new DyadError(error, kind);
  }
}

const gitLineEndingConfigPromises = new Map<string, Promise<void>>();

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "EEXIST"
  );
}

async function configureGitLineEndings(path: string): Promise<void> {
  await execOrThrow(
    ["config", "--local", "core.autocrlf", "false"],
    path,
    "Failed to configure git line ending core.autocrlf",
  );
  await execOrThrow(
    ["config", "--local", "core.eol", "lf"],
    path,
    "Failed to configure git line ending core.eol",
  );
  await execOrThrow(
    ["config", "--local", "core.safecrlf", "warn"],
    path,
    "Failed to configure git line ending core.safecrlf",
  );
}

export async function ensureGitLineEndingPolicy({
  path,
  writeGitattributes = false,
}: GitBaseParams & { writeGitattributes?: boolean }): Promise<void> {
  const gitMetadataPath = pathModule.join(path, ".git");
  if (!fs.existsSync(gitMetadataPath)) {
    return;
  }

  if (writeGitattributes) {
    const gitattributesPath = pathModule.join(path, ".gitattributes");
    try {
      await fsPromises.writeFile(
        gitattributesPath,
        "# Normalize text files to LF so Dyad commits are stable across platforms.\n* text=auto eol=lf\n",
        { flag: "wx" },
      );
      logger.debug(`Created default .gitattributes in ${path}`);
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  const resolvedPath = pathModule.resolve(path);
  const existingPromise = gitLineEndingConfigPromises.get(resolvedPath);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = configureGitLineEndings(path);
  gitLineEndingConfigPromises.set(resolvedPath, promise);
  try {
    await promise;
  } catch (error) {
    gitLineEndingConfigPromises.delete(resolvedPath);
    throw error;
  }
}

/**
 * Prepends git config args for user.name and user.email to the provided args.
 * Automatically fetches the git author from settings.
 * Usage: await withGitAuthor(["commit", "-m", "message"])
 * Returns: ["-c", "user.name=...", "-c", "user.email=...", "commit", "-m", "message"]
 *
 * Do NOT do "--author" because this does not set the committer identity.
 *
 * Doing -c user.name/email sets both the committer and author identity.
 */
export async function withGitAuthor(args: string[]): Promise<string[]> {
  const author = await getGitAuthor();
  return [
    "-c",
    `user.name=${author.name}`,
    "-c",
    `user.email=${author.email}`,
    ...args,
  ];
}

/**
 * Adds a directory to git's global safe.directory list.
 * This is required on Windows when git operations are performed on directories
 * owned by different users.
 * Only works for native git.
 */
export async function gitAddSafeDirectory(directory: string): Promise<void> {
  // Normalize path to use forward slashes (important for Windows compatibility with git)
  directory = normalizePath(directory);

  try {
    // First check if the directory is already in the safe.directory list
    const checkResult = await execGit(
      ["config", "--global", "--get-all", "safe.directory"],
      ".",
    );

    // Parse existing safe directories (one per line), normalizing for comparison
    const existingSafeDirectories = checkResult.stdout
      .split("\n")
      .map((line) => normalizePath(line.trim()))
      .filter((line) => line.length > 0);

    // Check if already present (exact match after normalization)
    if (existingSafeDirectories.includes(directory)) {
      logger.debug(`Safe directory already exists: ${directory}`);
      return;
    }

    const result = await execGit(
      ["config", "--global", "--add", "safe.directory", directory],
      ".",
    );
    if (result.exitCode !== 0) {
      logger.warn(
        `Failed to add safe directory '${directory}': ${result.stderr.trim() || result.stdout.trim()}`,
      );
    } else {
      logger.info(`Added safe directory: ${directory}`);
    }
  } catch (error: any) {
    logger.warn(
      `Failed to add safe directory '${directory}': ${error.message}`,
    );
  }
}

export async function getCurrentCommitHash({
  path,
  ref = "HEAD",
}: GitInitParams): Promise<string> {
  const result = await execGit(["rev-parse", ref], path);
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Failed to resolve ref '${ref}': ${result.stderr.trim() || result.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }
  return result.stdout.trim();
}

export async function gitCommitExists({
  path,
  commitHash,
}: GitBaseParams & { commitHash: string }): Promise<boolean> {
  const result = await execGit(
    ["cat-file", "-e", `${commitHash}^{commit}`],
    path,
  );
  return result.exitCode === 0;
}

export async function isGitStatusClean({
  path,
}: {
  path: string;
}): Promise<boolean> {
  const result = await execGit(["status", "--porcelain"], path);

  if (result.exitCode !== 0) {
    throw new DyadError(
      `Failed to get status: ${result.stderr}`,
      DyadErrorKind.Conflict,
    );
  }

  // If output is empty, working directory is clean (no changes)
  const isClean = result.stdout.trim().length === 0;
  return isClean;
}

export async function hasStagedChanges({
  path,
}: {
  path: string;
}): Promise<boolean> {
  // git diff --cached --quiet exits with 1 if there are staged changes, 0 if none
  const result = await execGit(["diff", "--cached", "--quiet"], path);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new DyadError(
      `Failed to check staged changes: ${result.stderr.trim() || result.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }
  return result.exitCode === 1;
}

export async function gitCommit({
  path,
  message,
  amend,
}: GitCommitParams): Promise<string> {
  // Perform the commit using dugite with -c user.name/email config
  const commitArgs = ["commit", "-m", message];
  if (amend) {
    commitArgs.push("--amend");
  }
  const args = await withGitAuthor(commitArgs);
  await execOrThrow(args, path, "Failed to create commit");
  // Get the new commit hash
  const result = await execGit(["rev-parse", "HEAD"], path);
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Failed to get commit hash: ${result.stderr.trim() || result.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }
  return result.stdout.trim();
}

export async function gitCheckout({
  path,
  ref,
}: GitCheckoutParams): Promise<void> {
  await execOrThrow(["checkout", ref], path, `Failed to checkout ref '${ref}'`);
  return;
}

export async function gitStageToRevert({
  path,
  targetOid,
}: GitStageToRevertParams): Promise<boolean> {
  // Get the current HEAD commit hash
  const currentHeadResult = await execGit(["rev-parse", "HEAD"], path);
  if (currentHeadResult.exitCode !== 0) {
    throw new DyadError(
      `Failed to get current commit: ${currentHeadResult.stderr.trim() || currentHeadResult.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }

  const currentCommit = currentHeadResult.stdout.trim();

  // Safety: refuse to run if user-visible files are dirty. Do this before the
  // currentCommit === targetOid no-op return too; otherwise a no-op restore
  // with staged manual edits could be committed by the caller as a restore
  // commit, and untracked runtime files could trigger an empty commit failure.
  const statusResult = await execGit(["status", "--porcelain"], path);
  if (statusResult.exitCode !== 0) {
    throw new DyadError(
      `Failed to get status: ${statusResult.stderr.trim() || statusResult.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }
  const userVisibleChanges = statusResult.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    // A staged rename shows up as `old -> new`. Examine BOTH sides: a rename
    // from a managed `.dyad/` file to a user-visible destination must still
    // count as a user-visible change, otherwise the following `reset --hard`
    // would silently destroy the destination file. Mirrors the rename
    // handling in `getGitUncommittedFilesWithStatus`.
    .flatMap(getPorcelainPaths)
    .filter(isUserVisibleGitPath);
  if (userVisibleChanges.length > 0) {
    throw new DyadError(
      "Cannot revert: working tree has uncommitted changes.",
      DyadErrorKind.Conflict,
    );
  }

  // If we're already at the target commit, nothing to stage. Managed runtime
  // files are intentionally ignored by the guard above and must not make the
  // caller attempt an empty revert commit.
  if (currentCommit === targetOid) {
    return false;
  }

  // Reset the working directory and index to match the target commit state
  // This effectively undoes all changes since the target commit
  await execOrThrow(
    ["reset", "--hard", targetOid],
    path,
    `Failed to reset to target commit '${targetOid}'`,
  );

  // Reset back to the original HEAD but keep the working directory as it is
  // This stages all the changes needed to revert to the target state
  await execOrThrow(
    ["reset", "--soft", currentCommit],
    path,
    "Failed to reset back to original HEAD",
  );
  return hasStagedChanges({ path });
}

export async function gitAddAll({ path }: GitBaseParams): Promise<void> {
  await ensureGitLineEndingPolicy({ path });
  await execOrThrow(["add", "."], path, "Failed to stage all files");
  return;
}

export async function gitAdd({ path, filepath }: GitFileParams): Promise<void> {
  const normalizedFilepath = normalizePath(filepath);

  // Check if the file is ignored by .gitignore before attempting to stage.
  // This prevents errors when trying to stage files like .env.local.
  // Skip the check when filepath is "." (stage-all), as "." is not a meaningful
  // argument to git check-ignore and could incorrectly skip staging all files.
  if (normalizedFilepath !== ".") {
    let isIgnored = false;
    try {
      isIgnored = await gitIsIgnored({ path, filepath: normalizedFilepath });
    } catch (e) {
      logger.warn(
        `Failed to check if file '${normalizedFilepath}' is ignored, proceeding with staging`,
        e,
      );
    }
    if (isIgnored) {
      logger.debug(
        `Skipping staging of ignored file '${normalizedFilepath}' (file is in .gitignore)`,
      );
      return;
    }
  }

  await ensureGitLineEndingPolicy({ path });
  await execOrThrow(
    ["add", "--", normalizedFilepath],
    path,
    `Failed to stage file '${normalizedFilepath}'`,
  );
}

export async function gitResetFile({
  path,
  filepath,
}: GitFileParams): Promise<void> {
  const normalizedFilepath = normalizePath(filepath);
  await execOrThrow(
    ["reset", "HEAD", "--", normalizedFilepath],
    path,
    `Failed to unstage file '${normalizedFilepath}'`,
  );
}

export async function gitReset({ path }: GitBaseParams): Promise<void> {
  // Reset the staging area to match HEAD (unstage files but keep working directory changes)
  await execOrThrow(["reset", "HEAD"], path, "Failed to reset staging area");
}

export async function gitDiscardAllChanges({
  path,
}: GitBaseParams): Promise<void> {
  // Reset all tracked files (index + working tree) to HEAD state
  await execOrThrow(
    ["reset", "--hard", "HEAD"],
    path,
    "Failed to reset to HEAD",
  );
  // Remove untracked files and directories
  await execOrThrow(["clean", "-fd"], path, "Failed to remove untracked files");
}

export async function gitInit({
  path,
  ref = "main",
}: GitInitParams): Promise<void> {
  await execOrThrow(
    ["init", "-b", ref],
    path,
    `Failed to initialize git repository with branch '${ref}'`,
  );
}

export async function gitRemove({
  path,
  filepath,
}: GitFileParams): Promise<void> {
  await execOrThrow(
    ["rm", "-f", "--", filepath],
    path,
    `Failed to remove file '${filepath}'`,
  );
}

export async function getGitUncommittedFiles({
  path,
}: GitBaseParams): Promise<string[]> {
  const result = await execGit(["status", "--porcelain"], path);
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Failed to get uncommitted files: ${result.stderr.trim() || result.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }
  return (
    result.stdout
      .toString()
      .split("\n")
      .filter((line) => line.trim() !== "")
      // Decode git's C-style path quoting (including `\NNN` octal escapes for
      // non-ASCII/control bytes) and expand rename entries into both sides, so
      // non-ASCII paths are returned verbatim and `.dyad/` filtering matches.
      .flatMap(getPorcelainPaths)
      .filter(isUserVisibleGitPath)
  );
}

function countLines(content: string): number {
  if (!content) return 0;
  const lines = content.split("\n");
  // A single trailing newline terminates the last line rather than starting a
  // new empty one, so drop it to match how git counts lines.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function lcsLength(a: string[], b: string[]): number {
  // `b` is the inner (shorter) dimension to keep the rolling arrays small.
  const bLen = b.length;
  let prev: number[] = Array.from({ length: bLen + 1 }, () => 0);
  let curr: number[] = Array.from({ length: bLen + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= bLen; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = curr[j - 1] >= prev[j] ? curr[j - 1] : prev[j];
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return prev[bLen];
}

function approximateLineDiff(
  oldLines: string[],
  newLines: string[],
): { additions: number; deletions: number } {
  // For very large files, approximate common lines via multiset intersection
  // instead of a full LCS to avoid quadratic time/memory.
  const counts = new Map<string, number>();
  for (const line of oldLines) counts.set(line, (counts.get(line) ?? 0) + 1);
  let common = 0;
  for (const line of newLines) {
    const remaining = counts.get(line);
    if (remaining && remaining > 0) {
      counts.set(line, remaining - 1);
      common++;
    }
  }
  return {
    additions: newLines.length - common,
    deletions: oldLines.length - common,
  };
}

/**
 * Counts added/deleted lines between two versions of a file, matching the
 * insertions/deletions reported by `git diff --numstat` (both equal the line
 * count minus the longest common subsequence of lines).
 */
export function countChangedLines(
  oldContent: string,
  newContent: string,
): { additions: number; deletions: number } {
  if (oldContent === newContent) return { additions: 0, deletions: 0 };
  const oldLines = oldContent ? oldContent.split("\n") : [];
  const newLines = newContent ? newContent.split("\n") : [];
  if (oldLines.length && oldLines[oldLines.length - 1] === "") oldLines.pop();
  if (newLines.length && newLines[newLines.length - 1] === "") newLines.pop();

  const n = oldLines.length;
  const m = newLines.length;
  if (n === 0) return { additions: m, deletions: 0 };
  if (m === 0) return { additions: 0, deletions: n };
  if (n * m > 4_000_000) return approximateLineDiff(oldLines, newLines);

  const lcs =
    m <= n ? lcsLength(oldLines, newLines) : lcsLength(newLines, oldLines);
  const result = { additions: m - lcs, deletions: n - lcs };
  // A file that differs only by whether it ends in a trailing newline still
  // counts as one changed line in `git diff --numstat` (the final line is shown
  // as removed and re-added). The trailing-newline stripping above discards that
  // distinction, so restore it explicitly when nothing else changed.
  if (
    result.additions === 0 &&
    result.deletions === 0 &&
    oldContent.endsWith("\n") !== newContent.endsWith("\n")
  ) {
    return { additions: 1, deletions: 1 };
  }
  return result;
}

async function readWorkingFileContent(
  dir: string,
  filePath: string,
): Promise<string> {
  try {
    // Use safeJoin (rather than a bare path.join) so a path that would escape
    // the app directory is rejected instead of read, providing defense-in-depth
    // consistency with the IPC diff handler.
    return await fsPromises.readFile(safeJoin(dir, filePath), "utf-8");
  } catch {
    return "";
  }
}

// Skip diffing files larger than this. Line stats are polled every few seconds
// (see LINE_STATS_CONCURRENCY), so reading big lockfiles, minified bundles, or
// binary assets into memory on each poll would repeatedly spike memory and
// stall the main process. Such files still appear in the list; they just report
// 0/0 instead of exact counts.
const MAX_STATS_FILE_BYTES = 512 * 1024; // 512 KB

// A decoded file that contains a NUL byte is almost certainly binary; computing
// a line diff on it is meaningless (and potentially huge), so we skip it.
function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

async function getFileLineStats({
  path,
  file,
}: {
  path: string;
  file: { path: string; status: UncommittedFileStatus; oldPath?: string };
}): Promise<{ additions: number; deletions: number }> {
  try {
    if (file.status === "deleted") {
      const head = await getFileAtCommit({
        path,
        filePath: file.path,
        commitHash: "HEAD",
      });
      if (
        head == null ||
        head.length > MAX_STATS_FILE_BYTES ||
        looksBinary(head)
      )
        return { additions: 0, deletions: 0 };
      return { additions: 0, deletions: countLines(head) };
    }

    // Guard against reading a very large working-tree file into memory on every
    // status poll.
    try {
      const stat = await fsPromises.stat(safeJoin(path, file.path));
      if (stat.size > MAX_STATS_FILE_BYTES) {
        return { additions: 0, deletions: 0 };
      }
    } catch {
      // Can't stat (e.g. deleted between status and here) — fall through; the
      // read below will handle it.
    }

    const newContent = await readWorkingFileContent(path, file.path);
    if (looksBinary(newContent)) return { additions: 0, deletions: 0 };

    // A rename keeps the original content under its old path at HEAD; diff
    // old→new so a pure rename reports 0/0 rather than all-added. A rename with
    // no known old path (or any other status) falls back to the current path.
    const headPath =
      file.status === "renamed" && file.oldPath ? file.oldPath : file.path;
    const head = await getFileAtCommit({
      path,
      filePath: headPath,
      commitHash: "HEAD",
    });
    if (head == null)
      return { additions: countLines(newContent), deletions: 0 };
    if (head.length > MAX_STATS_FILE_BYTES || looksBinary(head))
      return { additions: 0, deletions: 0 };
    return countChangedLines(head, newContent);
  } catch (error) {
    logger.warn(`Failed to compute line stats for '${file.path}'`, error);
    return { additions: 0, deletions: 0 };
  }
}

// Cap how many files we read/diff at once. This function is polled every few
// seconds, so an unbounded Promise.all over every uncommitted file could spike
// CPU/memory or exhaust file descriptors after a large refactor. Processing in
// bounded batches keeps the main process responsive while still parallelizing.
const LINE_STATS_CONCURRENCY = 10;

async function attachLineStats({
  path,
  files,
}: {
  path: string;
  files: Array<{
    path: string;
    status: UncommittedFileStatus;
    oldPath?: string;
  }>;
}): Promise<UncommittedFile[]> {
  const results: UncommittedFile[] = [];
  for (let i = 0; i < files.length; i += LINE_STATS_CONCURRENCY) {
    const batch = files.slice(i, i + LINE_STATS_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (file) => ({
        ...file,
        ...(await getFileLineStats({ path, file })),
      })),
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Decodes a path as printed by `git status --porcelain`. Git prints paths
 * containing "unusual" bytes (spaces are fine, but non-ASCII, control chars,
 * quotes, or backslashes trigger it) wrapped in double quotes with C-style
 * escapes — e.g. `café.txt` becomes `"caf\303\251.txt"`. Passing that literal
 * string to the filesystem would fail to find the file, so decode it back to
 * the real path. Unquoted paths are returned unchanged.
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = String.fromCodePoint(body.codePointAt(i)!);
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf-8"));
      i += ch.length - 1;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    if (next >= "0" && next <= "7") {
      // Octal escape \nnn (1-3 digits) => a single raw byte.
      let oct = "";
      let j = i + 1;
      while (
        j < body.length &&
        oct.length < 3 &&
        body[j] >= "0" &&
        body[j] <= "7"
      ) {
        oct += body[j];
        j++;
      }
      bytes.push(parseInt(oct, 8) & 0xff);
      i = j - 1;
      continue;
    }
    if (next in PORCELAIN_C_ESCAPES) {
      bytes.push(PORCELAIN_C_ESCAPES[next]);
    } else {
      bytes.push(...Buffer.from(next, "utf-8"));
    }
    i += 1;
  }
  return Buffer.from(bytes).toString("utf-8");
}

/**
 * Parses one line of `git status --porcelain` output into a path + status,
 * unquoting C-quoted paths and preserving the original path for renames so the
 * HEAD blob can still be located. Returns null for blank lines.
 */
function parsePorcelainStatusLine(line: string): {
  path: string;
  status: UncommittedFileStatus;
  oldPath?: string;
} | null {
  if (line.trim() === "") return null;
  // Git status --porcelain format: "XY path" (X = staged, Y = unstaged status).
  const statusCode = line.substring(0, 2);
  const rest = line.slice(3).trim();

  // Renames are printed as "old -> new"; each side may be quoted independently.
  if (statusCode.startsWith("R")) {
    const arrowIndex = rest.indexOf(" -> ");
    if (arrowIndex !== -1) {
      return {
        path: unquoteGitPath(rest.slice(arrowIndex + 4).trim()),
        oldPath: unquoteGitPath(rest.slice(0, arrowIndex).trim()),
        status: "renamed",
      };
    }
    return { path: unquoteGitPath(rest), status: "renamed" };
  }

  const path = unquoteGitPath(rest);
  // Check deleted first: for status code "AD" (added to index, then deleted from
  // working directory) the file no longer exists, so report it as deleted.
  let status: UncommittedFileStatus;
  if (statusCode.includes("D")) {
    status = "deleted";
  } else if (statusCode === "??" || statusCode.includes("A")) {
    status = "added";
  } else {
    status = "modified";
  }
  return { path, status };
}

/**
 * Get uncommitted files with their status (added, modified, deleted, renamed)
 * along with per-file added/deleted line counts relative to HEAD.
 * This parses git status --porcelain output to determine the file status.
 */
export async function getGitUncommittedFilesWithStatus({
  path,
}: GitBaseParams): Promise<UncommittedFile[]> {
  const result = await execGit(["status", "--porcelain"], path);
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Failed to get uncommitted files: ${result.stderr.trim() || result.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }
  const files = result.stdout
    .toString()
    .split("\n")
    .map(parsePorcelainStatusLine)
    .filter(
      (
        file,
      ): file is {
        path: string;
        status: UncommittedFileStatus;
        oldPath?: string;
      } => file !== null && isUserVisibleGitPath(file.path),
    );
  return attachLineStats({ path, files });
}

export async function getFileAtCommit({
  path,
  filePath,
  commitHash,
}: GitFileAtCommitParams): Promise<string | null> {
  try {
    const result = await execGit(["show", `${commitHash}:${filePath}`], path);
    if (result.exitCode !== 0) {
      // File doesn't exist at this commit or other error
      return null;
    }
    return result.stdout;
  } catch (error: any) {
    logger.error(
      `Error getting file at commit ${commitHash}: ${error.message}`,
    );
    // File doesn't exist at this commit
    return null;
  }
}

/**
 * Resolves the parent commit oid of the given commit, or null if the commit is
 * a root commit (no parents). Used to look up the "before" content of a file.
 */
async function getParentCommitOid({
  path,
  commitHash,
}: GitListChangedFilesParams): Promise<string | null> {
  // `--verify --quiet` exits non-zero (without erroring) for a
  // root commit, where `<commit>^` does not resolve.
  const result = await execGit(
    ["rev-parse", "--verify", "--quiet", `${commitHash}^`],
    path,
  );
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.toString().trim() || null;
}

/**
 * Returns the content of a file as it existed in the PARENT of the given commit,
 * i.e. the "before" side of the commit's diff. Returns null when the commit is a
 * root commit (no parent) or the file did not exist in the parent.
 *
 */
export async function getOldFileContent({
  path,
  filePath,
  commitHash,
}: GitFileAtCommitParams): Promise<string | null> {
  return getFileAtCommit({
    path,
    filePath,
    commitHash: `${commitHash}^`,
  });
}

/**
 * Lists the files changed in a single commit (compared to its parent), with the
 * kind of change. Renames are decomposed into a delete + add pair so the result
 * maps cleanly onto per-path content lookups. Filters out files that are not
 * user-visible (e.g. .dyad/, pnpm-workspace.yaml) for parity with the rest of
 * the file.
 */
export async function getChangedFilesForCommit({
  path,
  commitHash,
}: GitListChangedFilesParams): Promise<GitChangedFile[]> {
  // Diff the commit explicitly against its FIRST parent so the result matches
  // the first-parent semantics. For merge commits
  // `-m --first-parent` is NOT sufficient: -m still reports files that merely
  // differ from the *second* parent even though they were already present on
  // the first parent, making them appear as spurious additions/modifications.
  // Diffing the explicit `<parent> <commit>` range avoids that. Root commits
  // have no parent, so fall back to --root (which shows their files as adds).
  // --no-renames decomposes renames into D + A pairs.
  // -z gives NUL-delimited output for robust parsing of paths with spaces.
  const parentOid = await getParentCommitOid({ path, commitHash });
  const result = await execGit(
    [
      "diff-tree",
      "--no-commit-id",
      "--no-renames",
      "--name-status",
      "-r",
      "-z",
      ...(parentOid ? [parentOid, commitHash] : ["--root", commitHash]),
    ],
    path,
  );
  if (result.exitCode !== 0) {
    throw new DyadError(
      result.stderr.toString() || result.stdout.toString(),
      DyadErrorKind.External,
    );
  }

  // Output is a flat NUL-delimited stream: status, path, status, path, ...
  const tokens = result.stdout.split("\0").filter((token) => token.length > 0);
  const changes: GitChangedFile[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i];
    const filePath = tokens[i + 1];
    const type = mapDiffStatusToChangeType(status);
    if (type && isUserVisibleGitPath(filePath)) {
      changes.push({ path: filePath, type });
    }
  }
  return changes;
}

function mapDiffStatusToChangeType(status: string): GitChangedFileType | null {
  // status may be like "A", "M", "D", "T", or "R100"/"C100" for rename/copy
  // (which shouldn't occur with --no-renames, but handle defensively).
  const code = status[0];
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "M":
    case "T":
      return "modified";
    default:
      return null;
  }
}

export async function gitListBranches({
  path,
}: GitBaseParams): Promise<string[]> {
  const result = await execGit(["branch", "--list"], path);

  if (result.exitCode !== 0) {
    throw new DyadError(result.stderr.toString(), DyadErrorKind.Conflict);
  }
  // Parse output:
  // e.g. "* main\n  feature/login"
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.replace("*", "").trim())
    .filter((line) => line.length > 0);
}

export async function gitListRemoteBranches({
  path,
  remote = "origin",
}: GitBaseParams & { remote?: string }): Promise<string[]> {
  const result = await execGit(["branch", "-r", "--list"], path);

  if (result.exitCode !== 0) {
    throw new DyadError(result.stderr.toString(), DyadErrorKind.Conflict);
  }
  // Parse output:
  // e.g. "  origin/main\n  origin/feature/login\n  upstream/develop"
  // Only return branches from the specified remote
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${remote}/`)) {
        return trimmed.substring(`${remote}/`.length);
      }
      return null;
    })
    .filter(
      (line): line is string =>
        line !== null && line.length > 0 && !line.includes("HEAD"),
    );
}

export async function gitRenameBranch({
  path,
  oldBranch,
  newBranch,
}: GitBranchRenameParams): Promise<void> {
  // git branch -m oldBranch newBranch
  const result = await execGit(["branch", "-m", oldBranch, newBranch], path);
  if (result.exitCode !== 0) {
    throw new DyadError(result.stderr.toString(), DyadErrorKind.Conflict);
  }
}

export async function gitClone({
  path,
  url,
  accessToken,
  singleBranch = true,
  depth,
}: GitCloneParams): Promise<void> {
  // Dugite version (real Git)
  // Strip any embedded auth from URL; credentials are injected per-invocation
  // via environment variables so they never reach .git/config.
  const cleanUrl = url.replace(/https:\/\/[^@]+@/, "https://");
  const args = ["clone"];
  if (depth && depth > 0) {
    args.push("--depth", String(depth));
  }
  if (singleBranch) {
    args.push("--single-branch");
  }
  args.push("--", cleanUrl, path);
  const result = await execGit(args, ".", {
    env: getGitNetworkEnv(accessToken),
  });

  if (result.exitCode !== 0) {
    throw new DyadError(result.stderr.toString(), DyadErrorKind.Conflict);
  }
}

export async function gitSetRemoteUrl({
  path,
  remoteUrl,
}: GitSetRemoteUrlParams): Promise<void> {
  // Validate remoteUrl to prevent argument injection attacks
  // URLs starting with "-" could be interpreted as command-line options
  if (remoteUrl.startsWith("-")) {
    throw new DyadError("Invalid remote URL", DyadErrorKind.Validation);
  }

  // Dugite version
  try {
    // Try to add the remote
    const result = await execGit(["remote", "add", "origin", remoteUrl], path);

    // If remote already exists, update it instead
    if (result.exitCode !== 0 && result.stderr.includes("already exists")) {
      const updateResult = await execGit(
        ["remote", "set-url", "origin", remoteUrl],
        path,
      );

      if (updateResult.exitCode !== 0) {
        throw new DyadError(
          `Failed to update remote: ${updateResult.stderr}`,
          DyadErrorKind.Conflict,
        );
      }
    } else if (result.exitCode !== 0) {
      // Handle other errors
      throw new DyadError(
        `Failed to add remote: ${result.stderr}`,
        DyadErrorKind.Conflict,
      );
    }
  } catch (error: any) {
    logger.error("Error setting up remote:", error);
    throw error; // or handle as needed
  }
}

export async function gitPush({
  path,
  branch,
  accessToken,
  force,
  forceWithLease,
}: GitPushParams): Promise<void> {
  const targetBranch = branch || "main";

  try {
    const args = ["push", "origin", `${targetBranch}:${targetBranch}`];
    if (forceWithLease) {
      args.push("--force-with-lease");
    } else if (force) {
      args.push("--force");
    }
    const result = await execGit(args, path, {
      env: getGitNetworkEnv(accessToken),
    });
    if (result.exitCode !== 0) {
      const errorMsg = result.stderr.toString() || result.stdout.toString();
      throw new DyadError(
        `Git push failed: ${errorMsg}`,
        DyadErrorKind.Conflict,
      );
    }
    return;
  } catch (error: any) {
    logger.error("Error during git push:", error);
    throw new DyadError(
      `Git push failed: ${error.message}`,
      DyadErrorKind.Conflict,
    );
  }
}

export async function gitRebaseAbort({ path }: GitBaseParams): Promise<void> {
  await execOrThrow(["rebase", "--abort"], path, "Failed to abort rebase");
}

export async function gitRebaseContinue({
  path,
}: GitBaseParams): Promise<void> {
  // Use withGitAuthor since rebase --continue needs to create commits
  // and requires user.name and user.email
  const args = await withGitAuthor(["rebase", "--continue"]);
  await execOrThrow(
    args,
    path,
    "Failed to continue rebase. Make sure conflicts are resolved and changes are staged.",
  );
}

export async function gitRebase({
  path,
  branch,
}: {
  path: string;
  branch: string;
}): Promise<void> {
  // Use withGitAuthor since rebase replays commits and needs user.name and user.email
  // to set the committer identity on the rebased commits
  const args = await withGitAuthor(["rebase", `origin/${branch}`]);
  await execOrThrow(
    args,
    path,
    `Failed to rebase onto origin/${branch}. Make sure you have a clean working directory and the remote branch exists.`,
  );
}

export async function gitMergeAbort({ path }: GitBaseParams): Promise<void> {
  await execOrThrow(["merge", "--abort"], path, "Failed to abort merge");
}

export async function gitCurrentBranch({
  path,
}: GitBaseParams): Promise<string | null> {
  // Dugite version
  const result = await execGit(["branch", "--show-current"], path);
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Failed to get current branch: ${result.stderr.trim() || result.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }
  const branch = result.stdout.trim() || null;
  return branch;
}

export async function gitLog({
  path,
  depth = 100_000,
  ref = "HEAD",
}: GitLogParams): Promise<GitCommit[]> {
  return await gitLogNative(path, depth, ref);
}

export async function gitIsIgnored({
  path,
  filepath,
}: GitFileParams): Promise<boolean> {
  // Dugite version
  // git check-ignore file
  const result = await execGit(["check-ignore", "--", filepath], path);

  // If exitCode == 0 → file is ignored
  if (result.exitCode === 0) return true;

  // If exitCode == 1 → not ignored
  if (result.exitCode === 1) return false;

  // Other exit codes are actual errors
  throw new DyadError(result.stderr.toString(), DyadErrorKind.Conflict);
}

/**
 * Lists all of the files in a git repository, such that:
 * - Both tracked and untracked files are included.
 * - Gitignored files/directories are excluded.
 * - We can exclude additional files/directories as needed.
 */
export async function gitListFilesNative({
  path,
  excludedFiles,
  excludedDirs,
}: GitListFilesParams): Promise<string[]> {
  const result = await execGit(
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ".",
      ...excludedFiles.map((file) => `:(exclude,glob)**/${file}`),
      ...excludedDirs.map((dir) => `:(exclude,glob)**/${dir}/**`),
    ],
    path,
  );
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Failed to list files: ${result.stderr.trim() || result.stdout.trim()}`,
      DyadErrorKind.Conflict,
    );
  }
  return result.stdout.split("\0").filter(Boolean).map(normalizePath);
}

export async function gitLogNative(
  path: string,
  depth = 100_000,
  ref = "HEAD",
): Promise<GitCommit[]> {
  // Use git log with custom format to get all data in a single process
  // Format: %H = commit hash, %at = author timestamp (unix), %B = raw body (message)
  // Using null byte as field separator and custom delimiter between commits
  const logArgs = [
    "log",
    "--max-count",
    String(depth),
    "--format=%H%x00%at%x00%B%x00---END-COMMIT---",
    ref,
    "--",
  ];

  const logResult = await execGit(logArgs, path);

  if (logResult.exitCode !== 0) {
    throw new DyadError(logResult.stderr.toString(), DyadErrorKind.Conflict);
  }

  const output = logResult.stdout.toString().trim();
  if (!output) {
    return [];
  }

  // Split by commit delimiter (without newline since trim() removes trailing newline)
  const commitChunks = output.split("\x00---END-COMMIT---").filter(Boolean);
  const entries: GitCommit[] = [];

  for (const chunk of commitChunks) {
    // Split by null byte: [oid, timestamp, message]
    const parts = chunk.split("\x00");
    if (parts.length >= 3) {
      const oid = parts[0].trim();
      const timestamp = Number(parts[1]);
      // Message is everything after the second null byte, may contain null bytes itself
      const message = parts.slice(2).join("\x00");

      entries.push({
        oid,
        commit: {
          message: message,
          author: {
            timestamp: timestamp,
          },
        },
      });
    }
  }

  return entries;
}

const AGENT_GIT_RESULT_LIMIT_BYTES = 64 * 1024;
const AGENT_GIT_EXEC_BUFFER_BYTES = AGENT_GIT_RESULT_LIMIT_BYTES * 2;
const AGENT_GIT_SOURCE_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
const AGENT_GIT_MAX_DIFF_PATHS = 500;
const AGENT_GIT_MAX_STATUS_PATHS = 500;
const AGENT_GIT_STATUS_PATH_BUDGET_BYTES = AGENT_GIT_RESULT_LIMIT_BYTES - 4096;
// Keeps diff pathspec argv well under the ~32 KiB Windows command-line limit.
const AGENT_GIT_DIFF_PATH_ARGV_BUDGET_BYTES = 24 * 1024;
const AGENT_GIT_TRUNCATION_NOTICE =
  "\n\n[Output truncated at 64 KiB. Narrow the request with a path, line range, or smaller commit count.]";

interface AgentGitExecutionResult extends IGitStringResult {
  truncated: boolean;
}

function agentGitEnvironment(): Record<string, string> {
  return {
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function execAgentGit(
  args: string[],
  repoPath: string,
  options: {
    maxBuffer?: number;
    readOnly?: boolean;
    encoding?: BufferEncoding;
    stdin?: string | Buffer;
    allowTruncation?: boolean;
  } = {},
): Promise<AgentGitExecutionResult> {
  const globalArgs = [
    "--no-pager",
    "--no-replace-objects",
    "--literal-pathspecs",
    ...(options.readOnly === false ? [] : ["--no-optional-locks"]),
    "-c",
    "core.fsmonitor=false",
    ...args,
  ];
  try {
    const result = await execGit(globalArgs, repoPath, {
      encoding: options.encoding,
      env: agentGitEnvironment(),
      maxBuffer: options.maxBuffer ?? AGENT_GIT_EXEC_BUFFER_BYTES,
      stdin: options.stdin,
    });
    return { ...result, truncated: false };
  } catch (error) {
    if (
      error instanceof ExecError &&
      error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" &&
      error.message.includes("stdout maxBuffer") &&
      options.allowTruncation === true
    ) {
      return {
        stdout: String(error.stdout),
        stderr: String(error.stderr),
        exitCode: 0,
        truncated: true,
      };
    }
    throw error;
  }
}

function agentGitErrorDetails(result: IGitStringResult): string {
  return result.stderr.trim() || result.stdout.trim() || "Unknown Git error";
}

function assertAgentGitSuccess(
  result: IGitStringResult,
  message: string,
  kind: DyadErrorKind = DyadErrorKind.Conflict,
): void {
  if (result.exitCode !== 0) {
    throw new DyadError(`${message}: ${agentGitErrorDetails(result)}`, kind);
  }
}

function boundAgentGitContent(
  content: string,
  alreadyTruncated = false,
): AgentGitTextResult {
  const hadTruncationNotice = content.endsWith(AGENT_GIT_TRUNCATION_NOTICE);
  const unannotatedContent = hadTruncationNotice
    ? content.slice(0, -AGENT_GIT_TRUNCATION_NOTICE.length)
    : content;
  const contentLimitBytes =
    AGENT_GIT_RESULT_LIMIT_BYTES -
    Buffer.byteLength(AGENT_GIT_TRUNCATION_NOTICE, "utf8");
  const bytes = Buffer.from(unannotatedContent, "utf8");
  let end = Math.min(bytes.length, contentLimitBytes);
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  const boundedContent = bytes.subarray(0, end).toString("utf8");
  const boundedTruncated = bytes.length > contentLimitBytes;
  const truncated = alreadyTruncated || hadTruncationNotice || boundedTruncated;
  return {
    content: boundedContent + (truncated ? AGENT_GIT_TRUNCATION_NOTICE : ""),
    truncated,
  };
}

function assertAgentGitRevisionInput(revision: string): void {
  if (
    revision.length === 0 ||
    revision.length > 256 ||
    revision.startsWith("-") ||
    revision.includes("..") ||
    /[\0\r\n]/.test(revision)
  ) {
    throw new DyadError(
      `Invalid Git revision: ${JSON.stringify(revision)}`,
      DyadErrorKind.Validation,
    );
  }
}

export function normalizeAgentGitPath(
  repoPath: string,
  filePath: string,
): string {
  if (
    filePath.length === 0 ||
    filePath.length > 4096 ||
    /[\0\r\n]/.test(filePath) ||
    /(^|[\\/])\.\.([\\/]|$)/.test(filePath)
  ) {
    throw new DyadError(
      `Invalid Git path: ${JSON.stringify(filePath)}`,
      DyadErrorKind.Validation,
    );
  }
  const fullPath = safeJoin(repoPath, filePath);
  const relativePath = normalizePath(
    pathModule.relative(
      pathModule.resolve(repoPath),
      pathModule.resolve(fullPath),
    ),
  ).replace(/^\.\//, "");
  if (!relativePath || relativePath === ".") {
    throw new DyadError(
      "A file or directory path inside the app is required",
      DyadErrorKind.Validation,
    );
  }
  return relativePath;
}

function normalizeAgentGitFilterPath(
  repoPath: string,
  filePath: string | undefined,
): string | undefined {
  return filePath === "."
    ? undefined
    : filePath
      ? normalizeAgentGitPath(repoPath, filePath)
      : undefined;
}

export async function resolveAgentGitCommit({
  path,
  revision,
}: GitBaseParams & { revision: string }): Promise<string> {
  assertAgentGitRevisionInput(revision);
  const result = await execAgentGit(
    ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
    path,
  );
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Git revision not found: ${revision}`,
      DyadErrorKind.NotFound,
    );
  }
  const oid = result.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(oid)) {
    throw new DyadError(
      `Git returned an invalid commit ID for revision: ${revision}`,
      DyadErrorKind.External,
    );
  }
  return oid;
}

function addStatusPath(target: Set<string>, filePath: string): void {
  const normalized = normalizePath(filePath);
  if (isUserVisibleGitPath(normalized)) {
    target.add(normalized);
  }
}

export async function getAgentGitStatus({
  path,
}: GitBaseParams): Promise<AgentGitStatus> {
  const result = await execAgentGit(
    ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
    path,
    { allowTruncation: true },
  );
  assertAgentGitSuccess(result, "Failed to inspect Git status");

  let branch: string | null = null;
  let head: string | null = null;
  let detached = false;
  const staged = new Set<string>();
  const unstaged = new Set<string>();
  const untracked = new Set<string>();
  const conflicted = new Set<string>();
  const rawRecords = result.stdout.split("\0");
  if (result.truncated && !result.stdout.endsWith("\0")) {
    rawRecords.pop();
  }
  const records = rawRecords.filter(Boolean);

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.startsWith("# branch.oid ")) {
      const value = record.slice("# branch.oid ".length);
      head = value === "(initial)" ? null : value;
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const value = record.slice("# branch.head ".length);
      detached = value === "(detached)";
      branch = detached ? null : value;
      continue;
    }
    if (record.startsWith("? ")) {
      addStatusPath(untracked, record.slice(2));
      continue;
    }
    if (record.startsWith("u ")) {
      addStatusPath(conflicted, record.split(" ").slice(10).join(" "));
      continue;
    }
    if (!record.startsWith("1 ") && !record.startsWith("2 ")) {
      continue;
    }

    const fields = record.split(" ");
    const isRename = record.startsWith("2 ");
    const statusCode = fields[1] ?? "..";
    const filePath = fields.slice(isRename ? 9 : 8).join(" ");
    if (isRename) {
      index += 1; // The following NUL field is the original path.
    }
    if (statusCode[0] !== ".") addStatusPath(staged, filePath);
    if (statusCode[1] !== ".") addStatusPath(unstaged, filePath);
  }

  // Share one response budget across categories so the complete structured
  // result stays bounded. The call order below intentionally prioritizes
  // conflicts, then staged and unstaged changes, ahead of untracked files.
  let remainingPaths = AGENT_GIT_MAX_STATUS_PATHS;
  let remainingBytes = AGENT_GIT_STATUS_PATH_BUDGET_BYTES;
  let truncated = result.truncated;
  const sortedAndBounded = (values: Set<string>) => {
    const output: string[] = [];
    const sorted = [...values].sort();
    for (const value of sorted) {
      const pathBytes = Buffer.byteLength(JSON.stringify(value), "utf8") + 2;
      if (remainingPaths === 0 || pathBytes > remainingBytes) {
        truncated = true;
        continue;
      }
      output.push(value);
      remainingPaths -= 1;
      remainingBytes -= pathBytes;
    }
    return output;
  };
  return {
    branch,
    head,
    detached,
    conflicted: sortedAndBounded(conflicted),
    staged: sortedAndBounded(staged),
    unstaged: sortedAndBounded(unstaged),
    untracked: sortedAndBounded(untracked),
    truncated,
  };
}

interface DiffEntry {
  status: string;
  paths: string[];
}

async function listAgentDiffEntries({
  path,
  comparisonArgs,
  filePath,
}: {
  path: string;
  comparisonArgs: string[];
  filePath?: string;
}): Promise<{ entries: DiffEntry[]; truncated: boolean }> {
  const result = await execAgentGit(
    [
      "diff",
      "--name-status",
      "-z",
      "--no-ext-diff",
      "--no-textconv",
      ...comparisonArgs,
    ],
    path,
    { maxBuffer: 1024 * 1024, allowTruncation: true },
  );
  assertAgentGitSuccess(result, "Failed to list changed Git paths");
  const rawFields = result.stdout.split("\0");
  if (result.truncated && !result.stdout.endsWith("\0")) {
    rawFields.pop();
  }
  const fields = rawFields.filter(Boolean);
  const entries: DiffEntry[] = [];
  let incomplete = false;
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    if (fields.length - index < pathCount) {
      incomplete = true;
      break;
    }
    const paths = fields.slice(index, index + pathCount);
    index += pathCount;
    const normalizedPaths = paths.map(normalizePath);
    if (
      !filePath ||
      normalizedPaths.some(
        (entryPath) =>
          entryPath === filePath || entryPath.startsWith(`${filePath}/`),
      )
    ) {
      entries.push({ status, paths: normalizedPaths });
    }
  }
  return { entries, truncated: result.truncated || incomplete };
}

async function renderSafeAgentDiff({
  path,
  comparisonArgs,
  filePath,
  contextLines,
}: {
  path: string;
  comparisonArgs: string[];
  filePath?: string;
  contextLines: number;
}): Promise<AgentGitTextResult> {
  const discovery = await listAgentDiffEntries({
    path,
    comparisonArgs,
    filePath,
  });
  const sensitive: string[] = [];
  const allowedPathGroups: string[][] = [];
  for (const entry of discovery.entries) {
    if (
      entry.paths.some(isDotenvFilePath) ||
      entry.paths.some((entryPath) => !isAgentGitPatchVisiblePath(entryPath))
    ) {
      sensitive.push(entry.paths.at(-1) ?? entry.paths[0]);
      continue;
    }
    // Git needs both sides of a rename/copy pathspec to preserve its R/C
    // classification when rendering the patch.
    allowedPathGroups.push(entry.paths);
  }

  const uniquePaths = new Set(allowedPathGroups.flat());
  const uniqueAllowed: string[] = [];
  const includedPaths = new Set<string>();
  let remainingArgvBytes = AGENT_GIT_DIFF_PATH_ARGV_BUDGET_BYTES;
  for (const pathGroup of allowedPathGroups) {
    const newPaths = [
      ...new Set(
        pathGroup.filter((entryPath) => !includedPaths.has(entryPath)),
      ),
    ];
    const groupBytes = newPaths.reduce(
      (total, entryPath) => total + Buffer.byteLength(entryPath, "utf8") + 1,
      0,
    );
    if (
      uniqueAllowed.length + newPaths.length > AGENT_GIT_MAX_DIFF_PATHS ||
      groupBytes > remainingArgvBytes
    ) {
      continue;
    }
    uniqueAllowed.push(...newPaths);
    for (const entryPath of newPaths) includedPaths.add(entryPath);
    remainingArgvBytes -= groupBytes;
  }
  const omittedByCount =
    discovery.truncated || uniquePaths.size > uniqueAllowed.length;
  let patch = "";
  let truncated = omittedByCount;
  if (uniqueAllowed.length > 0) {
    const result = await execAgentGit(
      [
        "diff",
        `--unified=${contextLines}`,
        "--no-ext-diff",
        "--no-textconv",
        ...comparisonArgs,
        "--",
        ...uniqueAllowed,
      ],
      path,
      { allowTruncation: true },
    );
    assertAgentGitSuccess(result, "Failed to render Git diff");
    patch = result.stdout;
    truncated ||= result.truncated;
  }

  const notices: string[] = [];
  if (sensitive.length > 0) {
    notices.push(
      `[Diff omitted for sensitive or Dyad-managed paths: ${[...new Set(sensitive)].join(", ")}]`,
    );
  }
  if (omittedByCount) {
    notices.push(
      `[Changed-path discovery was truncated or limited to ${AGENT_GIT_MAX_DIFF_PATHS} paths. Narrow the request with path.]`,
    );
  }
  return boundAgentGitContent(
    [notices.join("\n"), patch].filter(Boolean).join("\n\n"),
    truncated,
  );
}

async function hasAgentGitHead(path: string): Promise<boolean> {
  const result = await execAgentGit(
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    path,
  );
  return result.exitCode === 0;
}

export async function getAgentGitDiff({
  path,
  scope = "all",
  filePath,
  contextLines = 3,
}: GitBaseParams & {
  scope?: AgentGitDiffScope;
  filePath?: string;
  contextLines?: number;
}): Promise<AgentGitTextResult> {
  const normalizedPath = normalizeAgentGitFilterPath(path, filePath);
  const hasHead = await hasAgentGitHead(path);
  if (scope === "unstaged") {
    return renderSafeAgentDiff({
      path,
      comparisonArgs: [],
      filePath: normalizedPath,
      contextLines,
    });
  }
  if (scope === "staged") {
    return renderSafeAgentDiff({
      path,
      comparisonArgs: ["--cached"],
      filePath: normalizedPath,
      contextLines,
    });
  }
  if (hasHead) {
    return renderSafeAgentDiff({
      path,
      comparisonArgs: ["HEAD"],
      filePath: normalizedPath,
      contextLines,
    });
  }

  const [stagedResult, unstagedResult] = await Promise.all([
    renderSafeAgentDiff({
      path,
      comparisonArgs: ["--cached"],
      filePath: normalizedPath,
      contextLines,
    }),
    renderSafeAgentDiff({
      path,
      comparisonArgs: [],
      filePath: normalizedPath,
      contextLines,
    }),
  ]);
  return boundAgentGitContent(
    [
      stagedResult.content ? `## Staged\n\n${stagedResult.content}` : "",
      unstagedResult.content ? `## Unstaged\n\n${unstagedResult.content}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    stagedResult.truncated || unstagedResult.truncated,
  );
}

export async function getAgentGitLog({
  path,
  revision = "HEAD",
  maxCount = 20,
  filePath,
}: GitBaseParams & {
  revision?: string;
  maxCount?: number;
  filePath?: string;
}): Promise<AgentGitTextResult> {
  const oid = await resolveAgentGitCommit({ path, revision });
  const normalizedPath = normalizeAgentGitFilterPath(path, filePath);
  const result = await execAgentGit(
    [
      "log",
      `--max-count=${maxCount}`,
      "--no-show-signature",
      // NUL-terminated records: git forbids NUL in commit messages, while
      // %x1e could legally appear inside %B and split a commit in two.
      "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x00",
      "--end-of-options",
      oid,
      ...(normalizedPath ? ["--", normalizedPath] : []),
    ],
    path,
    { allowTruncation: true },
  );
  assertAgentGitSuccess(result, "Failed to read Git log");
  const rawRecords = result.stdout.split("\0");
  if (result.truncated && !result.stdout.endsWith("\0")) {
    rawRecords.pop();
  }
  const commits = rawRecords
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, authorName, authorEmail, authoredAt, ...messageParts] =
        chunk.split("\x1f");
      return [
        `commit ${hash}`,
        `Author: ${authorName} <${authorEmail}>`,
        `Date: ${authoredAt}`,
        "",
        messageParts.join("\x1f").trim(),
      ].join("\n");
    });
  return boundAgentGitContent(commits.join("\n\n"), result.truncated);
}

async function getAgentGitParent({
  path,
  oid,
}: {
  path: string;
  oid: string;
}): Promise<string | null> {
  const result = await execAgentGit(
    ["rev-list", "--parents", "-n", "1", "--end-of-options", oid],
    path,
  );
  assertAgentGitSuccess(result, "Failed to inspect commit parents");
  return result.stdout.trim().split(/\s+/)[1] ?? null;
}

async function getAgentGitEmptyTree(path: string): Promise<string> {
  const result = await execAgentGit(
    ["hash-object", "-t", "tree", "--stdin"],
    path,
    { stdin: "" },
  );
  assertAgentGitSuccess(result, "Failed to calculate the empty Git tree");
  return result.stdout.trim();
}

export async function getAgentGitCommit({
  path,
  revision,
  filePath,
}: GitBaseParams & {
  revision: string;
  filePath?: string;
}): Promise<AgentGitTextResult & { patch: string }> {
  const oid = await resolveAgentGitCommit({ path, revision });
  const normalizedPath = normalizeAgentGitFilterPath(path, filePath);
  const metadataResult = await execAgentGit(
    [
      "show",
      "-s",
      "--no-show-signature",
      "--format=commit %H%nAuthor: %an <%ae>%nDate: %aI%n%n%B",
      "--end-of-options",
      oid,
    ],
    path,
    { allowTruncation: true },
  );
  assertAgentGitSuccess(metadataResult, "Failed to read Git commit metadata");
  const parent = await getAgentGitParent({ path, oid });
  const base = parent ?? (await getAgentGitEmptyTree(path));
  const diff = await renderSafeAgentDiff({
    path,
    comparisonArgs: [base, oid],
    filePath: normalizedPath,
    contextLines: 3,
  });
  return {
    ...boundAgentGitContent(
      [metadataResult.stdout.trim(), diff.content].filter(Boolean).join("\n\n"),
      metadataResult.truncated || diff.truncated,
    ),
    patch: diff.content,
  };
}

interface AgentGitTreeEntry {
  mode: string;
  type: string;
  oid: string;
  path: string;
}

async function getAgentGitTreeEntry({
  path,
  oid,
  filePath,
}: {
  path: string;
  oid: string;
  filePath: string;
}): Promise<AgentGitTreeEntry> {
  const result = await execAgentGit(
    ["ls-tree", "-z", "--end-of-options", oid, "--", filePath],
    path,
  );
  assertAgentGitSuccess(result, "Failed to inspect historical Git path");
  const record = result.stdout.split("\0").find(Boolean);
  if (!record) {
    throw new DyadError(
      `File does not exist at commit ${oid}: ${filePath}`,
      DyadErrorKind.NotFound,
    );
  }
  const match = /^(\d+) ([^ ]+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
  if (!match || normalizePath(match[4]) !== filePath) {
    throw new DyadError(
      `Historical Git path is not an exact file match: ${filePath}`,
      DyadErrorKind.Validation,
    );
  }
  return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
}

function decodeAgentGitText(bytes: Buffer, displayPath: string): string {
  if (bytes.includes(0)) {
    throw new DyadError(
      `Cannot display binary file from Git history: ${displayPath}`,
      DyadErrorKind.Validation,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DyadError(
      `Cannot display non-UTF-8 file from Git history: ${displayPath}`,
      DyadErrorKind.Validation,
    );
  }
}

export async function getAgentGitFile({
  path,
  revision,
  filePath,
  startLine,
  endLineInclusive,
}: GitBaseParams & {
  revision: string;
  filePath: string;
  startLine?: number;
  endLineInclusive?: number;
}): Promise<AgentGitTextResult> {
  const oid = await resolveAgentGitCommit({ path, revision });
  const normalizedPath = normalizeAgentGitPath(path, filePath);
  const entry = await getAgentGitTreeEntry({
    path,
    oid,
    filePath: normalizedPath,
  });
  if (entry.type !== "blob") {
    throw new DyadError(
      `Historical Git path is not a file: ${normalizedPath}`,
      DyadErrorKind.Validation,
    );
  }
  const sizeResult = await execAgentGit(["cat-file", "-s", entry.oid], path);
  assertAgentGitSuccess(sizeResult, "Failed to inspect historical file size");
  const size = Number(sizeResult.stdout.trim());
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new DyadError(
      `Git returned an invalid size for historical file: ${normalizedPath}`,
      DyadErrorKind.External,
    );
  }
  if (size > AGENT_GIT_SOURCE_FILE_LIMIT_BYTES) {
    throw new DyadError(
      `Historical file is too large to read safely: ${normalizedPath} (${size} bytes; ${AGENT_GIT_SOURCE_FILE_LIMIT_BYTES} byte limit)`,
      DyadErrorKind.Validation,
    );
  }
  const contentResult = await execAgentGit(
    ["cat-file", "blob", entry.oid],
    path,
    {
      encoding: "latin1",
      maxBuffer: AGENT_GIT_SOURCE_FILE_LIMIT_BYTES + 1024,
    },
  );
  assertAgentGitSuccess(contentResult, "Failed to read historical Git file");
  let content = decodeAgentGitText(
    Buffer.from(contentResult.stdout, "latin1"),
    normalizedPath,
  );
  if (isDotenvFilePath(normalizedPath)) {
    content = redactDotenvValues(content);
  }
  const selected = selectTextLineRange(content, startLine, endLineInclusive);
  return boundAgentGitContent(selected, contentResult.truncated);
}

export async function restoreAgentGitFile({
  path,
  revision,
  filePath,
}: GitBaseParams & {
  revision: string;
  filePath: string;
}): Promise<{ oid: string; mode: string; path: string }> {
  const oid = await resolveAgentGitCommit({ path, revision });
  const normalizedPath = normalizeAgentGitPath(path, filePath);
  const entry = await getAgentGitTreeEntry({
    path,
    oid,
    filePath: normalizedPath,
  });
  if (
    entry.type !== "blob" ||
    (entry.mode !== "100644" && entry.mode !== "100755")
  ) {
    throw new DyadError(
      `Only regular files can be restored: ${normalizedPath}`,
      DyadErrorKind.Validation,
    );
  }
  const sizeResult = await execAgentGit(["cat-file", "-s", entry.oid], path);
  assertAgentGitSuccess(sizeResult, "Failed to inspect historical file size");
  const size = Number(sizeResult.stdout.trim());
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new DyadError(
      `Git returned an invalid size for historical file: ${normalizedPath}`,
      DyadErrorKind.External,
    );
  }
  if (size > AGENT_GIT_SOURCE_FILE_LIMIT_BYTES) {
    throw new DyadError(
      `Historical file is too large to restore safely: ${normalizedPath} (${size} bytes; ${AGENT_GIT_SOURCE_FILE_LIMIT_BYTES} byte limit)`,
      DyadErrorKind.Validation,
    );
  }
  const contentResult = await execAgentGit(
    ["cat-file", "blob", entry.oid],
    path,
    {
      encoding: "latin1",
      maxBuffer: AGENT_GIT_SOURCE_FILE_LIMIT_BYTES + 1024,
    },
  );
  assertAgentGitSuccess(contentResult, `Failed to read ${normalizedPath}`);
  const destination = safeJoin(path, normalizedPath);
  const parent = pathModule.dirname(destination);
  await fsPromises.mkdir(parent, { recursive: true });
  const temporaryDirectory = await fsPromises.mkdtemp(
    pathModule.join(parent, ".dyad-git-restore-"),
  );
  const temporaryFile = pathModule.join(temporaryDirectory, "file");
  try {
    await fsPromises.writeFile(
      temporaryFile,
      Buffer.from(contentResult.stdout, "latin1"),
      { mode: entry.mode === "100755" ? 0o755 : 0o644 },
    );
    await fsPromises.chmod(
      temporaryFile,
      entry.mode === "100755" ? 0o755 : 0o644,
    );
    const existing = await fsPromises.lstat(destination).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (existing?.isDirectory()) {
      throw new DyadError(
        `Cannot restore a file over a directory: ${normalizedPath}`,
        DyadErrorKind.Validation,
      );
    }
    await fsPromises.rm(destination, { force: true });
    await fsPromises.rename(temporaryFile, destination);
  } finally {
    await fsPromises.rm(temporaryDirectory, { recursive: true, force: true });
  }
  return { oid, mode: entry.mode, path: normalizedPath };
}

export async function gitFetch({
  path,
  remote = "origin",
  accessToken,
}: GitFetchParams): Promise<void> {
  await execOrThrow(
    ["fetch", remote],
    path,
    "Failed to fetch from remote",
    undefined,
    { env: getGitNetworkEnv(accessToken) },
  );
}

/** Merge/pull conflicts — `name` kept for UI checks (e.g. GitHubConnector). */
class GitConflictErrorImpl extends DyadError {
  constructor(message: string) {
    super(message, DyadErrorKind.Conflict);
    this.name = "GitConflictError";
  }
}

export function GitConflictError(message: string): Error {
  return new GitConflictErrorImpl(message);
}

/** Blocked git operation due to repo state (merge/rebase in progress, etc.). */
class GitStateErrorImpl extends DyadError {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message, DyadErrorKind.Precondition);
    this.name = "GitStateError";
    this.code = code;
  }
}

export function GitStateError(message: string, code: string): Error {
  return new GitStateErrorImpl(message, code);
}

// Error codes for git state errors
export const GIT_ERROR_CODES = {
  MERGE_IN_PROGRESS: "MERGE_IN_PROGRESS",
  REBASE_IN_PROGRESS: "REBASE_IN_PROGRESS",
} as const;

function hasGitConflictState({ path }: GitBaseParams): boolean {
  return isGitMergeOrRebaseInProgress({ path });
}

export async function gitPull({
  path,
  remote = "origin",
  branch = "main",
  accessToken,
}: GitPullParams): Promise<void> {
  // Use withGitAuthor since pull may need to create merge commits
  // and requires user.name and user.email
  const pullArgs = await withGitAuthor([
    "pull",
    "--rebase=false",
    remote,
    branch,
  ]);
  try {
    await execOrThrow(pullArgs, path, "Failed to pull from remote", undefined, {
      env: getGitNetworkEnv(accessToken),
    });
  } catch (error: any) {
    // Check git state files to detect conflicts instead of parsing error messages
    if (hasGitConflictState({ path })) {
      throw GitConflictError(
        `Merge conflict detected during pull. Please resolve conflicts before proceeding.`,
      );
    }
    throw error;
  }
  return;
}

export async function gitMerge({
  path,
  branch,
}: GitMergeParams): Promise<void> {
  // Use withGitAuthor since merge may need to create merge commits
  // and requires user.name and user.email
  const args = await withGitAuthor(["merge", branch]);
  try {
    await execOrThrow(args, path, `Failed to merge branch ${branch}`);
  } catch (error: any) {
    // Check git state files to detect conflicts instead of parsing error messages
    if (hasGitConflictState({ path })) {
      throw GitConflictError(
        `Merge conflict detected during merge. Please resolve conflicts before proceeding.`,
      );
    }
    throw error;
  }
  return;
}

export async function gitCreateBranch({
  path,
  branch,
  from = "HEAD",
}: GitCreateBranchParams): Promise<void> {
  await execOrThrow(
    ["branch", branch, from],
    path,
    `Failed to create branch ${branch}`,
  );
  return;
}

export async function gitDeleteBranch({
  path,
  branch,
}: GitDeleteBranchParams): Promise<void> {
  await execOrThrow(
    ["branch", "-D", branch],
    path,
    `Failed to delete branch ${branch}`,
  );
}

export async function gitGetMergeConflicts({
  path,
}: GitBaseParams): Promise<string[]> {
  // git diff --name-only --diff-filter=U
  const result = (await execGit(
    ["diff", "--name-only", "--diff-filter=U"],
    path,
  )) as unknown as {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
  if (result.exitCode !== 0) {
    throw new DyadError(
      `Failed to get merge conflicts: ${result.stderr}`,
      DyadErrorKind.Conflict,
    );
  }
  return result.stdout
    .toString()
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Check if Git is currently in a merge or rebase state.
 * This is important because commits are not allowed during merge/rebase
 * if there are still unmerged files.
 */
export function isGitMergeOrRebaseInProgress({ path }: GitBaseParams): boolean {
  const gitDir = pathModule.join(path, ".git");

  // Check for merge in progress
  const mergeHeadPath = pathModule.join(gitDir, "MERGE_HEAD");
  if (fs.existsSync(mergeHeadPath)) {
    return true;
  }

  // Check for rebase in progress
  const rebaseHeadPath = pathModule.join(gitDir, "REBASE_HEAD");
  if (fs.existsSync(rebaseHeadPath)) {
    return true;
  }

  // Check for rebase-apply or rebase-merge directories
  const rebaseApplyPath = pathModule.join(gitDir, "rebase-apply");
  const rebaseMergePath = pathModule.join(gitDir, "rebase-merge");
  if (fs.existsSync(rebaseApplyPath) || fs.existsSync(rebaseMergePath)) {
    return true;
  }

  return false;
}
/**
 * Check if Git is currently in a merge state (not a rebase).
 * This checks for MERGE_HEAD file which indicates a merge is in progress.
 */
export function isGitMergeInProgress({ path }: GitBaseParams): boolean {
  const gitDir = pathModule.join(path, ".git");
  const mergeHeadPath = pathModule.join(gitDir, "MERGE_HEAD");
  return fs.existsSync(mergeHeadPath);
}

/**
 * Check if Git is currently in a rebase state (not a merge).
 * This is used to determine whether to use `git rebase --continue`
 * or `git commit` when completing conflict resolution.
 */
export function isGitRebaseInProgress({ path }: GitBaseParams): boolean {
  const gitDir = pathModule.join(path, ".git");

  // Check for rebase in progress via REBASE_HEAD
  const rebaseHeadPath = pathModule.join(gitDir, "REBASE_HEAD");
  if (fs.existsSync(rebaseHeadPath)) {
    return true;
  }

  // Check for rebase-apply or rebase-merge directories
  const rebaseApplyPath = pathModule.join(gitDir, "rebase-apply");
  const rebaseMergePath = pathModule.join(gitDir, "rebase-merge");
  if (fs.existsSync(rebaseApplyPath) || fs.existsSync(rebaseMergePath)) {
    return true;
  }
  return false;
}
