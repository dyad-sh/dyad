/**
 * Derives a slug from a prompt title by lowercasing, replacing spaces with
 * hyphens, and stripping non-alphanumeric/hyphen characters.
 */
export function deriveSlugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Returns the effective slug for a prompt: explicit slug if set, otherwise
 * derived from the title.
 */
export function slugForPrompt(p: {
  title: string;
  slug: string | null;
}): string {
  if (p.slug) return p.slug;
  return deriveSlugFromTitle(p.title);
}

/**
 * Replaces slash-skill references like /webapp-testing with the corresponding
 * prompt content. Only matches /slug when slug is a single token (lowercase
 * letters, numbers, hyphens) at word boundary (start of string or after
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
    /(^|\s)\/([a-z0-9-]+)(?=\s|$)/g,
    (match: string, before: string, slug: string) => {
      const content = promptsBySlug[slug];
      return content !== undefined ? `${before}${content}` : match;
    },
  );
}
