import { IpcMainInvokeEvent } from "electron";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
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
  gitDiscardAllChanges,
  getFileAtCommit,
  isMissingRemoteBranchError,
} from "../utils/git_utils";
import { gitService } from "../services/git_service";
import { getDyadAppPath } from "../../paths/paths";
import { safeJoin } from "../utils/path_utils";
import { promises as fsPromises } from "node:fs";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { withLock } from "../utils/lock_utils";
import { updateAppGithubRepo, ensureCleanWorkspace } from "./github_handlers";
import { createTypedHandler } from "./base";
import { createAppMutationLock } from "../utils/app_mutation_lock";
import { githubContracts, gitContracts } from "../types/github";
import { ensureDyadGitignored } from "./gitignoreUtils";
import type {
  GitBranchAppIdParams,
  CreateGitBranchParams,
  GitBranchParams,
  RenameGitBranchParams,
  UncommittedFile,
  GetUncommittedFileDiffParams,
  UncommittedFileDiff,
} from "../types/github";

const logger = log.scope("git_branch_handlers");

async function handleAbortMerge(
  event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
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
    throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new DyadError(
      "App is not linked to a GitHub repo.",
      DyadErrorKind.Precondition,
    );
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
    throw new DyadError(
      "Branch name must be between 1 and 255 characters",
      DyadErrorKind.Validation,
    );
  }
  if (!/^[a-zA-Z0-9/_.-]+$/.test(branch) || /\.\./.test(branch)) {
    throw new DyadError(
      "Branch name contains invalid characters",
      DyadErrorKind.Validation,
    );
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
    throw new DyadError("Invalid branch name", DyadErrorKind.Validation);
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  const appPath = getDyadAppPath(app.path);

  await gitCreateBranch({
    path: appPath,
    branch,
    from,
  });
}

export async function handleDeleteBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: GitBranchParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  const appPath = getDyadAppPath(app.path);

  // Check if branch exists locally
  const localBranches = await gitListBranches({ path: appPath });
  const existsLocally = localBranches.includes(branch);

  if (existsLocally) {
    // Delete local branch
    await gitDeleteBranch({
      path: appPath,
      branch,
    });
  } else {
    // Branch doesn't exist locally - it may only exist on remote
    // or has already been deleted. Check if it exists remotely.
    let remoteBranches: string[];
    try {
      remoteBranches = await gitListRemoteBranches({ path: appPath });
    } catch (error) {
      logger.warn(
        `Failed to list remote branches while checking for branch '${branch}' to delete.`,
        error,
      );
      throw new DyadError(
        `Branch '${branch}' does not exist locally and remote branches could not be checked. Please try again later.`,
        DyadErrorKind.Conflict,
      );
    }

    if (!remoteBranches.includes(branch)) {
      // Branch doesn't exist locally or remotely - it's already been deleted
      logger.info(
        `Branch '${branch}' not found locally or remotely - may have already been deleted`,
      );
      return; // Success - nothing to delete
    }

    // Branch only exists remotely - inform user they need to delete it on GitHub
    if (app.githubOrg && app.githubRepo) {
      throw new DyadError(
        `Branch '${branch}' only exists on the remote. To delete it, please delete the branch on GitHub directly. Visit https://github.com/${app.githubOrg}/${app.githubRepo}/branches to manage remote branches.`,
        DyadErrorKind.Conflict,
      );
    }
    throw new DyadError(
      `Branch '${branch}' only exists on the remote and cannot be deleted locally. Please delete it from your remote Git hosting provider.`,
      DyadErrorKind.Conflict,
    );
  }
}

async function handleSwitchBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: GitBranchParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
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

  await ensureCleanWorkspace(appPath, `switching to branch '${branch}'`);
  await gitCheckout({
    path: appPath,
    ref: branch,
  });

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
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
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

async function handleMergeBranch(
  event: IpcMainInvokeEvent,
  { appId, branch }: GitBranchParams,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
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

  await ensureCleanWorkspace(appPath, `merging branch '${branch}'`);
  await gitMerge({
    path: appPath,
    branch: mergeBranchRef,
  });
}

async function handleListLocalBranches(
  event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<{ branches: string[]; current: string | null }> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
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
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  const appPath = getDyadAppPath(app.path);

  const branches = await gitListRemoteBranches({ path: appPath, remote });
  return branches;
}

async function handleGetUncommittedFiles(
  event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<UncommittedFile[]> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  const appPath = getDyadAppPath(app.path);

  return getGitUncommittedFilesWithStatus({ path: appPath });
}

async function handleGetUncommittedFileDiff(
  _event: IpcMainInvokeEvent,
  { appId, filePath }: GetUncommittedFileDiffParams,
): Promise<UncommittedFileDiff> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  const appPath = getDyadAppPath(app.path);

  // `filePath` comes from the renderer, so validate up front that it stays
  // within the app directory before using it to read files or git objects. This
  // rejects path-traversal attempts (e.g. "../../etc/passwd") with a clear error
  // rather than silently returning an empty diff.
  let resolvedPath: string;
  try {
    resolvedPath = safeJoin(appPath, filePath);
  } catch {
    throw new DyadError("Invalid file path", DyadErrorKind.Validation);
  }

  // "before" side: the file at HEAD. Missing (newly added file) → empty.
  let oldContent =
    (await getFileAtCommit({ path: appPath, filePath, commitHash: "HEAD" })) ??
    "";

  // A renamed file has no HEAD blob under its new path, so the lookup above
  // returns empty and the diff would show the whole file as added. Recover the
  // original path from status and read the HEAD content there instead, so the
  // rename renders as an actual before/after diff.
  if (!oldContent) {
    const uncommitted = await getGitUncommittedFilesWithStatus({
      path: appPath,
    });
    const renamed = uncommitted.find(
      (file) =>
        file.path === filePath && file.status === "renamed" && file.oldPath,
    );
    if (renamed?.oldPath) {
      oldContent =
        (await getFileAtCommit({
          path: appPath,
          filePath: renamed.oldPath,
          commitHash: "HEAD",
        })) ?? "";
    }
  }

  // "after" side: the current working-tree contents. Missing (deleted) → empty.
  let newContent = "";
  try {
    newContent = await fsPromises.readFile(resolvedPath, "utf-8");
  } catch {
    newContent = "";
  }

  return { path: filePath, oldContent, newContent };
}

async function withAppGitOp<T>(
  appId: number,
  operation: string,
  fn: (appPath: string) => Promise<T>,
): Promise<T> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  const appPath = getDyadAppPath(app.path);

  return withLock(appId, async () => {
    if (isGitMergeInProgress({ path: appPath })) {
      throw GitStateError(
        `Cannot ${operation}: merge in progress. Please complete or abort the merge first.`,
        GIT_ERROR_CODES.MERGE_IN_PROGRESS,
      );
    }

    if (isGitRebaseInProgress({ path: appPath })) {
      throw GitStateError(
        `Cannot ${operation}: rebase in progress. Please complete or abort the rebase first.`,
        GIT_ERROR_CODES.REBASE_IN_PROGRESS,
      );
    }

    return fn(appPath);
  });
}

async function handleCommitChanges(
  _event: IpcMainInvokeEvent,
  { appId, message }: { appId: number; message: string },
): Promise<string> {
  return withAppGitOp(appId, "commit", async (appPath) => {
    await ensureDyadGitignored(appPath);
    return gitService.stageAllAndCommit({ path: appPath, message });
  });
}

async function handleDiscardChanges(
  _event: IpcMainInvokeEvent,
  { appId }: GitBranchAppIdParams,
): Promise<void> {
  return withAppGitOp(appId, "discard changes", async (appPath) => {
    await gitDiscardAllChanges({ path: appPath });
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
    throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
  }
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app || !app.githubOrg || !app.githubRepo) {
    throw new DyadError(
      "App is not linked to a GitHub repo.",
      DyadErrorKind.Precondition,
    );
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
    const isMissingRemoteBranch = isMissingRemoteBranchError(pullError);

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
  createTypedHandler(
    githubContracts.mergeAbort,
    createAppMutationLock(handleAbortMerge),
  );
  createTypedHandler(
    githubContracts.fetch,
    createAppMutationLock(handleFetchFromGithub),
  );
  createTypedHandler(
    githubContracts.pull,
    createAppMutationLock(handlePullFromGithub),
  );
  createTypedHandler(
    githubContracts.createBranch,
    createAppMutationLock(handleCreateBranch),
  );
  createTypedHandler(
    githubContracts.deleteBranch,
    createAppMutationLock(handleDeleteBranch),
  );
  createTypedHandler(
    githubContracts.switchBranch,
    createAppMutationLock(handleSwitchBranch),
  );
  createTypedHandler(
    githubContracts.renameBranch,
    createAppMutationLock(handleRenameBranch),
  );
  createTypedHandler(
    githubContracts.mergeBranch,
    createAppMutationLock(handleMergeBranch),
  );
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
  createTypedHandler(
    gitContracts.getUncommittedFileDiff,
    handleGetUncommittedFileDiff,
  );
  createTypedHandler(gitContracts.commitChanges, handleCommitChanges);
  createTypedHandler(gitContracts.discardChanges, handleDiscardChanges);
}
