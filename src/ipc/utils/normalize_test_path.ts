import { SPEC_FILE_RE, TEST_SPEC_EXT_ALTERNATION } from "../types/tests";

const STRIPPABLE_EXT_RE = new RegExp(`\\.(${TEST_SPEC_EXT_ALTERNATION})$`);
const LAST_EXT_RE = /\.[^/.]+$/;

/**
 * Normalize a test path so it always lands under the app's `tests/` folder
 * with a spec extension. Used by the Build-mode `<dyad-generate-test>` tag
 * processor so a stray tag can't write outside `tests/`, and by the chat card
 * so it displays the path that is actually written to disk.
 *
 * Defense-in-depth: `.` segments are dropped and `..` segments resolve within
 * the sanitized path (never past its root) before the `tests/` prefix is
 * applied, so the result can never traverse out of `tests/` even for a caller
 * that doesn't also run it through `safeJoin`.
 *
 * Pure string manipulation (no `node:path`) so the renderer can share it.
 */
export function normalizeTestPath(rawPath: string): string {
  const segments: string[] = [];
  for (const segment of rawPath.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Resolve against what we have; a leading ".." has nothing to pop and
      // simply disappears, so traversal can't escape.
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const sanitized = segments.join("/");

  // Nothing usable (empty, all dots, or the bare `tests` directory).
  if (!sanitized || sanitized === "tests") {
    return "tests/generated.spec.ts";
  }

  let specPath = sanitized;
  if (!SPEC_FILE_RE.test(specPath)) {
    // Coerce to a spec filename while preserving the tag's own name, so two
    // sibling tags with valid-but-wrong extensions (login.test.ts,
    // checkout.test.ts) normalize to distinct files instead of collapsing
    // onto one shared fallback and silently overwriting each other.
    const withoutKnownExt = specPath.replace(STRIPPABLE_EXT_RE, "");
    specPath = `${withoutKnownExt === specPath ? specPath.replace(LAST_EXT_RE, "") : withoutKnownExt}.spec.ts`;
  }
  if (specPath.startsWith("tests/")) return specPath;
  return `tests/${specPath}`;
}
