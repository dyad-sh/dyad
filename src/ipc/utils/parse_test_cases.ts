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
 * Strip a trailing `//` line comment, ignoring `//` that appears inside a string
 * literal (e.g. `page.goto("http://x")`). Best-effort and single-line, matching
 * the rest of this parser — it stops a `test(...)` written inside an inline
 * comment (`doThing(); // test("nope")`) from becoming a phantom entry.
 */
function stripLineComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") {
        i++; // skip the escaped char
        continue;
      }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
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
    // Also drop any inline `//` comment so `code(); // test("nope")` on a real
    // code line doesn't register a phantom test.
    const match = TEST_CALL.exec(stripLineComment(line));
    if (match) {
      out.push({ title: unescapeLiteral(match[2]), line: i + 1 });
    }
  }
  return out;
}
