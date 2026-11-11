/** Minimum CLI version allowed to create isolated worktrees for Claude chats. */
export const CLAUDE_CROSS_DIRECTORY_RESUME_VERSION = "2.1.19";

export function isClaudeVersionAtLeast(
  version: string | null,
  minimum: string,
): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  const floor = minimum.split(".").map(Number);
  for (let index = 0; index < floor.length; index++) {
    if (parts[index] !== floor[index]) return parts[index] > floor[index];
  }
  return true;
}

export function canClaudeResumeFromAnotherDirectory(
  version: string | null,
): boolean {
  return isClaudeVersionAtLeast(version, CLAUDE_CROSS_DIRECTORY_RESUME_VERSION);
}
