export const MENTION_REGEX = /@app:([a-zA-Z0-9_.-]+)/g;

const APP_MENTION_PREFIX_REGEX = /@app:/g;
const HARD_MENTION_DELIMITER_REGEX = /[\s,!?;:()[\]{}"'`<>]/;
const TERMINAL_DOT_PUNCTUATION_REGEX = /^\.+$/;

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
    !HARD_MENTION_DELIMITER_REGEX.test(prompt[endIndex])
  ) {
    endIndex++;
  }
  return prompt.slice(startIndex, endIndex);
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
