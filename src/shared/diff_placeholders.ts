// Placeholder strings substituted for file content that can't be shown in the
// diff editor. Shared between the main-process sanitizer (which produces them)
// and the renderer (which must recognize them so it doesn't diff a placeholder
// as if it were real file content).
export const DIFF_TOO_LARGE_PLACEHOLDER = "<file too large to display>";
export const DIFF_BINARY_PLACEHOLDER = "<binary file not shown>";

export const DIFF_PLACEHOLDERS: readonly string[] = [
  DIFF_TOO_LARGE_PLACEHOLDER,
  DIFF_BINARY_PLACEHOLDER,
];

export function isDiffPlaceholder(content: string): boolean {
  return DIFF_PLACEHOLDERS.includes(content);
}
