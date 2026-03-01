export function parseMediaMentions(prompt: string): string[] {
  const regex = /@media:([a-zA-Z0-9_-]+\/[^\s]+)/g;
  const mentions: string[] = [];
  let match;

  while ((match = regex.exec(prompt)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}
