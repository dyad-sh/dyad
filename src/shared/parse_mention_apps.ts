export const APP_MENTION_NAME_PATTERN = "[a-zA-Z0-9_.-]+";
export const MENTION_REGEX = new RegExp(
  `@app:(${APP_MENTION_NAME_PATTERN})`,
  "g",
);

const APP_MENTION_PREFIX_REGEX = /@app:/g;
const APP_MENTION_CANDIDATE_CHAR_REGEX = /[a-zA-Z0-9_.-]/;
const VISIBLE_APP_MENTION_CONTINUATION_REGEX = /[a-zA-Z0-9_:/\\-]/;
const TERMINAL_DOT_PUNCTUATION_REGEX = /^\.+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Helper function to parse app mentions from prompt
export function parseAppMentions(prompt: string): string[] {
  // Match @app:AppName patterns in the prompt (supports letters, digits, underscores, hyphens, and dots, but NOT spaces)

  const mentions: string[] = [];
  let match;

  while ((match = MENTION_REGEX.exec(prompt)) !== null) {
    mentions.push(match[1].replace(/\.+$/, ""));
  }

  return mentions;
}

function readMentionCandidate(prompt: string, startIndex: number): string {
  let endIndex = startIndex;
  while (
    endIndex < prompt.length &&
    APP_MENTION_CANDIDATE_CHAR_REGEX.test(prompt[endIndex])
  ) {
    endIndex++;
  }
  return prompt.slice(startIndex, endIndex);
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

/**
 * Parse app mentions by matching against known app names, preferring the
 * longest known name. This handles names with dots without letting shorter app
 * names capture prefixes like `foo` from `foo.app.com`.
 */
export function parseKnownAppMentions(
  prompt: string,
  appNames: string[],
): string[] {
  const sortedAppNames = [...new Set(appNames)]
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  if (sortedAppNames.length === 0) {
    return [];
  }

  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  APP_MENTION_PREFIX_REGEX.lastIndex = 0;
  while ((match = APP_MENTION_PREFIX_REGEX.exec(prompt)) !== null) {
    const candidate = readMentionCandidate(
      prompt,
      match.index + match[0].length,
    );
    const candidateLower = candidate.toLowerCase();

    const appName = sortedAppNames.find((name) => {
      const nameLower = name.toLowerCase();
      if (candidateLower === nameLower) {
        return true;
      }
      if (!candidateLower.startsWith(nameLower)) {
        return false;
      }
      const suffix = candidate.slice(name.length);
      return TERMINAL_DOT_PUNCTUATION_REGEX.test(suffix);
    });

    if (appName) {
      mentions.push(appName);
    }
  }

  return mentions;
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
