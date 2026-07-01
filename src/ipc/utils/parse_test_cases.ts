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
 * Strip `//` line comments and `/* … *\/` block comments from a line,
 * ignoring comment markers that appear inside a string literal (e.g.
 * `page.goto("http://x")`). Block-comment state carries across lines via
 * `state` so a `test(...)` inside a multi-line commented-out example doesn't
 * become a phantom entry. Best-effort, matching the rest of this parser
 * (a `/*` inside a multi-line template literal would fool it).
 */
function stripComments(line: string, state: { inBlock: boolean }): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (state.inBlock) {
      if (c === "*" && line[i + 1] === "/") {
        state.inBlock = false;
        i++; // skip the '/'
      }
      continue;
    }
    if (quote) {
      out += c;
      if (c === "\\") {
        if (i + 1 < line.length) out += line[++i]; // keep the escaped char
        continue;
      }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
    } else if (c === "/" && line[i + 1] === "/") {
      break;
    } else if (c === "/" && line[i + 1] === "*") {
      state.inBlock = true;
      i++; // skip the '*'
    } else {
      out += c;
    }
  }
  return out;
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
  const state = { inBlock: false };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip JSDoc continuation lines (`* test(...)`) up front; `//`, `/* */`,
    // and multi-line block comments are handled by stripComments below so a
    // commented-out or documented `test(...)` doesn't become a phantom
    // (unrunnable) row.
    if (!state.inBlock && line.trimStart().startsWith("*")) {
      continue;
    }
    const match = TEST_CALL.exec(stripComments(line, state));
    if (match) {
      out.push({ title: unescapeLiteral(match[2]), line: i + 1 });
    }
  }
  return out;
}
