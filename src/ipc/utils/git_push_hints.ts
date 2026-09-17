import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { AppGitRemote } from "./app_git_remote";

/**
 * GitLab protects a project's default branch by default and refuses force
 * pushes to it for everyone, owners included. The rejection arrives as a
 * pre-receive hook message that says nothing about where to change that.
 *
 * The patterns name branch protection explicitly. A bare "pre-receive hook
 * declined" is deliberately not among them: GitLab raises the same suffix for
 * every push rule — commit-message formats, file-size limits, committer-email
 * restrictions — and sending someone to Protected branches for those points
 * at a setting that has nothing to do with the rejection.
 */
const PROTECTED_BRANCH_PATTERNS = [
  /protected branch/i,
  /protected branches/i,
  /not allowed to force push/i,
];

export function isProtectedBranchRejection(message: string): boolean {
  return PROTECTED_BRANCH_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Where to change the setting that blocked this push.
 *
 * The remedy differs by operation: a rejected force push needs "Allow force
 * push" for the branch, while a rejected ordinary push needs push permission
 * for the role the user has. Telling someone to allow force pushes when they
 * did not force anything sends them to a switch that will not help.
 */
export function protectedBranchHint(branch: string, forced: boolean): string {
  const remedy = forced
    ? `allow force push for "${branch}"`
    : `allow your role to push to "${branch}"`;
  return (
    `GitLab protects the "${branch}" branch, which blocks this push. ` +
    `In the project's Settings > Repository > Protected branches, ${remedy} ` +
    `(or push to a branch that is not protected) and try again.`
  );
}

/**
 * The same error, with a hint appended when a GitLab push was refused by
 * branch protection. Everything else passes through untouched, including
 * the coded errors the sync machine matches on.
 */
export function withPushHint(
  error: unknown,
  remote: AppGitRemote,
  { forced = false }: { forced?: boolean } = {},
): unknown {
  if (remote.provider !== "gitlab") return error;
  const message = error instanceof Error ? error.message : String(error);
  if (!isProtectedBranchRejection(message)) return error;
  const hinted = new DyadError(
    `${message}\n\n${protectedBranchHint(remote.branch, forced)}`,
    isDyadError(error) ? error.kind : DyadErrorKind.Conflict,
  );
  // A coded git error stays coded, so the machine still recognises it.
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string") {
    Object.assign(hinted, { code });
  }
  return hinted;
}
