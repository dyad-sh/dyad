import {
  MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH,
  truncateGithubOpsErrorMessage,
} from "@/github_ops/error_message";

const PUBLIC_GIT_DOCUMENTATION_URL =
  /\b(?:https:\/\/gh\.io\/lfs|https:\/\/git-lfs\.github\.com\/?)(?=$|[\s"'.,;:!?)}\]])/gi;
const MAX_GITHUB_OPS_ERROR_LINE_LENGTH = 4096;
const UNSAFE_GITHUB_ERROR_RESIDUAL =
  /(?:~[\\/]|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\/(?:Users|home|Volumes|srv|root|tmp|var|opt|private|mnt|workspace)\/|(?:^|[:#>|])\/[^/\s]+\/[^/\s]+|\\\\[^\s]+|\bgh[pousr]_[A-Za-z0-9_]+\b|\bgithub_pat_[A-Za-z0-9_]+\b|\bglpat-[A-Za-z0-9_-]{10,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bAKIA[A-Z0-9]{16}\b|\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}\b|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)/i;

function redactQuotedAbsolutePaths(message: string): string {
  return message
    .split("\n")
    .map((line) => {
      let result = "";
      let cursor = 0;
      const pathStart = /(['"`])(?:\/|[A-Za-z]:[\\/]|\\\\)/g;

      while (cursor < line.length) {
        pathStart.lastIndex = cursor;
        const match = pathStart.exec(line);
        if (!match) {
          result += line.slice(cursor);
          break;
        }

        const start = match.index;
        const quote = match[1];
        let closing = line.indexOf(quote, start + match[0].length);
        while (closing !== -1 && quote === "'") {
          const nextQuote = line.indexOf(quote, closing + 1);
          const nextCharacter = line[closing + 1] ?? "";
          const isEmbeddedApostrophe =
            /[A-Za-z0-9]/.test(nextCharacter) ||
            (/\s/.test(nextCharacter) &&
              nextQuote !== -1 &&
              /[\\/]/.test(line.slice(closing + 1, nextQuote)));
          if (!isEmbeddedApostrophe) break;
          closing = nextQuote;
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

function redactUnquotedAbsolutePaths(message: string): string {
  return message
    .split("\n")
    .map((line) => {
      let result = "";
      let cursor = 0;
      const pathStart = /(^|[\s("'`=[,:#>|])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)/g;
      const pathEnd =
        /(?=:\d+(?::\d+)*\b)|:(?=\s)|(?=\])|\s+(?=\(|… \[line truncated\]|(?:exists|is\b|was\b|does\b|cannot\b|could\b|failed\b|not\b|and\b|while\b|because\b|but\b|exited\b|returned\b))/g;

      while (cursor < line.length) {
        pathStart.lastIndex = cursor;
        const match = pathStart.exec(line);
        if (!match) {
          result += line.slice(cursor);
          break;
        }

        const prefixLength = match[1]?.length ?? 0;
        const start = match.index + prefixLength;
        pathEnd.lastIndex = pathStart.lastIndex;
        const endMatch = pathEnd.exec(line);
        let end = endMatch?.index ?? line.length;
        if (!endMatch) {
          const firstWhitespaceOffset = line
            .slice(pathStart.lastIndex)
            .search(/\s/);
          if (firstWhitespaceOffset !== -1) {
            const firstWhitespace = pathStart.lastIndex + firstWhitespaceOffset;
            const possiblePathRemainder = line.slice(firstWhitespace + 1);
            if (!/[\\/]/.test(possiblePathRemainder)) {
              end = firstWhitespace;
            }
          }
        }
        const hiddenText = line.slice(start, end);
        const remainderNotice =
          end === line.length && !endMatch && /\s/.test(hiddenText)
            ? " … [path remainder redacted]"
            : "";
        result += `${line.slice(cursor, start)}[redacted path]${remainderNotice}`;
        cursor = end;
      }

      return result;
    })
    .join("\n");
}

function redactSensitiveGitOutput(message: string): string {
  const publicDocumentationUrls: string[] = [];
  const privateKeysRedacted = message.replaceAll(
    /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    "[redacted private key]",
  );
  const protectedMessage = privateKeysRedacted.replaceAll(
    PUBLIC_GIT_DOCUMENTATION_URL,
    (url) => {
      const index = publicDocumentationUrls.push(url) - 1;
      return `DYAD_PUBLIC_GIT_DOCUMENTATION_URL_${index}`;
    },
  );

  const redacted = redactUnquotedAbsolutePaths(
    redactQuotedAbsolutePaths(protectedMessage),
  )
    .replaceAll(
      /\b(?:authorization|private-token|access-token)\s*[:=][^\r\n]*/gi,
      "[redacted credential]",
    )
    .replaceAll(
      /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"']*[^\s<>"'.,;:!?)}\]]/gi,
      "[redacted URL]",
    )
    .replaceAll(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/gi,
      "[redacted token]",
    )
    .replaceAll(
      /\b(?:glpat-[A-Za-z0-9_-]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16}|sk-ant-[A-Za-z0-9_-]{10,})\b/gi,
      "[redacted token]",
    )
    .replaceAll(
      /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}\b/gi,
      "Bearer [redacted secret]",
    )
    .replaceAll(
      /\b(?:[\w.-]{1,64}@)?\[[A-F0-9:]+\]:(?!\d+(?::\d+)*\b)[^\s<>"']+/gi,
      "[redacted remote]",
    )
    .replaceAll(
      /\b(?:[\w.-]{1,64}@[\w.-]{1,255}|[\w-]{1,63}(?:\.[\w-]{1,63})+):(?!\d+(?::\d+)*\b)[^\s<>"']+/gi,
      "[redacted remote]",
    )
    .replaceAll(
      /\b[\w-]{1,63}:(?!\d)(?=[^\s<>"']*\/)[^\s<>"']+/gi,
      "[redacted remote]",
    )
    .replaceAll(/\b(?:[\w.-]+\/)+[\w.-]+\.git\b/gi, "[redacted remote]")
    .replaceAll(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted identity]",
    )
    .replaceAll(
      /\b[A-Z0-9._%+-]+@(?:localhost\b|[A-Z0-9.-]+\.\(none\))/gi,
      "[redacted identity]",
    )
    .replaceAll(/(\bdenied to\s+)[^\s.,;:!?)}\]]+/gi, "$1[redacted identity]")
    .replaceAll(
      /\b(?:[a-z0-9-]+\.)+(?:internal|lan|corp)\b/gi,
      "[redacted host]",
    )
    .replaceAll(
      /(\b(?:resolve host|host)\s*:\s*)[\w.-]+/gi,
      "$1[redacted host]",
    )
    .replaceAll(
      /(\bconnect to host\s+)(?:\[[A-F0-9:]+\]|[^\s]+)/gi,
      "$1[redacted host]",
    )
    .replaceAll(
      /(\bconnect to\s+)(?:\[[A-F0-9:]+\]|(?:\d{1,3}\.){3}\d{1,3})/gi,
      "$1[redacted host]",
    )
    .replaceAll(
      /(\bConnecting to\s+)[^\s[]+(?:\s+\[[A-F0-9:.]+\])?/gi,
      "$1[redacted host]",
    )
    .replaceAll(/(\bresolve hostname\s+)[^:\s]+/gi, "$1[redacted host]")
    .replaceAll(
      /(\b[\w.-]*(?:key|token|secret|password|credential)[\w.-]*\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi,
      "$1[redacted secret]",
    )
    .replaceAll(
      /(\b[A-Z][A-Z0-9_]{2,}\s*=\s*)(?!\[redacted )[^\s]+/g,
      "$1[redacted secret]",
    )
    .replaceAll(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
      "[redacted secret]",
    );

  return redacted.replaceAll(
    /DYAD_PUBLIC_GIT_DOCUMENTATION_URL_(\d+)/g,
    (match, index: string) => publicDocumentationUrls[Number(index)] ?? match,
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

  const boundedRaw = raw
    .slice(0, MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH * 2)
    .split("\n")
    .map((line) =>
      line.length > MAX_GITHUB_OPS_ERROR_LINE_LENGTH
        ? `${line.slice(0, MAX_GITHUB_OPS_ERROR_LINE_LENGTH)} … [line truncated]`
        : line,
    )
    .join("\n");
  const safeMessage = redactSensitiveGitOutput(boundedRaw);
  if (UNSAFE_GITHUB_ERROR_RESIDUAL.test(safeMessage)) return fallback;
  const actionableText = safeMessage
    .replaceAll(/\[redacted [^\]]+\]/g, "")
    .replaceAll(/\[(?:path remainder redacted|line truncated)\]/g, "")
    .replaceAll(/[\p{P}\p{S}\s]/gu, "");
  if (!actionableText) return fallback;
  return truncateGithubOpsErrorMessage(safeMessage);
}
