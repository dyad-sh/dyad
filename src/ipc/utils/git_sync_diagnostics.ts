/**
 * Measures what a sync to the linked remote actually did, so the push
 * handler can report "pushed 3 commits" or "nothing reached the remote and
 * here is why" instead of trusting git's exit code alone.
 *
 * Every reading here is local and cheap, and the process count is kept low on
 * purpose: one `status` call yields HEAD, its branch, and the uncommitted
 * paths; one `for-each-ref` resolves every branch and remote-tracking tip; and
 * the post-push counts run only when the remote tip moved. Nothing in this
 * module may fail a sync: a reading that cannot be taken degrades to null
 * rather than throwing.
 */

import log from "electron-log";
import type { PushFacts } from "@/github_ops/push_summary";
import type { PushedFileCounts } from "@/github_ops/state";
import { execGit, isUserVisibleGitPath, unquoteGitPath } from "./git_utils";

const logger = log.scope("git_sync_diagnostics");

/** Hash of git's empty tree, for diffing against "nothing" on a first push. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_REPORTED_BRANCHES = 8;

export interface SyncSnapshot {
  /** The branch HEAD is on, or null when detached. */
  currentBranch: string | null;
  /** Full commit HEAD resolves to, or null in an unborn repository. */
  head: string | null;
  /** Full tip of the local branch about to be pushed, or null if absent. */
  branchTip: string | null;
  /** Full tip of `origin/<branch>`, or null if the remote branch is unknown. */
  remoteTip: string | null;
  /** User-visible working-tree changes no commit contains. */
  uncommittedFiles: number;
  /** Other local branches holding commits the remote branch lacks. */
  branchesNotOnRemote: string[];
}

export interface PushMeasurement extends PushFacts {
  /** Full remote tip before the push, for the log. */
  remoteTipBefore: string | null;
}

interface HeadPosition {
  currentBranch: string | null;
  head: string | null;
}

/** One `for-each-ref` call: every local branch and remote-tracking tip. */
async function readRefTips(path: string): Promise<Map<string, string>> {
  const tips = new Map<string, string>();
  const result = await execGit(
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      "refs/heads",
      "refs/remotes/origin",
    ],
    path,
  );
  if (result.exitCode !== 0) return tips;
  for (const line of result.stdout.split("\n")) {
    const [refname, objectname] = line.split("\0");
    if (refname && objectname) tips.set(refname, objectname);
  }
  return tips;
}

/**
 * One `rev-parse` call for both the commit HEAD is on and the branch it is
 * on. The symbolic name comes back as `refs/heads/<branch>`, or as the bare
 * word `HEAD` when detached (`HEAD` is not a legal branch name, so the two
 * cannot be confused). Fails in an unborn repository, which yields nulls.
 */
async function readHeadPosition(path: string): Promise<HeadPosition> {
  const result = await execGit(
    ["rev-parse", "HEAD", "--symbolic-full-name", "HEAD"],
    path,
  );
  if (result.exitCode !== 0) return { currentBranch: null, head: null };
  const [head = "", symbolic = ""] = result.stdout.split("\n");
  return {
    currentBranch: symbolic.startsWith("refs/heads/")
      ? symbolic.slice("refs/heads/".length)
      : null,
    head: head.trim() || null,
  };
}

/**
 * One `status --porcelain=v2 --branch` call: HEAD, its branch, and the
 * uncommitted paths, counted the way the Git panel lists them (both sides of
 * a rename, nothing under `.dyad/`) so the two never disagree.
 */
async function readWorkingState(
  path: string,
): Promise<HeadPosition & { uncommittedFiles: number }> {
  const result = await execGit(["status", "--porcelain=v2", "--branch"], path);
  if (result.exitCode !== 0) {
    return { currentBranch: null, head: null, uncommittedFiles: 0 };
  }
  let head: string | null = null;
  let currentBranch: string | null = null;
  let uncommittedFiles = 0;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length);
      head = oid === "(initial)" ? null : oid;
    } else if (line.startsWith("# branch.head ")) {
      const name = line.slice("# branch.head ".length);
      currentBranch = name === "(detached)" ? null : name;
    } else if (line !== "" && !line.startsWith("#")) {
      uncommittedFiles +=
        porcelainV2EntryPaths(line).filter(isUserVisibleGitPath).length;
    }
  }
  return { currentBranch, head, uncommittedFiles };
}

/**
 * The path(s) a porcelain v2 entry names. Entries are `1` (changed), `2`
 * (renamed or copied, `path<TAB>origPath`), `u` (unmerged) and `?`
 * (untracked), each with a fixed number of space-separated fields before the
 * path. Paths with special characters are C-quoted, as in v1.
 */
function porcelainV2EntryPaths(line: string): string[] {
  switch (line[0]) {
    case "1":
      return [unquoteGitPath(afterFields(line, 8))];
    case "2":
      return afterFields(line, 9).split("\t").map(unquoteGitPath);
    case "u":
      return [unquoteGitPath(afterFields(line, 10))];
    case "?":
      return [unquoteGitPath(afterFields(line, 1))];
    default:
      return [];
  }
}

function afterFields(line: string, count: number): string {
  let index = 0;
  for (let field = 0; field < count; field += 1) {
    const next = line.indexOf(" ", index);
    if (next === -1) return "";
    index = next + 1;
  }
  return line.slice(index);
}

async function readBranchesNotMergedInto(
  path: string,
  commit: string,
  except: string,
): Promise<string[]> {
  const result = await execGit(
    ["branch", "--no-merged", commit, "--format=%(refname:short)"],
    path,
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name && name !== except)
    .slice(0, MAX_REPORTED_BRANCHES);
}

async function countCommits(
  path: string,
  from: string | null,
  to: string,
): Promise<number | null> {
  const range = from ? `${from}..${to}` : to;
  const result = await execGit(["rev-list", "--count", range], path);
  if (result.exitCode !== 0) return null;
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : null;
}

async function countChangedFiles(
  path: string,
  from: string | null,
  to: string,
): Promise<PushedFileCounts | null> {
  const result = await execGit(
    ["diff", "--name-status", "--no-renames", from ?? EMPTY_TREE, to],
    path,
  );
  if (result.exitCode !== 0) return null;
  const counts: PushedFileCounts = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
  };
  for (const line of result.stdout.split("\n")) {
    switch (line[0]) {
      case "A":
      case "C":
        counts.added += 1;
        break;
      case "M":
      case "T":
        counts.modified += 1;
        break;
      case "D":
        counts.deleted += 1;
        break;
      case "R":
        counts.renamed += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

/** Reads the repository state a sync starts from. Never throws. */
export async function collectSyncSnapshot({
  path,
  branch,
}: {
  path: string;
  branch: string;
}): Promise<SyncSnapshot> {
  try {
    const [working, tips] = await Promise.all([
      readWorkingState(path),
      readRefTips(path),
    ]);
    const remoteTip = tips.get(`refs/remotes/origin/${branch}`) ?? null;
    return {
      currentBranch: working.currentBranch,
      head: working.head,
      branchTip: tips.get(`refs/heads/${branch}`) ?? null,
      remoteTip,
      uncommittedFiles: working.uncommittedFiles,
      branchesNotOnRemote: remoteTip
        ? await readBranchesNotMergedInto(path, remoteTip, branch)
        : [],
    };
  } catch (error) {
    logger.warn("Could not read the repository state before syncing", error);
    return {
      currentBranch: null,
      head: null,
      branchTip: null,
      remoteTip: null,
      uncommittedFiles: 0,
      branchesNotOnRemote: [],
    };
  }
}

/**
 * Reads the repository state after a push that exited 0 and compares it with
 * the snapshot taken before. Never throws; unreadable facts come back null.
 */
export async function measurePush({
  path,
  branch,
  before,
}: {
  path: string;
  branch: string;
  before: SyncSnapshot;
}): Promise<PushMeasurement> {
  const fallback: PushMeasurement = {
    pushedBranch: branch,
    currentBranch: before.currentBranch,
    head: before.head ?? "",
    remoteTip: null,
    remoteTipBefore: before.remoteTip,
    remoteMoved: false,
    commitsPushed: null,
    files: null,
    uncommittedFiles: before.uncommittedFiles,
    commitsNotOnRemote: 0,
  };
  try {
    const [{ currentBranch, head }, tips] = await Promise.all([
      readHeadPosition(path),
      readRefTips(path),
    ]);
    const remoteTip = tips.get(`refs/remotes/origin/${branch}`) ?? null;
    const remoteMoved = remoteTip !== null && remoteTip !== before.remoteTip;
    const [commitsPushed, files, commitsNotOnRemote] = await Promise.all([
      remoteMoved && remoteTip
        ? countCommits(path, before.remoteTip, remoteTip)
        : Promise.resolve(remoteMoved ? null : 0),
      remoteMoved && remoteTip
        ? countChangedFiles(path, before.remoteTip, remoteTip)
        : Promise.resolve(null),
      remoteTip && head && head !== remoteTip
        ? countCommits(path, remoteTip, head)
        : Promise.resolve(0),
    ]);
    return {
      pushedBranch: branch,
      currentBranch,
      head: head ?? "",
      remoteTip,
      remoteTipBefore: before.remoteTip,
      remoteMoved,
      commitsPushed,
      files,
      uncommittedFiles: before.uncommittedFiles,
      commitsNotOnRemote: commitsNotOnRemote ?? 0,
    };
  } catch (error) {
    logger.warn("Could not read the repository state after syncing", error);
    return fallback;
  }
}

/** Full commit HEAD resolves to, or null when it cannot be read. */
export async function readHeadCommit(path: string): Promise<string | null> {
  return (await readHeadPosition(path)).head;
}
