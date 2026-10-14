import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { normalizePath } from "../../../shared/normalizePath";
import { resolveGitCommonDirSync, resolveGitDirSync } from "./git_dir";
import { execGit, gitGetMergeConflicts, withGitAuthor } from "./git_utils";

const logger = log.scope("git_worktree_utils");

/**
 * Git helpers for linked worktrees owned by chat workspaces.
 *
 * Every command that can run repository hooks (worktree checkout, merge,
 * commit) points `core.hooksPath` at a fresh empty directory outside the
 * repository, matching `gitCommit`: these are automatic Dyad operations, and an
 * imported repository must not be able to run code through them.
 */

async function withEmptyHooks<Result>(
  operation: (hooksArgs: string[]) => Promise<Result>,
): Promise<Result> {
  const hooksPath = await fsPromises.mkdtemp(
    path.join(tmpdir(), "dyad-no-git-hooks-"),
  );
  try {
    return await operation([
      "-c",
      `core.hooksPath=${normalizePath(hooksPath)}`,
      "-c",
      "core.fsmonitor=false",
    ]);
  } finally {
    await fsPromises
      .rm(hooksPath, { recursive: true, force: true })
      .catch((error) =>
        logger.warn("Failed to remove temporary Git hooks directory", error),
      );
  }
}

function describeFailure(result: { stderr: string; stdout: string }): string {
  return result.stderr.trim() || result.stdout.trim();
}

async function runOrThrow(
  args: string[],
  cwd: string,
  message: string,
  kind: DyadErrorKind = DyadErrorKind.External,
): Promise<string> {
  const result = await execGit(args, cwd);
  if (result.exitCode !== 0) {
    throw new DyadError(`${message}: ${describeFailure(result)}`, kind);
  }
  return result.stdout;
}

export interface GitWorktreeEntry {
  path: string;
  head: string | null;
  /** Short branch name, or null when detached. */
  branch: string | null;
  prunable: boolean;
}

/** Lists the repository's worktrees, including the primary checkout. */
export async function listGitWorktrees(
  repositoryPath: string,
): Promise<GitWorktreeEntry[]> {
  const stdout = await runOrThrow(
    ["worktree", "list", "--porcelain"],
    repositoryPath,
    "Failed to list Git worktrees",
  );
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = {
        path: line.slice("worktree ".length),
        head: null,
        branch: null,
        prunable: false,
      };
      entries.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  return entries;
}

export async function gitBranchExists({
  path: repositoryPath,
  branch,
}: {
  path: string;
  branch: string;
}): Promise<boolean> {
  const result = await execGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`],
    repositoryPath,
  );
  return result.exitCode === 0;
}

/**
 * Creates `branch` at `startPoint` and checks it out in a new linked worktree.
 * Only committed state is copied: uncommitted edits in any other checkout are
 * deliberately left behind.
 */
export async function addBranchWorktree({
  repositoryPath,
  worktreePath,
  branch,
  startPoint,
}: {
  repositoryPath: string;
  worktreePath: string;
  branch: string;
  startPoint: string;
}): Promise<void> {
  await withEmptyHooks(async (hooksArgs) => {
    await runOrThrow(
      [...hooksArgs, "worktree", "add", "-b", branch, worktreePath, startPoint],
      repositoryPath,
      "Failed to create the isolated workspace",
    );
  });
}

/**
 * Unregisters and deletes a linked worktree. Falls back to deleting the
 * directory and pruning stale registrations when Git cannot remove it (for
 * example after the directory was already deleted by hand).
 */
export async function removeLinkedWorktree({
  repositoryPath,
  worktreePath,
}: {
  repositoryPath: string;
  worktreePath: string;
}): Promise<void> {
  const result = await execGit(
    ["worktree", "remove", "--force", worktreePath],
    repositoryPath,
  );
  if (result.exitCode === 0) return;
  logger.warn(
    `git worktree remove failed for ${worktreePath}; falling back to deletion`,
    describeFailure(result),
  );
  await fsPromises.rm(worktreePath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  await pruneGitWorktrees(repositoryPath);
}

export async function pruneGitWorktrees(repositoryPath: string): Promise<void> {
  const result = await execGit(["worktree", "prune"], repositoryPath);
  if (result.exitCode !== 0) {
    logger.warn(
      `git worktree prune failed in ${repositoryPath}`,
      describeFailure(result),
    );
  }
}

/**
 * Keeps Dyad's internal `.dyad/` folders out of Git in every worktree of a
 * repository without changing tracked files: the entry Dyad otherwise adds to
 * `.gitignore` goes into the repository's local `info/exclude`, which all its
 * worktrees share. Media and plans mirrored into a workspace then never count
 * as uncommitted work or get swept into a commit, even when the branch the
 * workspace started from predates the app's `.gitignore` entry.
 */
export async function excludeDyadMetadata(worktreePath: string): Promise<void> {
  const commonDir = resolveGitCommonDirSync(worktreePath);
  // A worktree whose repository moved points at a folder that is gone;
  // creating `info/` there would recreate the old location.
  if (!fs.existsSync(commonDir)) return;
  const excludePath = path.join(commonDir, "info", "exclude");
  let content = "";
  try {
    content = await fsPromises.readFile(excludePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    content
      .split(/\r?\n/)
      .some((line) => line.trim() === ".dyad/" || line.trim() === ".dyad")
  ) {
    return;
  }
  await fsPromises.mkdir(path.dirname(excludePath), { recursive: true });
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await fsPromises.writeFile(
    excludePath,
    `${content}${separator}.dyad/\n`,
    "utf8",
  );
}

/**
 * True when a linked worktree's `.git` file points at a Git directory that no
 * longer exists, which is what renaming or moving the main checkout does:
 * every Git command in the worktree fails until it is repaired.
 */
export function isWorktreeLinkBroken(worktreePath: string): boolean {
  try {
    if (!fs.statSync(path.join(worktreePath, ".git")).isFile()) return false;
  } catch {
    return false;
  }
  return !fs.existsSync(resolveGitDirSync(worktreePath));
}

/**
 * Reconnects linked worktrees with a main checkout that was renamed or moved.
 * Run from the main checkout's new location; naming each worktree lets Git
 * rewrite the links in both directions.
 */
export async function repairLinkedWorktrees({
  repositoryPath,
  worktreePaths,
}: {
  repositoryPath: string;
  worktreePaths: readonly string[];
}): Promise<void> {
  await runOrThrow(
    ["worktree", "repair", ...worktreePaths],
    repositoryPath,
    "Failed to reconnect isolated workspaces with the app's repository",
  );
}

/** Deletes a branch only when Git agrees it is fully merged. */
export async function deleteMergedBranch({
  repositoryPath,
  branch,
}: {
  repositoryPath: string;
  branch: string;
}): Promise<boolean> {
  const result = await execGit(["branch", "-d", branch], repositoryPath);
  if (result.exitCode !== 0) {
    logger.info(`Kept branch ${branch}: ${describeFailure(result)}`);
    return false;
  }
  return true;
}

/** Whether `ancestor` is reachable from `descendant`. */
export async function isAncestorCommit({
  path: repositoryPath,
  ancestor,
  descendant,
}: {
  path: string;
  ancestor: string;
  descendant: string;
}): Promise<boolean> {
  const result = await execGit(
    ["merge-base", "--is-ancestor", ancestor, descendant],
    repositoryPath,
  );
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw new DyadError(
    `Failed to compare commits: ${describeFailure(result)}`,
    DyadErrorKind.External,
  );
}

/** Commits reachable from `from` but not from `exclude`, newest first. */
export async function listCommitsNotIn({
  path: repositoryPath,
  from,
  exclude,
  firstParent = false,
  noMerges = false,
}: {
  path: string;
  from: string;
  exclude: string;
  firstParent?: boolean;
  noMerges?: boolean;
}): Promise<string[]> {
  const stdout = await runOrThrow(
    [
      "rev-list",
      ...(firstParent ? ["--first-parent"] : []),
      ...(noMerges ? ["--no-merges"] : []),
      from,
      "--not",
      exclude,
      "--",
    ],
    repositoryPath,
    "Failed to list workspace commits",
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Whether a merge is in progress in the checkout containing `folder`. The
 * folder may be an app inside its repository (and so inside a workspace), so
 * the checkout's `.git` is looked up the way Git discovers it.
 */
export function isMergeInProgress(folder: string): boolean {
  let checkout = path.resolve(folder);
  while (!fs.existsSync(path.join(checkout, ".git"))) {
    const parent = path.dirname(checkout);
    if (parent === checkout) return false;
    checkout = parent;
  }
  return fs.existsSync(path.join(resolveGitDirSync(checkout), "MERGE_HEAD"));
}

export type MergeIntoWorkspaceResult =
  | { kind: "up-to-date" }
  | { kind: "fast-forward" }
  | { kind: "merged"; mergeCommit: string }
  | { kind: "conflicts"; conflictedFiles: string[] };

/**
 * Brings `ref` into the branch checked out at `worktreePath` without
 * rewriting history: nothing when it is already contained, a fast-forward
 * when the branch is strictly behind, otherwise a merge commit.
 *
 * Conflicts leave the merge in progress (MERGE_HEAD set) so it can be resolved
 * in place; every other failure is aborted and rethrown.
 */
export async function mergeIntoWorkspace({
  worktreePath,
  ref,
  message,
  allowFastForward,
}: {
  worktreePath: string;
  ref: string;
  message: string;
  allowFastForward: boolean;
}): Promise<MergeIntoWorkspaceResult> {
  if (
    await isAncestorCommit({
      path: worktreePath,
      ancestor: ref,
      descendant: "HEAD",
    })
  ) {
    return { kind: "up-to-date" };
  }
  if (
    allowFastForward &&
    (await isAncestorCommit({
      path: worktreePath,
      ancestor: "HEAD",
      descendant: ref,
    }))
  ) {
    await fastForwardCheckedOutBranch({ worktreePath, ref });
    return { kind: "fast-forward" };
  }
  return withEmptyHooks(async (hooksArgs) => {
    const args = await withGitAuthor([
      ...hooksArgs,
      "merge",
      "--no-ff",
      "--no-edit",
      "-m",
      message,
      ref,
    ]);
    const result = await execGit(args, worktreePath);
    if (result.exitCode === 0) {
      const head = await runOrThrow(
        ["rev-parse", "HEAD"],
        worktreePath,
        "Failed to read the merge commit",
      );
      return { kind: "merged" as const, mergeCommit: head.trim() };
    }
    const conflictedFiles = isMergeInProgress(worktreePath)
      ? await gitGetMergeConflicts({ path: worktreePath })
      : [];
    if (conflictedFiles.length > 0) {
      return { kind: "conflicts" as const, conflictedFiles };
    }
    if (isMergeInProgress(worktreePath)) {
      await execGit(["merge", "--abort"], worktreePath);
    }
    throw new DyadError(
      `Failed to merge ${ref}: ${describeFailure(result)}`,
      DyadErrorKind.Conflict,
    );
  });
}

/** Moves the checked-out branch forward to `ref`; refuses anything else. */
export async function fastForwardCheckedOutBranch({
  worktreePath,
  ref,
}: {
  worktreePath: string;
  ref: string;
}): Promise<void> {
  await withEmptyHooks(async (hooksArgs) => {
    await runOrThrow(
      [...hooksArgs, "merge", "--ff-only", ref],
      worktreePath,
      `Failed to fast-forward to ${ref}`,
      DyadErrorKind.Conflict,
    );
  });
}

/** Completes an in-progress merge with its prepared message. */
export async function commitInProgressMerge(
  worktreePath: string,
): Promise<string> {
  return withEmptyHooks(async (hooksArgs) => {
    const args = await withGitAuthor([
      ...hooksArgs,
      "commit",
      "--no-edit",
      "--no-verify",
    ]);
    await runOrThrow(
      args,
      worktreePath,
      "Failed to complete the merge",
      DyadErrorKind.Conflict,
    );
    const head = await runOrThrow(
      ["rev-parse", "HEAD"],
      worktreePath,
      "Failed to read the merge commit",
    );
    return head.trim();
  });
}

export async function abortInProgressMerge(
  worktreePath: string,
): Promise<void> {
  if (!isMergeInProgress(worktreePath)) return;
  await runOrThrow(
    ["merge", "--abort"],
    worktreePath,
    "Failed to abort the merge",
    DyadErrorKind.Conflict,
  );
}

const CONFLICT_MARKER_PATTERN = /^(<{7}|>{7})(?: |$)|^={7}$/m;
const MAX_MARKER_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * Files that still contain conflict markers. `git add` happily stages a file
 * with markers, which would mark the conflict resolved in the index, so the
 * content is checked before a merge is completed.
 */
export async function findFilesWithConflictMarkers(
  worktreePath: string,
  relativePaths: readonly string[],
): Promise<string[]> {
  const withMarkers: string[] = [];
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(worktreePath, relativePath);
    let content: Buffer;
    try {
      const stat = await fsPromises.stat(absolutePath);
      if (!stat.isFile() || stat.size > MAX_MARKER_SCAN_BYTES) continue;
      content = await fsPromises.readFile(absolutePath);
    } catch {
      continue;
    }
    if (content.includes(0)) continue;
    if (CONFLICT_MARKER_PATTERN.test(content.toString("utf8"))) {
      withMarkers.push(relativePath);
    }
  }
  return withMarkers;
}

/** Paths that differ between two commits (or a commit and the index). */
export async function listChangedPaths({
  path: repositoryPath,
  from,
  to,
}: {
  path: string;
  from: string;
  to?: string;
}): Promise<string[]> {
  const stdout = await runOrThrow(
    ["diff", "--name-only", "-z", from, ...(to ? [to] : []), "--"],
    repositoryPath,
    "Failed to list changed files",
  );
  return stdout.split("\0").filter(Boolean);
}

/**
 * Files that differ between two commits, split into changed and deleted.
 * Paths are relative to `path`, and an app inside a larger repository sees
 * only its own files.
 */
export async function diffPathsByStatus({
  path: cwd,
  from,
  to,
}: {
  path: string;
  from: string;
  to: string;
}): Promise<{ changed: string[]; deleted: string[] }> {
  const stdout = await runOrThrow(
    [
      "diff",
      "--name-status",
      "--no-renames",
      "--relative",
      "-z",
      from,
      to,
      "--",
    ],
    cwd,
    "Failed to list changed files",
  );
  // `-z` output alternates status and path fields.
  const fields = stdout.split("\0");
  const changed: string[] = [];
  const deleted: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [status, file] = [fields[index], fields[index + 1]];
    if (!status || !file) continue;
    (status.startsWith("D") ? deleted : changed).push(file);
  }
  return { changed, deleted };
}

/** Stages every change in the worktree, including deletions. */
export async function stageAllChanges(worktreePath: string): Promise<void> {
  await runOrThrow(
    ["-c", "core.fsmonitor=false", "add", "-A", "--", "."],
    worktreePath,
    "Failed to stage changes",
  );
}

/**
 * Reverts `commits` (newest first) as one new commit. Conflicts abort the
 * revert and leave the worktree untouched.
 */
export async function revertCommitsAsOne({
  worktreePath,
  commits,
  message,
}: {
  worktreePath: string;
  commits: readonly string[];
  message: string;
}): Promise<string | null> {
  if (commits.length === 0) return null;
  return withEmptyHooks(async (hooksArgs) => {
    const revert = await execGit(
      [...hooksArgs, "revert", "--no-commit", ...commits],
      worktreePath,
    );
    if (revert.exitCode !== 0) {
      await execGit(["revert", "--abort"], worktreePath);
      throw new DyadError(
        `These changes can't be undone automatically because later work changed the same lines: ${describeFailure(revert)}`,
        DyadErrorKind.Conflict,
      );
    }
    const staged = await execGit(["diff", "--cached", "--quiet"], worktreePath);
    if (staged.exitCode === 0) {
      await execGit(["revert", "--quit"], worktreePath);
      return null;
    }
    const args = await withGitAuthor([
      ...hooksArgs,
      "commit",
      "--no-verify",
      "-m",
      message,
    ]);
    await runOrThrow(args, worktreePath, "Failed to commit the undo");
    const head = await runOrThrow(
      ["rev-parse", "HEAD"],
      worktreePath,
      "Failed to read the undo commit",
    );
    return head.trim();
  });
}
