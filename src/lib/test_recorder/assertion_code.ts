/**
 * Validation for the one-line Playwright assertions the model hands us. An
 * assertion is spliced into the generated spec verbatim, so both LLM passes are
 * gated on this being exactly one awaited `expect(...)` with a matcher chain.
 *
 * This is a SHAPE check, not a sandbox: it says nothing about what the
 * `expect(...)` argument contains, and a spec is ordinary TypeScript running
 * with Node's privileges. The trust boundary that matters is provenance, in
 * `test_assertion_handlers.ts` — assertion code only ever comes from the model
 * the user selected, never from the renderer (see `resolveAssertionCode`).
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
 * Characters a `/` may follow when it opens a regex literal. In an assertion a
 * regex is only ever an argument or a member of one — `toHaveURL(/x/)`,
 * `toHaveText([/a/, /b/])`, `{ hasText: /x/ }` — so this is the whole set, and
 * leaving `;` out of it keeps a trailing `// note` reading as a comment.
 */
const REGEX_PRECEDERS = new Set(["(", ",", "[", ":"]);

function startsRegex(line: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const ch = line[i];
    if (ch === " " || ch === "\t") continue;
    return REGEX_PRECEDERS.has(ch);
  }
  return false; // an assertion never opens with a regex
}

/**
 * Index just past the regex literal (and its flags) opening at `at`, or -1 if it
 * never closes. `/` inside a character class doesn't terminate it, matching how
 * the engine reads `/[^/]+/`.
 */
function endOfRegex(line: string, at: number): number {
  let inClass = false;
  for (let i = at + 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      let end = i + 1;
      while (end < line.length && /[a-z]/i.test(line[end])) end++;
      return end;
    }
  }
  return -1;
}

/**
 * Hand-rolled rather than regex because `expect(page.getByText("a;b"))` must not
 * be mistaken for two statements, and `getByText("http://x")` must not be
 * mistaken for a comment. Openers are tracked on a stack rather than as a depth
 * counter so `expect(a].toBe(1);` — balanced by count, nonsense to a parser — is
 * rejected instead of written into the spec.
 *
 * Regex literals are consumed whole. Without that, `toHaveText(/\(\d+\)/)` reads
 * as an unbalanced `(` and a perfectly good assertion is dropped from the spec.
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
    if (ch === "/" && startsRegex(line, i)) {
      const end = endOfRegex(line, i);
      if (end === -1) {
        unbalanced = true;
        break;
      }
      i = end - 1; // the loop's own increment steps past the literal
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
 * Whether everything after the `expect(...)` group is modifiers (`.not`,
 * `.resolves`) followed by exactly one matcher call that ends the statement.
 *
 * This is what stops `await expect(a).toBeVisible(), fs.rmSync("/");` — a single
 * balanced statement by every other measure — from being presented to the user
 * as one assertion. Nothing may follow the matcher call either: `.catch(() => {})`
 * would swallow the very failure the assertion exists to report, leaving a test
 * that passes without checking anything, and `.then(cb)` would run a callback
 * the user never reviewed as part of an assertion.
 */
function isMatcherChain(code: string, from: number): boolean {
  let i = from;

  for (;;) {
    while (i < code.length && /\s/.test(code[i])) i++;

    const member = MEMBER_RE.exec(code.slice(i));
    if (!member) return false;
    i += member[0].length;

    if (code[i] !== "(") continue; // a modifier; the matcher comes after it

    const scan = scanLine(code, i);
    if (!scan.balanced || scan.hasComment || scan.groupEnd === -1) return false;
    i = scan.groupEnd;
    while (i < code.length && /\s/.test(code[i])) i++;
    return code[i] === ";" && i === code.length - 1;
  }
}

/**
 * True when `code` is exactly one awaited Playwright assertion statement on one
 * line. Anything else is rejected rather than repaired — a guess at what the
 * model meant would land in the user's test file. `await` is required: every
 * web-first matcher this flow proposes is asynchronous, so an un-awaited
 * assertion can pass a test without ever observing its own result.
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
