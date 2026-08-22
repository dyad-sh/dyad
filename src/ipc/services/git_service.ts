import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

import {
  ensureGitLineEndingPolicy,
  GIT_ERROR_CODES,
  gitAdd,
  gitAddAll,
  gitCommit,
  gitInit,
  gitRemove,
  hasStagedChanges,
  GitStateError,
} from "../utils/git_utils";
import {
  formatPreCommitOutput,
  isCommitMsgHookAvailable,
  isPreCommitHookAvailable,
  isPrepareCommitMsgHookAvailable,
  PRE_COMMIT_TIMEOUT_MS,
  runCommitMsgHook,
  runPreCommitHook,
  runPrepareCommitMsgHook,
} from "./pre_commit_service";
import type { BufferedProcessResult } from "../utils/buffered_process";
import type { CommitProgressPhase } from "../types/github";

const logger = log.scope("git_service");

/**
 * Aborts the commit with a code the renderer recognizes as a cancellation.
 *
 * `signal.throwIfAborted()` raises a bare `AbortError`, which the renderer
 * cannot tell apart from a real Git failure and would surface as an error
 * toast even though the user asked to stop.
 */
function throwIfCommitCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw GitStateError(
      "The commit was cancelled.",
      GIT_ERROR_CODES.COMMIT_CANCELLED,
    );
  }
}

/**
 * Runs one commit-message hook and returns the message it left behind.
 *
 * Failures carry the caller's hook-specific error code so the renderer can
 * show accurate guidance with the hook output in an inline, scrollable panel
 * instead of dumping thousands of characters into a toast.
 */
async function runMessageHookPhase({
  path,
  message,
  signal,
  run,
  label,
  failureCode,
}: {
  path: string;
  message: string;
  signal?: AbortSignal;
  run: (args: {
    path: string;
    message: string;
    signal?: AbortSignal;
  }) => Promise<BufferedProcessResult & { message: string }>;
  label: string;
  failureCode:
    | typeof GIT_ERROR_CODES.PREPARE_COMMIT_MSG_FAILED
    | typeof GIT_ERROR_CODES.COMMIT_MSG_FAILED;
}): Promise<string> {
  let result;
  try {
    result = await run({ path, message, signal });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new DyadError(
      `${label} could not start. ${details}`,
      DyadErrorKind.External,
      { cause: error },
    );
  }

  const output = formatPreCommitOutput(result.stdout, result.stderr);
  if (result.timedOut) {
    throw GitStateError(
      `${label} exceeded ${Math.round(PRE_COMMIT_TIMEOUT_MS / 60_000)} minutes and were stopped.\n\n${output}`,
      failureCode,
    );
  }
  if (result.aborted) {
    throw GitStateError(
      `${label} were cancelled.`,
      GIT_ERROR_CODES.COMMIT_CANCELLED,
    );
  }
  if (result.code !== 0) {
    throw GitStateError(
      `${label} failed with exit code ${result.code ?? "unknown"}.\n\n${output}`,
      failureCode,
    );
  }
  return result.message;
}

/** Why a removal couldn't be committed, or null when it was. */
export type RemoveFileUncommittedReason = "untracked" | "commit-failed";

export interface RemoveFileAndCommitResult {
  /** The commit hash, or null when nothing was committed. */
  commitHash: string | null;
  /** Null when the deletion was committed. */
  uncommittedReason: RemoveFileUncommittedReason | null;
}

/**
 * Intent-level facade over the low-level primitives in `git_utils.ts`.
 *
 * Bundles the multi-step stage/commit sequences that were previously
 * hand-rolled at each call site, so callers depend on a single mockable
 * service instead of sequencing individual git functions themselves.
 *
 * Prefer methods here for stage/commit flows so call sites depend on one
 * mockable seam. Multi-step sequences (stage-all-and-commit, init-and-commit)
 * clearly belong here; the single-file `stageFile`/`commitFile` helpers live
 * here too so the "save = stage, commit later" flow shares that same seam and
 * documents the .gitignore no-op behavior in one place. Genuinely unrelated
 * one-off git operations should keep using `git_utils.ts` directly.
 */
export class GitService {
  /**
   * Initializes a git repository on `ref` and creates the initial commit
   * containing all files. Returns the initial commit hash.
   */
  async initRepoWithInitialCommit({
    path,
    message = "Init Dyad app",
    ref = "main",
  }: {
    path: string;
    message?: string;
    ref?: string;
  }): Promise<string> {
    await gitInit({ path, ref });
    await ensureGitLineEndingPolicy({ path, writeGitattributes: true });
    await gitAddAll({ path });
    return gitCommit({ path, message });
  }

  /**
   * Stages all changes and commits them. Returns the commit hash.
   * Throws if there is nothing to commit.
   */
  async stageAllAndCommit({
    path,
    message,
  }: {
    path: string;
    message: string;
  }): Promise<string> {
    await gitAddAll({ path });
    return gitCommit({ path, message });
  }

  /**
   * Stages all changes, runs the repository's installed commit hooks as
   * explicit verification phases, then commits without invoking them a second
   * time.
   *
   * The hooks run in Git's own order — `pre-commit`, `prepare-commit-msg`,
   * `commit-msg` — so a `prepare-commit-msg` hook that rewrites the message
   * does so before `commit-msg` validates it, and the validated text is what
   * `gitCommit` actually records. Hook failures use stable error codes so the
   * renderer can offer recovery without mistaking unrelated Git failures for
   * hook failures.
   */
  async stageAllAndCommitWithPreCommit({
    path,
    message,
    onProgress,
    signal,
  }: {
    path: string;
    message: string;
    onProgress?: (phase: CommitProgressPhase) => void;
    signal?: AbortSignal;
  }): Promise<string> {
    throwIfCommitCancelled(signal);
    onProgress?.("staging");
    await gitAddAll({ path });
    throwIfCommitCancelled(signal);

    if (await isPreCommitHookAvailable(path)) {
      onProgress?.("pre-commit");
      let result;
      try {
        result = await runPreCommitHook({ path, signal });
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        throw new DyadError(
          `Pre-commit checks could not start. ${details}`,
          DyadErrorKind.External,
          { cause: error },
        );
      }

      const output = formatPreCommitOutput(result.stdout, result.stderr);
      if (result.timedOut) {
        throw GitStateError(
          `Pre-commit checks exceeded ${Math.round(PRE_COMMIT_TIMEOUT_MS / 60_000)} minutes and were stopped.\n\n${output}`,
          GIT_ERROR_CODES.PRE_COMMIT_FAILED,
        );
      }
      if (result.aborted) {
        throw GitStateError(
          "Pre-commit checks were cancelled.",
          GIT_ERROR_CODES.COMMIT_CANCELLED,
        );
      }
      if (result.code !== 0) {
        throw GitStateError(
          `Pre-commit checks failed with exit code ${result.code ?? "unknown"}.\n\n${output}`,
          GIT_ERROR_CODES.PRE_COMMIT_FAILED,
        );
      }
    }

    throwIfCommitCancelled(signal);

    const [hasPrepareCommitMsgHook, hasCommitMsgHook] = await Promise.all([
      isPrepareCommitMsgHookAvailable(path),
      isCommitMsgHookAvailable(path),
    ]);
    let validatedMessage = message;
    if (hasPrepareCommitMsgHook || hasCommitMsgHook) {
      throwIfCommitCancelled(signal);
      onProgress?.("commit-msg");

      if (hasPrepareCommitMsgHook) {
        validatedMessage = await runMessageHookPhase({
          path,
          message: validatedMessage,
          signal,
          run: runPrepareCommitMsgHook,
          label: "Commit-message preparation",
          failureCode: GIT_ERROR_CODES.PREPARE_COMMIT_MSG_FAILED,
        });
        throwIfCommitCancelled(signal);
      }

      if (hasCommitMsgHook) {
        validatedMessage = await runMessageHookPhase({
          path,
          message: validatedMessage,
          signal,
          run: runCommitMsgHook,
          label: "Commit-message checks",
          failureCode: GIT_ERROR_CODES.COMMIT_MSG_FAILED,
        });
      }
    }

    throwIfCommitCancelled(signal);
    onProgress?.("committing");
    return gitCommit({ path, message: validatedMessage });
  }

  /**
   * Stages all changes and commits only when something is actually staged.
   * Returns the commit hash, or null when there was nothing to commit.
   */
  async stageAllAndCommitIfChanged({
    path,
    message,
  }: {
    path: string;
    message: string;
  }): Promise<string | null> {
    await gitAddAll({ path });
    if (!(await hasStagedChanges({ path }))) {
      return null;
    }
    return gitCommit({ path, message });
  }

  /**
   * Stages a single file without committing. Used when file saves should
   * accumulate as staged changes to be committed together later, rather than
   * producing one commit per save.
   *
   * `gitAdd` skips files ignored by .gitignore (e.g. `.env.local`), so staging
   * one of those is a no-op rather than an error.
   */
  async stageFile({
    path,
    filepath,
  }: {
    path: string;
    filepath: string;
  }): Promise<void> {
    await gitAdd({ path, filepath });
  }

  /**
   * Stages a single file and commits it. Returns the commit hash, or null
   * when there was nothing to commit.
   *
   * `gitAdd` skips files ignored by .gitignore (e.g. `.env.local`), which
   * leaves nothing staged. Guard the commit so those saves don't fail with
   * "nothing to commit, working tree clean".
   */
  async commitFile({
    path,
    filepath,
    message,
  }: {
    path: string;
    filepath: string;
    message: string;
  }): Promise<string | null> {
    await gitAdd({ path, filepath });
    if (!(await hasStagedChanges({ path }))) {
      return null;
    }
    return gitCommit({ path, message });
  }

  /**
   * Removes a file from the working tree and the index, then commits only that
   * deletion, leaving any other staged or unstaged changes alone.
   *
   * `git rm` deletes the file from disk *and* stages the removal in a single
   * operation, so callers should not unlink the file first: doing so opens a
   * window where a concurrent write could recreate the path and have it deleted
   * by the later `git rm -f`.
   *
   * Callers use this for deletions the user shouldn't have to review as an
   * uncommitted change. It is best-effort by design: an untracked file (nothing
   * for `git rm` to do), a non-repo folder, or a state that forbids partial
   * commits (mid-merge) must not turn into a failed delete. The returned
   * `uncommittedReason` says which of those happened, so callers can tell the
   * user whether the deletion is recoverable:
   * - `"untracked"`: git removed nothing, and the file is still on disk for the
   *   caller to delete. There is no history to restore from.
   * - `"commit-failed"`: the removal is staged (and the file is gone from disk),
   *   so it's recoverable through the normal uncommitted-changes flow.
   */
  async removeFileAndCommit({
    path,
    filepath,
    message,
  }: {
    path: string;
    filepath: string;
    message: string;
  }): Promise<RemoveFileAndCommitResult> {
    try {
      await gitRemove({ path, filepath });
    } catch (error) {
      logger.warn(
        `Couldn't git-remove '${filepath}' (likely untracked):`,
        error,
      );
      return { commitHash: null, uncommittedReason: "untracked" };
    }
    try {
      // Path-scoped so this commit contains the deletion and nothing else.
      const commitHash = await gitCommit({
        path,
        message,
        paths: [filepath],
      });
      return { commitHash, uncommittedReason: null };
    } catch (error) {
      // The removal is still staged, so the user can review or restore it
      // through the normal uncommitted-changes flow.
      logger.warn(
        `Staged deletion of '${filepath}' but couldn't commit it:`,
        error,
      );
      return { commitHash: null, uncommittedReason: "commit-failed" };
    }
  }
}

export const gitService = new GitService();
