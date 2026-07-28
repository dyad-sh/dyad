/**
 * Validation for the one-line Playwright assertions the model hands us.
 *
 * Both LLM passes (the agent's `generate_test_assertions` tool and the
 * approve-time code synthesis) are gated on this: an assertion is spliced into
 * the generated spec verbatim, so a multi-statement or unbalanced line would
 * produce a syntactically broken test file.
 */

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
 * True when `code` is exactly one Playwright assertion statement on one line.
 * Anything else is rejected rather than repaired — a guess at what the model
 * meant would land in the user's test file.
 */
export function isSingleAssertionStatement(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed.includes("\n") || trimmed.includes("\r")) return false;
  if (!/^(await\s+)?expect\s*\(/.test(trimmed)) return false;
  return isSingleStatementLine(trimmed);
}
