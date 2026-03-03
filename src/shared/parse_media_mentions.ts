export function parseMediaMentions(prompt: string): string[] {
  const regex = /@media:([^\s]+)/g;
  const mentions: string[] = [];
  let match;

  while ((match = regex.exec(prompt)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}

/**
 * Strip resolved @media mentions from prompt text while preserving all other text.
 * This only removes exact mention tokens that were successfully resolved.
 */
export function stripResolvedMediaMentions(
  prompt: string,
  resolvedMediaRefs: string[],
): string {
  if (resolvedMediaRefs.length === 0) {
    return prompt.trim();
  }

  let stripped = prompt;
  for (const mediaRef of resolvedMediaRefs) {
    const token = `@media:${mediaRef}`;
    stripped = stripped.split(token).join("");
  }

  return stripped.replace(/\s{2,}/g, " ").trim();
}
