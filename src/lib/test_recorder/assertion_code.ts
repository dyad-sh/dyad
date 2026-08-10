import { parse } from "@babel/parser";
import type { Node } from "@babel/types";

/**
 * Validation for the one-line Playwright assertions the model hands us. An
 * assertion is spliced into the generated spec verbatim, so both LLM passes are
 * gated on this being exactly one awaited, allowlisted Playwright assertion.
 * The model sees app-controlled text and the generated spec runs with Node's
 * privileges, so a shape-only `expect(anyExpression).matcher()` check is not a
 * sufficient trust boundary: every executable AST node is constrained below.
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
 * Characters a `/` may follow when it opens a regex literal — every position
 * where an expression may begin: after an opener, a separator, or an operator.
 *
 * The complement is what matters: a `/` after an identifier, a digit, `)` or
 * `]` is division, and division never appears in these one-line assertions.
 * Erring toward "regex" is therefore safe here, and erring the other way is
 * not — a rejected assertion silently disappears from the generated spec.
 */
const REGEX_PRECEDERS = new Set([
  "(",
  ",",
  "[",
  "{",
  ":",
  ";",
  "=",
  ">",
  "<",
  "!",
  "&",
  "|",
  "?",
  "+",
  "-",
  "*",
  "%",
  "^",
  "~",
]);

function startsRegex(line: string, at: number): boolean {
  // `//` and `/*` are comments wherever they appear. Checked before the
  // preceding character so `toHaveText(//)` can't slip through as an empty
  // regex literal, which is not valid JavaScript in the first place.
  if (line[at + 1] === "/" || line[at + 1] === "*") return false;
  for (let i = at - 1; i >= 0; i--) {
    const ch = line[i];
    if (ch === " " || ch === "\t") continue;
    // `+` and `-` are in the set as unary/binary operators, but doubled they
    // are a postfix increment — an operand, so what follows is division.
    if ((ch === "+" || ch === "-") && line[i - 1] === ch) return false;
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

/** Locator-building calls that only describe how Playwright should find UI. */
const LOCATOR_METHODS = new Set([
  "filter",
  "first",
  "frameLocator",
  "getByAltText",
  "getByLabel",
  "getByPlaceholder",
  "getByRole",
  "getByTestId",
  "getByText",
  "getByTitle",
  "last",
  "locator",
  "nth",
]);

/** Web-first Playwright matchers that do not execute user-authored callbacks. */
const PLAYWRIGHT_MATCHERS = new Set([
  "toBeAttached",
  "toBeChecked",
  "toBeDisabled",
  "toBeEditable",
  "toBeEmpty",
  "toBeEnabled",
  "toBeFocused",
  "toBeHidden",
  "toBeInViewport",
  "toBeVisible",
  "toContainClass",
  "toContainText",
  "toHaveAccessibleDescription",
  "toHaveAccessibleName",
  "toHaveAttribute",
  "toHaveClass",
  "toHaveCount",
  "toHaveCSS",
  "toHaveId",
  "toHaveJSProperty",
  "toHaveRole",
  "toHaveText",
  "toHaveTitle",
  "toHaveURL",
  "toHaveValue",
  "toHaveValues",
]);

function memberName(node: Node): string | undefined {
  if (
    node.type !== "MemberExpression" ||
    node.computed ||
    node.property.type !== "Identifier"
  ) {
    return undefined;
  }
  return node.property.name;
}

/**
 * Literal data accepted as locator/matcher arguments. No identifiers,
 * functions, spreads, computed keys, templates, or calls: those are all places
 * app-controlled prompt text could otherwise turn into executable Node code.
 */
function isSafeData(node: Node | null, allowLocator: boolean): boolean {
  if (!node) return false;
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "RegExpLiteral":
    case "BigIntLiteral":
      return true;
    case "UnaryExpression":
      return (
        (node.operator === "+" || node.operator === "-") &&
        node.argument.type === "NumericLiteral"
      );
    case "ArrayExpression":
      return node.elements.every(
        (element) =>
          element !== null &&
          element.type !== "SpreadElement" &&
          isSafeData(element, allowLocator),
      );
    case "ObjectExpression":
      return node.properties.every(
        (property) =>
          property.type === "ObjectProperty" &&
          !property.computed &&
          !property.shorthand &&
          (property.key.type === "Identifier" ||
            property.key.type === "StringLiteral" ||
            property.key.type === "NumericLiteral") &&
          isSafeData(property.value, allowLocator),
      );
    default:
      return allowLocator && isSafeLocator(node);
  }
}

/** `page` or a chain of allowlisted locator-building calls rooted at `page`. */
function isSafeLocator(node: Node): boolean {
  if (node.type === "Identifier") return node.name === "page";
  if (node.type !== "CallExpression") return false;
  const method = memberName(node.callee);
  if (!method || !LOCATOR_METHODS.has(method)) return false;
  if (
    node.callee.type !== "MemberExpression" ||
    !isSafeLocator(node.callee.object)
  ) {
    return false;
  }
  return node.arguments.every(
    (argument) =>
      argument.type !== "SpreadElement" && isSafeData(argument, true),
  );
}

function isExpectCall(node: Node): boolean {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "expect" &&
    node.arguments.length === 1 &&
    node.arguments[0].type !== "SpreadElement" &&
    isSafeLocator(node.arguments[0])
  );
}

/** Parse and allowlist the executable parts of the assertion. */
function hasSafePlaywrightAst(code: string): boolean {
  try {
    const file = parse(code, {
      sourceType: "module",
      allowAwaitOutsideFunction: true,
    });
    if (file.program.body.length !== 1) return false;
    const statement = file.program.body[0];
    if (
      statement.type !== "ExpressionStatement" ||
      statement.expression.type !== "AwaitExpression" ||
      statement.expression.argument.type !== "CallExpression"
    ) {
      return false;
    }

    const matcherCall = statement.expression.argument;
    const matcher = memberName(matcherCall.callee);
    if (!matcher || !PLAYWRIGHT_MATCHERS.has(matcher)) return false;
    if (matcherCall.callee.type !== "MemberExpression") return false;

    let receiver = matcherCall.callee.object;
    if (memberName(receiver) === "not") {
      if (receiver.type !== "MemberExpression") return false;
      receiver = receiver.object;
    }
    if (!isExpectCall(receiver)) return false;

    return matcherCall.arguments.every(
      (argument) =>
        argument.type !== "SpreadElement" && isSafeData(argument, false),
    );
  } catch {
    return false;
  }
}

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
  return (
    isMatcherChain(trimmed, expectArgs.groupEnd) &&
    hasSafePlaywrightAst(trimmed)
  );
}
