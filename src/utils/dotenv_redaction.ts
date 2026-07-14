import path from "node:path";

const DOTENV_FILE_NAME = /^\.env(?:\.[^/\\]+)*$/i;

// Keep this grammar aligned with the dotenv parser used by the app. In
// particular, dotenv accepts dotted/hyphenated keys, colon separators, escaped
// quotes, and multiline single/double/backtick-quoted values.
const DOTENV_ASSIGNMENT =
  /^([^\S\r\n]*(?:export[^\S\r\n]+)?[\w.-]+(?:[^\S\r\n]*=[^\S\r\n]*|:[^\S\r\n]+))((?:[^\S\r\n]*'(?:\\'|[^'])*'|[^\S\r\n]*"(?:\\"|[^"])*"|[^\S\r\n]*`(?:\\`|[^`])*`|[^#\r\n]+)?)([^\S\r\n]*(?:#.*)?)$/gm;

export const REDACTED_DOTENV_VALUE = "[redacted]";

export function isDotenvFilePath(filePath: string): boolean {
  const logicalPath = filePath.startsWith("attachments:")
    ? filePath.slice("attachments:".length)
    : filePath;
  return DOTENV_FILE_NAME.test(path.basename(logicalPath));
}

function isEmptyDotenvValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === "" || trimmed === "''" || trimmed === '""' || trimmed === "``"
  );
}

function redactUnparsedContent(content: string): string {
  return content
    .split(/(\r\n|\n|\r)/)
    .map((part, index) => {
      if (index % 2 === 1 || part.trim() === "" || /^\s*#/.test(part)) {
        return part;
      }
      return REDACTED_DOTENV_VALUE;
    })
    .join("");
}

function redactAssignment(
  fullMatch: string,
  prefix: string,
  value: string,
  suffix: string,
): string {
  if (isEmptyDotenvValue(value)) {
    return fullMatch;
  }

  // Preserve the number and kind of line endings so line-based reads retain
  // their original coordinates, but never preserve multiline value content.
  const continuationLines = [...value.matchAll(/\r\n|\n|\r/g)]
    .map((match) => `${match[0]}${REDACTED_DOTENV_VALUE}`)
    .join("");
  return `${prefix}${REDACTED_DOTENV_VALUE}${continuationLines}${suffix}`;
}

export function redactDotenvValues(content: string): string {
  DOTENV_ASSIGNMENT.lastIndex = 0;
  const output: string[] = [];
  let previousEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = DOTENV_ASSIGNMENT.exec(content)) !== null) {
    output.push(redactUnparsedContent(content.slice(previousEnd, match.index)));
    output.push(redactAssignment(match[0], match[1], match[2] ?? "", match[3]));
    previousEnd = match.index + match[0].length;
  }

  output.push(redactUnparsedContent(content.slice(previousEnd)));
  return output.join("");
}

export function selectTextLineRange(
  content: string,
  startLine = 1,
  endLineInclusive?: number,
): string {
  const lines = content.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const selected = lines.slice(
    startLine - 1,
    endLineInclusive == null ? undefined : endLineInclusive,
  );
  if (
    endLineInclusive != null &&
    endLineInclusive < lines.length &&
    selected.length > 0
  ) {
    selected[selected.length - 1] = selected[selected.length - 1].replace(
      /\r\n|\r|\n$/,
      "",
    );
  }
  return selected.join("");
}
