import { IpcMainInvokeEvent } from "electron";
import { readSettings } from "../../main/settings";
import {
  gitMergeAbort,
  gitFetch,
  gitPull,
  gitCreateBranch,
  gitDeleteBranch,
  gitCheckout,
  gitMerge,
  gitCurrentBranch,
  gitListBranches,
  gitListRemoteBranches,
  gitRenameBranch,
  GitStateError,
  GIT_ERROR_CODES,
  isGitMergeInProgress,
  isGitRebaseInProgress,
  getGitUncommittedFilesWithStatus,
  gitAddAll,
  gitCommit,
} from "../utils/git_utils";
import { getDyadAppPath } from "../../paths/paths";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { withLock } from "../utils/lock_utils";
import { updateAppGithubRepo, ensureCleanWorkspace } from "./github_handlers";
import { createTypedHandler } from "./base";
import { githubContracts, gitContracts } from "../types/github";
import type {
  GitBranchAppIdParams,
  CreateGitBranchParams,
  GitBranchParams,
  RenameGitBranchParams,
  UncommittedFile,
} from "../types/github";

const logger = log.scope("git_branch_handlers");

async function handleAbortMerge(
  event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  await gitMergeAbort({ path: appPath });
}

// --- GitHub Fetch Handler ---
async function handleFetchFromGithub(
  event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<void> {
  const settings = readSettings();
  const accessToken = settings.githubAccessToken?.value;
  if (!accessToken) {
    throw new Error("Not authenticated with GitHub.");
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new Error("App is not linked to a GitHub repo.");
  }
  const appPath = getDyadAppPath(app.path);

  await gitFetch({
    path: appPath,
    remote: "origin",
    accessToken,
  });
}

// --- GitHub Branch Handlers ---
async function handleCreateBranch(
  event: IpcMainInvokeEvent,
  { appId, branch, from }: CreateGitBranchParams,
): Promise<void> {
  // Validate branch name
  if (!branch || branch.length === 0 || branch.length > 255) {
    throw new Error("Branch name must be between 1 and 255 characters");
  }
  if (!/^[a-zA-Z0-9/_.-]+$/.test(branch) || /\.\./.test(branch)) {
    throw new Error("Branch name contains invalid characters");
  }
  if (
    branch.startsWith("-") ||
    branch === "HEAD" ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("@{")
  ) {
    throw new Error("Invalid branch name");
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  await gitCreateBranch({
    path: appPath,
    branch,
    from,
  });
}

async function handleDeleteBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: GitBranchParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  await gitDeleteBranch({
    path: appPath,
    branch,
  });
}

async function handleSwitchBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: GitBranchParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  // Check for merge or rebase in progress before attempting to switch
  // This provides structured error codes instead of relying on string matching
  if (isGitMergeInProgress({ path: appPath })) {
    throw GitStateError(
      "Cannot switch branches: merge in progress. Please complete or abort the merge first.",
      GIT_ERROR_CODES.MERGE_IN_PROGRESS,
    );
  }

  if (isGitRebaseInProgress({ path: appPath })) {
    throw GitStateError(
      "Cannot switch branches: rebase in progress. Please complete or abort the rebase first.",
      GIT_ERROR_CODES.REBASE_IN_PROGRESS,
    );
  }

  // Check for uncommitted changes
  await withLock(appId, async () => {
    await ensureCleanWorkspace(appPath, `switching to branch '${branch}'`);
  });
  try {
    await gitCheckout({
      path: appPath,
      ref: branch,
    });
  } catch (checkoutError: any) {
    const errorMessage = checkoutError?.message || "Failed to switch branch.";
    // Check if error is about uncommitted changes (fallback in case check above missed it)
    const lowerMessage = errorMessage.toLowerCase();
    if (
      lowerMessage.includes("local changes") ||
      lowerMessage.includes("would be overwritten") ||
      lowerMessage.includes("please commit or stash")
    ) {
      throw new Error(
        `Failed to switch branch: uncommitted changes detected. ` +
          "Please commit or stash your changes manually and try again.",
      );
    }
    throw checkoutError;
  }

  // Update DB with new branch
  await updateAppGithubRepo({
    appId,
    org: app.githubOrg || undefined,
    repo: app.githubRepo || "",
    branch,
  });
}

async function handleRenameBranch(
  event: IpcMainInvokeEvent,
  { appId, oldBranch, newBranch }: RenameGitBranchParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  // Check if we're renaming the current branch BEFORE renaming to avoid race conditions
  const currentBranch = await gitCurrentBranch({ path: appPath });
  const isRenamingCurrentBranch = currentBranch === oldBranch;

  await gitRenameBranch({
    path: appPath,
    oldBranch,
    newBranch,
  });

  // Only update DB if we were on oldBranch before renaming
  // (git branch -m renames the current branch if we're on it, so HEAD now points to newBranch)
  if (isRenamingCurrentBranch) {
    await updateAppGithubRepo({
      appId,
      org: app.githubOrg || undefined,
      repo: app.githubRepo || "",
      branch: newBranch,
    });
  }
}

// Custom error class for merge conflicts
class MergeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeConflictError";
  }
}

async function handleMergeBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: GitBranchParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  // Check if branch exists locally, if not, check if it's a remote branch
  const localBranches = await gitListBranches({ path: appPath });
  let remoteBranches: string[] = [];
  try {
    remoteBranches = await gitListRemoteBranches({
      path: appPath,
    });
  } catch (error: any) {
    logger.warn(`Failed to list remote branches: ${error.message}`);
    // Continue with empty remote branches list
  }

  let mergeBranchRef = branch;

  // If branch doesn't exist locally but exists remotely, use remote ref
  if (!localBranches.includes(branch) && remoteBranches.includes(branch)) {
    mergeBranchRef = `origin/${branch}`;
  }

  // Check for uncommitted changes
  await withLock(appId, async () => {
    await ensureCleanWorkspace(appPath, `merging branch '${branch}'`);
  });
  try {
    await gitMerge({
      path: appPath,
      branch: mergeBranchRef,
    });
  } catch (mergeError: any) {
    // Convert to MergeConflictError for component compatibility
    if (mergeError?.name === "GitConflictError") {
      throw new MergeConflictError(mergeError.message);
    }

    // Fallback: Check if error is about uncommitted changes
    const errorMessage = mergeError?.message || "Failed to merge branch.";
    const lowerMessage = errorMessage.toLowerCase();
    if (
      lowerMessage.includes("local changes") ||
      lowerMessage.includes("would be overwritten") ||
      lowerMessage.includes("please commit or stash")
    ) {
      throw new Error(
        `Failed to merge branch: uncommitted changes detected. ` +
          "Please commit or stash your changes manually and try again.",
      );
    }

    // Otherwise, throw the original error
    throw mergeError;
  }
}

async function handleListLocalBranches(
  event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<{ branches: string[]; current: string | null }> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  const branches = await gitListBranches({ path: appPath });
  const current = await gitCurrentBranch({ path: appPath });
  return { branches, current: current || null };
}

async function handleListRemoteBranches(
  event: IpcMainInvokeEvent,
  { appId, remote = "origin" }: { appId: number; remote?: string },
): Promise<string[]> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  const branches = await gitListRemoteBranches({ path: appPath, remote });
  return branches;
}

async function handleGetUncommittedFiles(
  event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<UncommittedFile[]> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  return getGitUncommittedFilesWithStatus({ path: appPath });
}

async function handleCommitChanges(
  event: IpcMainInvokeEvent,
  { appId, message }: { appId: number; message: string },
): Promise<string> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);

  return withLock(appId, async () => {
    // Check for merge or rebase in progress
    if (isGitMergeInProgress({ path: appPath })) {
      throw GitStateError(
        "Cannot commit: merge in progress. Please complete or abort the merge first.",
        GIT_ERROR_CODES.MERGE_IN_PROGRESS,
      );
    }

    if (isGitRebaseInProgress({ path: appPath })) {
      throw GitStateError(
        "Cannot commit: rebase in progress. Please complete or abort the rebase first.",
        GIT_ERROR_CODES.REBASE_IN_PROGRESS,
      );
    }

    // Stage all changes
    await gitAddAll({ path: appPath });

    // Commit with the provided message
    const commitHash = await gitCommit({ path: appPath, message });

    return commitHash;
  });
}

// --- GitHub Pull Handler ---
async function handlePullFromGithub(
  event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<void> {
  const settings = readSettings();
  const accessToken = settings.githubAccessToken?.value;
  if (!accessToken) {
    throw new Error("Not authenticated with GitHub.");
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new Error("App is not linked to a GitHub repo.");
  }
  const appPath = getDyadAppPath(app.path);
  const currentBranch = await gitCurrentBranch({ path: appPath });

  try {
    await gitPull({
      path: appPath,
      remote: "origin",
      branch: currentBranch || "main",
      accessToken,
    });
  } catch (pullError: any) {
    // Check if it's a missing remote branch error
    const errorMessage = pullError?.message || "";
    const isMissingRemoteBranch =
      pullError?.code === "MissingRefError" ||
      (pullError?.code === "NotFoundError" &&
        (errorMessage.includes("remote ref") ||
          errorMessage.includes("remote branch"))) ||
      errorMessage.includes("couldn't find remote ref") ||
      errorMessage.includes("Cannot read properties of null");

    // If the remote branch doesn't exist yet, we can ignore this
    // (e.g., user hasn't pushed the branch yet)
    if (!isMissingRemoteBranch) {
      throw pullError;
    } else {
      logger.debug(
        "[GitHub Handler] Remote branch missing during pull, continuing",
        errorMessage,
      );
    }
  }
}

// --- Registration ---
export function registerGithubBranchHandlers() {
  createTypedHandler(githubContracts.mergeAbort, handleAbortMerge);
  createTypedHandler(githubContracts.fetch, handleFetchFromGithub);
  createTypedHandler(githubContracts.pull, handlePullFromGithub);
  createTypedHandler(githubContracts.createBranch, handleCreateBranch);
  createTypedHandler(githubContracts.deleteBranch, handleDeleteBranch);
  createTypedHandler(githubContracts.switchBranch, handleSwitchBranch);
  createTypedHandler(githubContracts.renameBranch, handleRenameBranch);
  createTypedHandler(githubContracts.mergeBranch, handleMergeBranch);
  createTypedHandler(
    githubContracts.listLocalBranches,
    handleListLocalBranches,
  );
  createTypedHandler(
    githubContracts.listRemoteBranches,
    handleListRemoteBranches,
  );
  createTypedHandler(
    gitContracts.getUncommittedFiles,
    handleGetUncommittedFiles,
  );
  createTypedHandler(gitContracts.commitChanges, handleCommitChanges);
}
