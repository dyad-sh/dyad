import { truncateGithubOpsErrorMessage } from "@/github_ops/error_message";

function redactSensitiveGitOutput(message: string): string {
  return message
    .replaceAll(
      /\b(?:authorization|private-token|access-token)\s*[:=][^\r\n]*/gi,
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
    .replaceAll(/\b(?:[\w.-]+\/)+[\w.-]+\.git\b/gi, "[redacted remote]")
    .replaceAll(
      /\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|home|corp)\b/gi,
      "[redacted host]",
    )
    .replaceAll(/(['"`])\/[^\r\n]*\1/g, "$1[redacted path]$1")
    .replaceAll(/(['"])[A-Za-z]:[\\/][^\r\n]*\1/g, "$1[redacted path]$1")
    .replaceAll(/(['"])\\\\[^\r\n]*\1/g, "$1[redacted path]$1")
    .replaceAll(/\[\/[^\r\n\]]+\]/g, "[[redacted path]]")
    .replaceAll(
      /(^|[\s("'`=[,])\/(?:[^/\s"'`]+\/)+[^/\s"'`]+/gm,
      "$1[redacted path]",
    )
    .replaceAll(
      /\b[A-Za-z]:[\\/](?:[^\\/\s"']+[\\/])+[^\\/\s"']+/g,
      "[redacted path]",
    )
    .replaceAll(/\\\\[^\\\s"'`]+(?:\\[^\\\s"'`]+)+/g, "[redacted path]");
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

  return truncateGithubOpsErrorMessage(redactSensitiveGitOutput(raw));
}
