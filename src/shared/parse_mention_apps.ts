export const APP_MENTION_NAME_PATTERN = "[a-zA-Z0-9_.-]+";
export const MENTION_REGEX = new RegExp(
  `@app:(${APP_MENTION_NAME_PATTERN})`,
  "g",
);

const APP_MENTION_PREFIX_REGEX = /@app:/g;
const APP_MENTION_CANDIDATE_CHAR_REGEX = /[\p{L}\p{N}\p{M}_.-]/u;
const VISIBLE_APP_MENTION_CONTINUATION_REGEX = /[\p{L}\p{N}\p{M}_:/\\-]/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitAppMentionTrailingDots(value: string): {
  appName: string;
  trailingDots: string;
} {
  const appName = value.replace(/\.+$/, "");
  return {
    appName,
    trailingDots: value.slice(appName.length),
  };
}

// Helper function to parse app mentions from prompt
export function parseAppMentions(prompt: string): string[] {
  // Match @app:AppName patterns in the prompt (supports letters, digits, underscores, hyphens, and dots, but NOT spaces)

  const mentions: string[] = [];
  let match;

  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(prompt)) !== null) {
    const { appName } = splitAppMentionTrailingDots(match[1]);
    if (appName) {
      mentions.push(appName);
    }
  }

  return mentions;
}

function hasVisibleAppMentionBoundary(
  text: string,
  nextIndex: number,
): boolean {
  const nextChar = text[nextIndex];
  if (nextChar === undefined) {
    return true;
  }

  if (VISIBLE_APP_MENTION_CONTINUATION_REGEX.test(nextChar)) {
    return false;
  }

  if (nextChar !== ".") {
    return true;
  }

  let afterDotsIndex = nextIndex;
  while (text[afterDotsIndex] === ".") {
    afterDotsIndex++;
  }

  const afterDotsChar = text[afterDotsIndex];
  if (afterDotsChar === undefined) {
    return true;
  }

  return (
    !APP_MENTION_CANDIDATE_CHAR_REGEX.test(afterDotsChar) &&
    afterDotsChar !== "/" &&
    afterDotsChar !== "\\"
  );
}

function hasKnownAppMentionBoundary(text: string, nextIndex: number): boolean {
  const nextChar = text[nextIndex];
  if (nextChar === undefined) {
    return true;
  }

  if (nextChar !== ".") {
    return !APP_MENTION_CANDIDATE_CHAR_REGEX.test(nextChar);
  }

  let afterDotsIndex = nextIndex;
  while (text[afterDotsIndex] === ".") {
    afterDotsIndex++;
  }

  const afterDotsChar = text[afterDotsIndex];
  if (afterDotsChar === undefined) {
    return true;
  }

  return (
    !APP_MENTION_CANDIDATE_CHAR_REGEX.test(afterDotsChar) &&
    afterDotsChar !== "/" &&
    afterDotsChar !== "\\"
  );
}

function sortedUniqueAppNames(appNames: string[]): string[] {
  return [...new Set(appNames)]
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
}

export interface KnownAppMentionMatch {
  appName: string;
  start: number;
  end: number;
}

/**
 * Find internal `@app:Name` mentions by matching against known app names.
 * Matching known names makes spaces unambiguous and lets every consumer use
 * the same longest-name and boundary rules.
 */
export function findKnownAppMentions(
  prompt: string,
  appNames: string[],
): KnownAppMentionMatch[] {
  const sortedAppNames = sortedUniqueAppNames(appNames);
  if (sortedAppNames.length === 0) {
    return [];
  }

  const mentions: KnownAppMentionMatch[] = [];
  let match: RegExpExecArray | null;
  APP_MENTION_PREFIX_REGEX.lastIndex = 0;
  while ((match = APP_MENTION_PREFIX_REGEX.exec(prompt)) !== null) {
    const nameStart = match.index + match[0].length;
    const appName = sortedAppNames.find((name) => {
      const nameEnd = nameStart + name.length;
      return (
        prompt.slice(nameStart, nameEnd).toLowerCase() === name.toLowerCase() &&
        hasKnownAppMentionBoundary(prompt, nameEnd)
      );
    });

    if (appName) {
      const end = nameStart + appName.length;
      mentions.push({
        appName,
        start: match.index,
        end,
      });
      // Display names may themselves contain `@app:`. Do not interpret a
      // prefix inside the accepted longest name as another reference.
      APP_MENTION_PREFIX_REGEX.lastIndex = end;
    }
  }

  return mentions;
}

export function formatKnownAppMentionsForDisplay(
  text: string,
  appNames: string[],
): string {
  const matches = findKnownAppMentions(text, appNames);
  if (matches.length === 0) {
    return text;
  }

  let result = "";
  let lastIndex = 0;
  for (const match of matches) {
    result += text.slice(lastIndex, match.start);
    result += `@${text.slice(match.start + "@app:".length, match.end)}`;
    lastIndex = match.end;
  }
  return result + text.slice(lastIndex);
}

/**
 * Parse app mentions by matching against known app names, preferring the
 * longest known name. This handles names with dots without letting shorter app
 * names capture prefixes like `foo` from `foo.app.com`.
 */
export function parseKnownAppMentions(
  prompt: string,
  appNames: string[],
): string[] {
  return findKnownAppMentions(prompt, appNames).map(({ appName }) => appName);
}

export function formatKnownAppMentionsForPrompt(
  text: string,
  appNames: string[],
): string {
  const sortedAppNames = sortedUniqueAppNames(appNames);

  let formattedText = text;
  for (const appName of sortedAppNames) {
    const mentionRegex = new RegExp(`@(${escapeRegExp(appName)})`, "gi");
    formattedText = formattedText.replace(
      mentionRegex,
      (match, mentionName: string, offset: number, fullText: string) => {
        const nextIndex = offset + match.length;
        if (!hasVisibleAppMentionBoundary(fullText, nextIndex)) {
          return match;
        }
        return `@app:${mentionName}`;
      },
    );
  }

  return formattedText;
}
