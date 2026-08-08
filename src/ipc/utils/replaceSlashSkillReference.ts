/**
 * Returns the explicit slug for a prompt, or null if none is set.
 */
export function slugForPrompt(p: {
  title: string;
  slug: string | null;
}): string | null {
  return p.slug || null;
}

/**
 * Replaces slash-skill references like /webapp-testing with the corresponding
 * prompt content. Only matches /slug when slug is a single token (letters,
 * numbers, hyphens) at word boundary (start of string or after
 * whitespace, and followed by space or end).
 */
export function replaceSlashSkillReference(
  userPrompt: string,
  promptsBySlug: Record<string, string>,
): string {
  if (typeof userPrompt !== "string" || userPrompt.length === 0)
    return userPrompt;
  if (Object.keys(promptsBySlug).length === 0) return userPrompt;

  return userPrompt.replace(
    /(^|\s)\/([a-zA-Z0-9-]+)(?=\s|$)/g,
    (match: string, before: string, slug: string) => {
      const content = promptsBySlug[slug];
      return content !== undefined ? `${before}${content}` : match;
    },
  );
}
