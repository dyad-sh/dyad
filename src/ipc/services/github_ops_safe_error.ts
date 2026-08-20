import { MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH } from "@/github_ops/state";

const TRUNCATION_NOTICE = "\n… [GitHub error output truncated]";

function redactSensitiveGitOutput(message: string): string {
  return message
    .replaceAll(
      /\b(?:authorization|private-token|access-token)\s*[:=]\s*(?:Bearer\s+)?[^\s]+/gi,
      "[redacted credential]",
    )
    .replaceAll(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/gi,
      "[redacted token]",
    )
    .replaceAll(
      /\b(?:https?|ssh|git):\/\/[^\s<>"']*[^\s<>"'.,;:!?)}\]]/gi,
      "[redacted URL]",
    )
    .replaceAll(/\bgit@[\w.-]+:[^\s]+/gi, "[redacted remote]")
    .replaceAll(
      /(^|[\s("'`])\/(?:[^/\s"'`]+\/)+[^/\s"'`]+/gm,
      "$1[redacted path]",
    )
    .replaceAll(
      /\b[A-Za-z]:[\\/](?:[^\\/\s"']+[\\/])+[^\\/\s"']+/g,
      "[redacted path]",
    );
}

/**
 * Remote snapshots may be logged, persisted in diagnostics, or observed by a
 * different window. Preserve actionable Git output while redacting sensitive
 * repository details and bounding the projected message.
 */
export function safeGithubOpsErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const raw =
    error instanceof Error && error.message
      ? error.message
          .replaceAll(/\r\n?/g, "\n")
          .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
          .trim()
      : "";
  if (!raw) return fallback;

  const redacted = redactSensitiveGitOutput(raw);
  if (redacted.length <= MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH) return redacted;

  return (
    redacted.slice(
      0,
      MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH - TRUNCATION_NOTICE.length,
    ) + TRUNCATION_NOTICE
  );
}
