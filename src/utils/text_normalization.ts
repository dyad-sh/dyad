/**
 * Normalizes text for comparison by handling smart quotes and other special characters
 */
export function normalizeString(text: string): string {
  return (
    text
      // Normalize smart quotes to regular quotes
      .replace(/[\u2018\u2019]/g, "'") // Single quotes
      .replace(/[\u201C\u201D]/g, '"') // Double quotes
      // Normalize different types of dashes
      .replace(/[\u2013\u2014]/g, "-") // En dash and em dash to hyphen
      // Normalize ellipsis
      .replace(/\u2026/g, "...") // Ellipsis to three dots
      // Normalize non-breaking spaces
      .replace(/\u00A0/g, " ") // Non-breaking space to regular space
      // Normalize other common Unicode variants
      .replace(/\u00AD/g, "") // Soft hyphen (remove)
      .replace(/[\uFEFF]/g, "")
  ); // Zero-width no-break space (remove)
}
