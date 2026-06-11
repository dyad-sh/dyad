import {
  gitAdd,
  gitAddAll,
  gitCommit,
  gitInit,
  hasStagedChanges,
} from "../utils/git_utils";

/**
 * Intent-level facade over the low-level primitives in `git_utils.ts`.
 *
 * Bundles the multi-step stage/commit sequences that were previously
 * hand-rolled at each call site, so callers depend on a single mockable
 * service instead of sequencing individual git functions themselves.
 *
 * Keep methods here limited to sequences with more than one call site;
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
   * Stages a single file and commits it. Returns the commit hash.
   */
  async commitFile({
    path,
    filepath,
    message,
  }: {
    path: string;
    filepath: string;
    message: string;
  }): Promise<string> {
    await gitAdd({ path, filepath });
    return gitCommit({ path, message });
  }
}

export const gitService = new GitService();
