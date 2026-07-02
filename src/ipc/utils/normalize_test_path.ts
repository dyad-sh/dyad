import path from "node:path";

// Mirrors the spec extensions accepted by TEST_FILE_PATTERN / listAppTests in
// tests_handlers.ts.
const SPEC_FILE_RE = /\.spec\.(ts|tsx|js|jsx)$/;

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
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, "/"));
  const sanitized = normalized
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .join("/");
  // Anything that isn't a concrete spec file falls back to a default filename:
  //   - empty/all-dots collapses to `tests/`
  //   - the bare `tests` directory
  //   - a non-spec file (e.g. `tests/README.md`)
  // Writing a directory path throws EISDIR in the response processor, and
  // non-spec files never surface in the Tests panel.
  if (!sanitized || !SPEC_FILE_RE.test(sanitized)) {
    return "tests/generated.spec.ts";
  }
  if (sanitized.startsWith("tests/")) return sanitized;
  return `tests/${sanitized}`;
}
