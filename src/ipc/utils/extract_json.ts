/**
 * Slice the outermost JSON object out of a model response.
 *
 * Models routinely wrap JSON in prose or markdown fences even when told not to,
 * so every structured one-off call runs its text through this before
 * `JSON.parse`. Returns null when there's no `{...}` span at all.
 */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}
