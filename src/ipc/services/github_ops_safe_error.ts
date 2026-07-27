const MAX_REMOTE_ERROR_LENGTH = 500;
const UNSAFE_ERROR_CONTENT = [
  /\b(?:https?|ssh|git):\/\/\S+/i,
  /\bgit@[\w.-]+:[^\s]+/i,
  /(?:^|[\s("'`])\/(?:[^/\s]+\/)+[^/\s]+/,
  /\b[A-Za-z]:[\\/](?:[^\\/\s]+[\\/])+[^\\/\s]+/,
  /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/i,
  /\b(?:authorization|private-token|access-token)\s*[:=]/i,
] as const;

/**
 * Keep detailed Git/GitHub failures main-only. Remote snapshots may be logged,
 * persisted in diagnostics, or observed by a different window, so they carry
 * only bounded messages that do not expose repository locations or remotes.
 */
export function safeGithubOpsErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const raw =
    error instanceof Error && error.message
      ? error.message.replaceAll(/[\u0000-\u001f\u007f]/g, " ").trim()
      : "";
  if (
    !raw ||
    raw.length > MAX_REMOTE_ERROR_LENGTH ||
    UNSAFE_ERROR_CONTENT.some((pattern) => pattern.test(raw))
  ) {
    return fallback;
  }
  return raw;
}
