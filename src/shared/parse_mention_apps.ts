export const MENTION_REGEX = /@app:([a-zA-Z0-9_-]+)/g;

// Helper function to parse app mentions from prompt
export function parseAppMentions(prompt: string): string[] {
  // Match @app:AppName patterns in the prompt (supports letters, digits, underscores, and hyphens, but NOT spaces)

  const mentions: string[] = [];
  let match;

  while ((match = MENTION_REGEX.exec(prompt)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}
