export const MEDIA_MENTION_REGEX = /@media:([a-zA-Z0-9_-]+\/[^\s]+)/g;

export function parseMediaMentions(prompt: string): string[] {
  const mentions: string[] = [];
  let match;

  while ((match = MEDIA_MENTION_REGEX.exec(prompt)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}
