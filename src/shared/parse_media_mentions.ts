function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The @media: prefix uses a colon to distinguish from CSS @media queries,
// which are followed by a space (e.g., "@media screen"). Mentions are always
// created programmatically as @media:<encoded-filename>.
export function parseMediaMentions(prompt: string): string[] {
  // Match only characters that encodeURIComponent can produce so that
  // trailing sentence punctuation (commas, semicolons, etc.) is excluded.
  const regex = /@media:([\w.%\-!~*'()]*[\w%\-!~*'()])/g;
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
    // Replace the token and collapse only the immediate surrounding spaces
    // (not newlines or other whitespace) left behind by removal.
    stripped = stripped.replace(
      new RegExp(`[ ]*${escapeRegExp(token)}[ ]*`, "g"),
      " ",
    );
  }

  return stripped.trim();
}
