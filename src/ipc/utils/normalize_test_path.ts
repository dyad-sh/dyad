/**
 * Normalize a test path so it always lands under the app's `tests/` folder.
 * Used by both the Pro `generate_test` tool and the Build-mode
 * `<dyad-generate-test>` tag processor so neither can write outside `tests/`.
 */
export function normalizeTestPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith("tests/")) return normalized;
  return `tests/${normalized.replace(/^\/+/, "")}`;
}
