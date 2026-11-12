import { isVersionAtLeast } from "./version_utils";

/** Minimum CLI version allowed to create isolated worktrees for Claude chats. */
export const CLAUDE_CROSS_DIRECTORY_RESUME_VERSION = "2.1.19";

/** Only a plain release version the CLI reported counts as known. */
const CLAUDE_RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

export function isClaudeVersionAtLeast(
  version: string | null,
  minimum: string,
): boolean {
  return (
    version !== null &&
    CLAUDE_RELEASE_VERSION.test(version) &&
    isVersionAtLeast(version, minimum)
  );
}

export function canClaudeResumeFromAnotherDirectory(
  version: string | null,
): boolean {
  return isClaudeVersionAtLeast(version, CLAUDE_CROSS_DIRECTORY_RESUME_VERSION);
}
