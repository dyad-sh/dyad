/**
 * Validation for the one-line Playwright assertions the model hands us.
 *
 * Both LLM passes (the agent's `generate_test_assertions` tool and the
 * approve-time code synthesis) are gated on this: an assertion is spliced into
 * the generated spec verbatim, so anything that isn't exactly one awaited
 * `expect(...)` assertion would either break the file or smuggle an unrelated
 * expression into a test that runs with Node's privileges.
 */

/** The delimiter that closes each opener. */
const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

interface Scan {
  balanced: boolean;
  hasComment: boolean;
  /** Number of `;` that terminate a statement (i.e. at depth 0, outside strings). */
  topLevelSemicolons: number;
  /**
   * Index just past the delimiter that closes the group opened at `from`, or -1
   * if it never closes. Only meaningful when the scan started on an opener.
   */
  groupEnd: number;
}

/**
 * Scan a single line of code from `from`, ignoring string literals, and report
 * whether the delimiters balance and whether a line comment appears outside a
 * string.
 *
 * Hand-rolled rather than regex because `expect(page.getByText("a;b"))` must not
 * be mistaken for two statements, and `getByText("http://x")` must not be
 * mistaken for a comment. Openers are tracked on a stack rather than as a depth
 * counter so `expect(a].toBe(1);` — balanced by count, nonsense to a parser — is
 * rejected instead of written into the spec.
 */
function scanLine(line: string, from = 0): Scan {
  const stack: string[] = [];
  let quote: string | null = null;
  let hasComment = false;
  let topLevelSemicolons = 0;
  let unbalanced = false;
  let groupEnd = -1;

  for (let i = from; i < line.length; i++) {
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
      stack.push(CLOSERS[ch]);
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== ch) {
        unbalanced = true;
        break;
      }
      if (stack.length === 0 && groupEnd === -1) groupEnd = i + 1;
      continue;
    }
    if (ch === ";" && stack.length === 0) topLevelSemicolons++;
  }

  return {
    balanced: !unbalanced && stack.length === 0 && quote === null,
    hasComment,
    topLevelSemicolons,
    groupEnd,
  };
}

function isSingleStatementLine(trimmed: string): boolean {
  if (!trimmed.endsWith(";")) return false;
  const scan = scanLine(trimmed);
  return scan.balanced && !scan.hasComment && scan.topLevelSemicolons === 1;
}

/** `.identifier`, optionally applied as a call, e.g. `.not` or `.toHaveText(…)`. */
const MEMBER_RE = /^\.\s*([A-Za-z_$][\w$]*)\s*/;

/**
 * Whether everything after the `expect(...)` group is a plain member/call chain
 * ending in a matcher call and nothing else.
 *
 * This is what stops `await expect(a).toBeVisible(), fs.rmSync("/");` — a single
 * balanced statement by every other measure — from being presented to the user
 * as one assertion and then written into their repo verbatim.
 */
function isMatcherChain(code: string, from: number): boolean {
  let i = from;
  let sawCall = false;

  for (;;) {
    while (i < code.length && /\s/.test(code[i])) i++;
    if (code[i] === ";") return sawCall && i === code.length - 1;

    const member = MEMBER_RE.exec(code.slice(i));
    if (!member) return false;
    i += member[0].length;

    if (code[i] === "(") {
      const scan = scanLine(code, i);
      // `groupEnd` is the index past this call's `)`; anything unbalanced or a
      // stray closer inside makes the whole line unusable.
      if (!scan.balanced || scan.hasComment || scan.groupEnd === -1)
        return false;
      i = scan.groupEnd;
      sawCall = true;
    }
  }
}

/**
 * True when `code` is exactly one awaited Playwright assertion statement on one
 * line: `await expect(<args>)` followed by a matcher chain and a `;`.
 *
 * Anything else is rejected rather than repaired — a guess at what the model
 * meant would land in the user's test file. `await` is required, not optional:
 * every web-first matcher this flow proposes (`toBeVisible`, `toHaveText`,
 * `toHaveURL`) is asynchronous, so an un-awaited assertion can pass a test
 * without ever observing its own result.
 */
export function isSingleAssertionStatement(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed.includes("\n") || trimmed.includes("\r")) return false;
  const head = /^await\s+expect\s*\(/.exec(trimmed);
  if (!head) return false;
  if (!isSingleStatementLine(trimmed)) return false;

  // Everything from `expect`'s `(` through its matching `)`.
  const expectArgs = scanLine(trimmed, head[0].length - 1);
  if (expectArgs.groupEnd === -1) return false;
  return isMatcherChain(trimmed, expectArgs.groupEnd);
}
