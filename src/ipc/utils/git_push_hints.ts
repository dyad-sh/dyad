import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { AppGitRemote } from "./app_git_remote";

/**
 * GitLab protects a project's default branch by default and refuses force
 * pushes to it for everyone, owners included. The rejection arrives as a
 * pre-receive hook message that says nothing about where to change that.
 */
const PROTECTED_BRANCH_PATTERNS = [
  /protected branch/i,
  /not allowed to force push/i,
  /pre-receive hook declined/i,
];

export function isProtectedBranchRejection(message: string): boolean {
  return PROTECTED_BRANCH_PATTERNS.some((pattern) => pattern.test(message));
}

export function protectedBranchHint(branch: string): string {
  return (
    `GitLab protects the "${branch}" branch, which blocks this push. ` +
    `In the project's Settings > Repository > Protected branches, allow force ` +
    `push for "${branch}" (or push to a branch that is not protected) and try again.`
  );
}

/**
 * The same error, with a hint appended when a GitLab push was refused by
 * branch protection. Everything else passes through untouched, including
 * the coded errors the sync machine matches on.
 */
export function withPushHint(error: unknown, remote: AppGitRemote): unknown {
  if (remote.provider !== "gitlab") return error;
  const message = error instanceof Error ? error.message : String(error);
  if (!isProtectedBranchRejection(message)) return error;
  const hinted = new DyadError(
    `${message}\n\n${protectedBranchHint(remote.branch)}`,
    isDyadError(error) ? error.kind : DyadErrorKind.Conflict,
  );
  // A coded git error stays coded, so the machine still recognises it.
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string") {
    Object.assign(hinted, { code });
  }
  return hinted;
}
