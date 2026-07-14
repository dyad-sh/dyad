import path from "node:path";

const DOTENV_FILE_NAME = /^\.env(?:\.[^/\\]+)*$/i;
const DOTENV_ASSIGNMENT =
  /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.*)$/;

export const REDACTED_DOTENV_VALUE = "[redacted]";

export function isDotenvFilePath(filePath: string): boolean {
  const logicalPath = filePath.startsWith("attachments:")
    ? filePath.slice("attachments:".length)
    : filePath;
  return DOTENV_FILE_NAME.test(path.basename(logicalPath));
}

function findClosingQuote(value: string, quote: "'" | '"'): boolean {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    if (quote === '"') {
      let backslashes = 0;
      for (
        let cursor = index - 1;
        cursor >= 0 && value[cursor] === "\\";
        cursor -= 1
      ) {
        backslashes += 1;
      }
      if (backslashes % 2 === 1) continue;
    }
    return true;
  }
  return false;
}

function redactDotenvLine(
  line: string,
  preserveComments: boolean,
): { content: string; openQuote?: "'" | '"' } {
  if (line.trim() === "") {
    return { content: line };
  }
  if (preserveComments && /^\s*#/.test(line)) {
    return { content: line };
  }

  const match = line.match(DOTENV_ASSIGNMENT);
  if (!match) {
    // Dotenv supports quoted multiline values. A continuation line has no key,
    // so hide unrecognized non-comment content instead of risking a partial
    // secret disclosure.
    return { content: REDACTED_DOTENV_VALUE };
  }

  const [, prefix, value] = match;
  const trimmedValue = value.trim();
  if (trimmedValue === "" || trimmedValue === '""' || trimmedValue === "''") {
    return { content: line };
  }

  const firstValueCharacter = value.trimStart()[0];
  const openQuote =
    (firstValueCharacter === '"' || firstValueCharacter === "'") &&
    !findClosingQuote(value.trimStart(), firstValueCharacter)
      ? firstValueCharacter
      : undefined;
  return { content: `${prefix}${REDACTED_DOTENV_VALUE}`, openQuote };
}

export function redactDotenvValues(
  content: string,
  options?: { preserveComments?: boolean },
): string {
  const parts = content.split(/(\r\n|\n|\r)/);
  let openQuote: "'" | '"' | undefined;
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      if (openQuote) {
        if (findClosingQuote(`${openQuote}${part}`, openQuote)) {
          openQuote = undefined;
        }
        return part === "" ? part : REDACTED_DOTENV_VALUE;
      }
      const redacted = redactDotenvLine(
        part,
        options?.preserveComments !== false,
      );
      openQuote = redacted.openQuote;
      return redacted.content;
    })
    .join("");
}
