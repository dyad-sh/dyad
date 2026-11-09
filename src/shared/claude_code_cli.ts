/**
 * Oldest Claude Code CLI verified to `--resume` a session from a different
 * working directory. Older releases (2.1.42 was checked) look the session up
 * only under the current directory's project and fail with "No conversation
 * found with session ID". Worktree isolation needs it for Claude Code chats.
 */
export const CLAUDE_CROSS_DIRECTORY_RESUME_VERSION = "2.1.319";
