import type { TestCase } from "../types/tests";

// Matches a `test(...)`, `test.only(...)`, `test.skip(...)`, etc. call whose
// first argument is a string literal, capturing the title. The leading
// boundary stops `mytest(` / `attest(` from matching, and the `.describe`
// variant is intentionally excluded so group declarations aren't listed as
// runnable tests. `it(...)` is included since Playwright aliases it.
const TEST_CALL =
  /(?:^|[^.\w$])(?:test|it)(?:\.(?:only|skip|fixme|fail))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

/** Unescape a JS string literal body (just the backslash escapes we care about). */
function unescapeLiteral(raw: string): string {
  return raw.replace(/\\(['"`\\])/g, "$1");
}

/**
 * Best-effort static extraction of the individual `test()` cases in a Playwright
 * spec file. Returns one entry per test call found, with the 1-based line of the
 * call so a single test can be targeted via Playwright's `file:line` selector.
 *
 * This is deliberately line-based and lightweight: it handles the common
 * single-line `test('title', async ({ page }) => { ... })` shape that generated
 * tests use. A file that can't be parsed simply yields no cases and is still
 * runnable as a whole.
 */
export function parseTestCases(source: string): TestCase[] {
  const lines = source.split(/\r?\n/);
  const out: TestCase[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip obvious comment lines so a commented-out or documented `test(...)`
    // doesn't become a phantom (unrunnable) row.
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    ) {
      continue;
    }
    const match = TEST_CALL.exec(line);
    if (match) {
      out.push({ title: unescapeLiteral(match[2]), line: i + 1 });
    }
  }
  return out;
}
