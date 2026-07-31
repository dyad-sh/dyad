export const APP_MENTION_NAME_PATTERN = "[a-zA-Z0-9_.-]+";
export const MENTION_REGEX = new RegExp(
  `@app:(${APP_MENTION_NAME_PATTERN})`,
  "g",
);

const APP_MENTION_PREFIX_REGEX = /@app:/g;
const APP_MENTION_CANDIDATE_CHAR_REGEX = /[\p{L}\p{N}_.-]/u;
const VISIBLE_APP_MENTION_CONTINUATION_REGEX = /[\p{L}\p{N}_:/\\-]/u;
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
  return (
    afterDotsChar === undefined ||
    !APP_MENTION_CANDIDATE_CHAR_REGEX.test(afterDotsChar)
  );
}

export interface KnownAppMentionMatch {
  appName: string;
  start: number;
  end: number;
}

export function findKnownAppMentionMatches(
  prompt: string,
  appNames: string[],
): KnownAppMentionMatch[] {
  const sortedAppNames = [...new Set(appNames)]
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  if (sortedAppNames.length === 0) {
    return [];
  }

  const matches: KnownAppMentionMatch[] = [];
  let prefixMatch: RegExpExecArray | null;
  APP_MENTION_PREFIX_REGEX.lastIndex = 0;
  while ((prefixMatch = APP_MENTION_PREFIX_REGEX.exec(prompt)) !== null) {
    const nameStart = prefixMatch.index + prefixMatch[0].length;
    const remainingLower = prompt.slice(nameStart).toLowerCase();
    const appName = sortedAppNames.find((name) => {
      const nameLower = name.toLowerCase();
      return (
        remainingLower.startsWith(nameLower) &&
        hasKnownAppMentionBoundary(prompt, nameStart + name.length)
      );
    });

    if (appName) {
      matches.push({
        appName,
        start: prefixMatch.index,
        end: nameStart + appName.length,
      });
    }
  }

  return matches;
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
  return findKnownAppMentionMatches(prompt, appNames).map(
    (match) => match.appName,
  );
}

export function formatKnownAppMentionsForPrompt(
  text: string,
  appNames: string[],
): string {
  const sortedAppNames = [...new Set(appNames)]
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);

  let formattedText = text;
  for (const appName of sortedAppNames) {
    const mentionRegex = new RegExp(`@(${escapeRegExp(appName)})`, "g");
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
