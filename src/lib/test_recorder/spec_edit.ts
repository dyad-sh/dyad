import type { AssertionPlanItem } from "./assertion_proposal";

/**
 * Parse/re-emit the Playwright specs the recorder generates, so assertions can
 * be spliced in deterministically instead of asking a model to rewrite the file.
 *
 * The parser is a deliberately narrow whitelist matching what `codegen.ts`
 * emits, and returns null for anything else. Silently guessing where to splice
 * into an arbitrary spec is how you corrupt someone's test file — bailing lets
 * the caller fall back to "ask the AI in chat" with an honest explanation.
 */

export interface ParsedSpec {
  eol: "\n" | "\r\n";
  /** Lines before the `test(` line (imports, blank lines). */
  header: string[];
  testHeaderLine: string;
  testTitle: string;
  /** Leading whitespace shared by the body statements. */
  indent: string;
  /** One trimmed statement per line, in order. */
  bodyStatements: string[];
  /** The closing `});` line and everything after it. */
  footer: string[];
  endsWithNewline: boolean;
}

const TEST_HEADER_RE =
  /^test\(\s*(["'`])([\s\S]*?)\1\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{\s*$/;

const PLAYWRIGHT_IMPORT_RE =
  /^import\s*\{([^}]*)\}\s*from\s*(["'])@playwright\/test\2\s*;?\s*$/;

const EXPECT_IMPORT_LINE = `import { test, expect } from "@playwright/test";`;

/**
 * Scan a single line of code, ignoring string literals, and report whether the
 * delimiters balance and whether a line comment appears outside a string.
 *
 * Hand-rolled rather than regex because `expect(page.getByText("a;b"))` must not
 * be mistaken for two statements, and `getByText("http://x")` must not be
 * mistaken for a comment.
 */
function scanLine(line: string): {
  balanced: boolean;
  hasComment: boolean;
  /** Number of `;` that terminate a statement (i.e. at depth 0, outside strings). */
  topLevelSemicolons: number;
} {
  let depth = 0;
  let quote: string | null = null;
  let hasComment = false;
  let topLevelSemicolons = 0;
  let unbalanced = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (quote) {
      if (ch === "\\") {
        i++; // skip the escaped character
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && (line[i + 1] === "/" || line[i + 1] === "*")) {
      hasComment = true;
      break;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) unbalanced = true;
      continue;
    }
    if (ch === ";" && depth === 0) topLevelSemicolons++;
  }

  return {
    balanced: !unbalanced && depth === 0 && quote === null,
    hasComment,
    topLevelSemicolons,
  };
}

function isSingleStatementLine(trimmed: string): boolean {
  if (!trimmed.endsWith(";")) return false;
  const scan = scanLine(trimmed);
  return scan.balanced && !scan.hasComment && scan.topLevelSemicolons === 1;
}

/**
 * Parse a recorder-generated spec. Returns null for hand-written or hand-edited
 * specs — multi-line statements, comments inside the body, multiple `test()`
 * calls, `test.describe` wrappers, or a fixture signature other than
 * `async ({ page }) =>`.
 *
 * A spec that already has assertions applied still parses (our emitted lines are
 * single statements), so re-proposing on the same file works.
 */
export function parseGeneratedSpec(source: string): ParsedSpec | null {
  const eol: "\n" | "\r\n" = source.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = /\r?\n$/.test(source);
  const lines = source.split(/\r?\n/);
  // `split` leaves a trailing "" for a file ending in a newline; drop it so it
  // doesn't look like a body/footer line, and restore it when rendering.
  if (endsWithNewline) lines.pop();

  let testHeaderIndex = -1;
  let testTitle = "";
  for (let i = 0; i < lines.length; i++) {
    const match = TEST_HEADER_RE.exec(lines[i]);
    if (!match) continue;
    if (testHeaderIndex !== -1) return null; // more than one test() block
    testHeaderIndex = i;
    testTitle = match[2];
  }
  if (testHeaderIndex === -1) return null;

  let footerIndex = -1;
  for (let i = lines.length - 1; i > testHeaderIndex; i--) {
    if (lines[i].trim() === "});") {
      footerIndex = i;
      break;
    }
  }
  if (footerIndex === -1) return null;

  const bodyStatements: string[] = [];
  let indent: string | null = null;
  for (let i = testHeaderIndex + 1; i < footerIndex; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // blank lines carry no meaning here
    const leading = /^\s+/.exec(line);
    if (!leading) return null;
    const trimmed = line.trim();
    if (!isSingleStatementLine(trimmed)) return null;
    if (indent === null) indent = leading[0];
    bodyStatements.push(trimmed);
  }

  return {
    eol,
    header: lines.slice(0, testHeaderIndex),
    testHeaderLine: lines[testHeaderIndex],
    testTitle,
    indent: indent ?? "  ",
    bodyStatements,
    footer: lines.slice(footerIndex),
    endsWithNewline,
  };
}

/**
 * Guarantee `expect` is imported from "@playwright/test". Only meaningful when
 * at least one assertion will be emitted — call sites skip it otherwise so a
 * zero-assertion approval leaves the file byte-identical.
 */
export function ensureExpectImport(header: string[]): string[] {
  const importIndex = header.findIndex((line) =>
    PLAYWRIGHT_IMPORT_RE.test(line),
  );
  if (importIndex === -1) {
    return [EXPECT_IMPORT_LINE, ...header];
  }

  const match = PLAYWRIGHT_IMPORT_RE.exec(header[importIndex])!;
  const names = match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.includes("expect")) return header;

  const next = [...header];
  const quote = match[2];
  next[importIndex] =
    `import { ${[...names, "expect"].join(", ")} } from ${quote}@playwright/test${quote};`;
  return next;
}

/**
 * True when `code` is exactly one Playwright assertion statement on one line.
 * Gates model-authored code in both LLM passes — a multi-statement or
 * unbalanced line would produce a syntactically broken spec.
 */
export function isSingleAssertionStatement(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed.includes("\n") || trimmed.includes("\r")) return false;
  if (!/^(await\s+)?expect\s*\(/.test(trimmed)) return false;
  return isSingleStatementLine(trimmed);
}

/**
 * Rebuild the spec source from a parsed spec plus the approved plan.
 *
 * Throws when the plan's step items don't cover every statement exactly once —
 * that would mean dropping or duplicating a recorded interaction, which is
 * never something we want to write to disk.
 */
export function renderSpec(
  parsed: ParsedSpec,
  items: AssertionPlanItem[],
): string {
  const seen = new Set<number>();
  for (const item of items) {
    if (item.kind !== "step") continue;
    if (item.stepIndex < 0 || item.stepIndex >= parsed.bodyStatements.length) {
      throw new Error(`Step index ${item.stepIndex} is out of range`);
    }
    if (seen.has(item.stepIndex)) {
      throw new Error(`Step index ${item.stepIndex} appears more than once`);
    }
    seen.add(item.stepIndex);
  }
  if (seen.size !== parsed.bodyStatements.length) {
    throw new Error(
      `Plan covers ${seen.size} of ${parsed.bodyStatements.length} statements`,
    );
  }

  const assertionLines: string[] = [];
  const body = items.map((item) => {
    if (item.kind === "step") {
      return parsed.indent + parsed.bodyStatements[item.stepIndex];
    }
    const code = item.code?.trim();
    if (!code) {
      throw new Error(`Assertion ${item.id} has no code to write`);
    }
    assertionLines.push(code);
    return parsed.indent + code;
  });

  const header =
    assertionLines.length > 0
      ? ensureExpectImport(parsed.header)
      : parsed.header;

  const lines = [...header, parsed.testHeaderLine, ...body, ...parsed.footer];
  return lines.join(parsed.eol) + (parsed.endsWithNewline ? parsed.eol : "");
}
