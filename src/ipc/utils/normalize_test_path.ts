/**
 * Normalize a test path so it always lands under the app's `tests/` folder.
 * Used by the Build-mode `<dyad-generate-test>` tag processor so a stray tag
 * can't write outside `tests/`.
 *
 * Defense-in-depth: `.` and `..` segments are stripped before the `tests/`
 * prefix is applied, so the result can never traverse out of `tests/` even
 * for a caller that doesn't also run it through `safeJoin`.
 */
export function normalizeTestPath(rawPath: string): string {
  const sanitized = rawPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .join("/");
  if (sanitized === "tests" || sanitized.startsWith("tests/")) return sanitized;
  return `tests/${sanitized}`;
}
