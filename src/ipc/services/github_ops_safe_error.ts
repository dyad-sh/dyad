import {
  MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH,
  truncateGithubOpsErrorMessage,
} from "@/github_ops/error_message";

const PUBLIC_GIT_DOCUMENTATION_URL =
  /\bhttps?:\/\/(?:gh\.io|docs\.github\.com|git-lfs\.github\.com|git-scm\.com)(?:\/[^\s<>"'.,;:!?)}\]]*)?/gi;

function redactQuotedAbsolutePaths(message: string): string {
  return message
    .split("\n")
    .map((line) => {
      let result = "";
      let cursor = 0;

      while (cursor < line.length) {
        const match = line
          .slice(cursor)
          .match(/(['"`])(?:\/|[A-Za-z]:[\\/]|\\\\)/);
        if (match?.index === undefined) {
          result += line.slice(cursor);
          break;
        }

        const start = cursor + match.index;
        const quote = match[1];
        let closing = line.indexOf(quote, start + match[0].length);
        while (
          closing !== -1 &&
          quote === "'" &&
          /[A-Za-z0-9]/.test(line[closing + 1] ?? "")
        ) {
          closing = line.indexOf(quote, closing + 1);
        }
        if (closing === -1) {
          result += line.slice(cursor);
          break;
        }

        result += `${line.slice(cursor, start)}${quote}[redacted path]${quote}`;
        cursor = closing + 1;
      }

      return result;
    })
    .join("\n");
}

function redactSensitiveGitOutput(message: string): string {
  const publicDocumentationUrls: string[] = [];
  const protectedMessage = message.replaceAll(
    PUBLIC_GIT_DOCUMENTATION_URL,
    (url) => {
      const index = publicDocumentationUrls.push(url) - 1;
      return `DYAD_PUBLIC_GIT_DOCUMENTATION_URL_${index}`;
    },
  );

  const redacted = redactQuotedAbsolutePaths(protectedMessage)
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
    .replaceAll(
      /\b(?:[\w.-]+@[\w.-]+|[\w.-]+\.[\w.-]+):(?!\d+(?::\d+)*\b)[^\s<>"']+/gi,
      "[redacted remote]",
    )
    .replaceAll(/\b(?:[\w.-]+\/)+[\w.-]+\.git\b/gi, "[redacted remote]")
    .replaceAll(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted identity]",
    )
    .replaceAll(/(\bdenied to\s+)[^\s.,;:!?)}\]]+/gi, "$1[redacted identity]")
    .replaceAll(
      /\b(?:[a-z0-9-]+\.)+(?:internal|lan|corp)\b/gi,
      "[redacted host]",
    )
    .replaceAll(/\[\/[^\r\n\]]+\]/g, "[[redacted path]]")
    .replaceAll(
      /(^|[\s("'`=[,])\/[^\r\n]*?\/\.git(?:\/[^\s"'`,;:)}\]]+)?/gm,
      "$1[redacted path]",
    )
    .replaceAll(
      /\b[A-Za-z]:[\\/][^\r\n]*?[\\/]\.git(?:[\\/][^\s"'`,;:)}\]]+)?/g,
      "[redacted path]",
    )
    .replaceAll(
      /(^|[\s("'`=[,])\/(?:[^/\s"'`]+\/)+[^/\s"'`]+/gm,
      "$1[redacted path]",
    )
    .replaceAll(
      /\b[A-Za-z]:[\\/](?:[^\\/\s"']+[\\/])+[^\\/\s"']+/g,
      "[redacted path]",
    )
    .replaceAll(/\\\\[^\\\s"'`]+(?:\\[^\\\s"'`]+)+/g, "[redacted path]");

  return redacted.replaceAll(
    /DYAD_PUBLIC_GIT_DOCUMENTATION_URL_(\d+)/g,
    (_, index: string) => publicDocumentationUrls[Number(index)],
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

  const boundedRaw = raw.slice(0, MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH * 2);
  return truncateGithubOpsErrorMessage(redactSensitiveGitOutput(boundedRaw));
}
