import { parse } from "@babel/parser";

import type {
  DescribeAppTestsResult,
  DescribedTest,
  TestStep,
} from "../types/tests";

/**
 * Turns a Playwright spec into plain-English step lists, one per `test()` case.
 *
 * This is a deterministic AST pass — no LLM, no heuristic text munging. Every
 * statement we recognize becomes a sentence; everything else is surfaced
 * verbatim as a `raw` step so the reader can always see that something happened,
 * even when we can't narrate it.
 *
 * Parsing uses `@babel/parser` (already a runtime dependency and already bundled
 * into the main process — see `src/pro/main/utils/visual_editing_utils.ts`). We
 * deliberately do NOT use `@babel/traverse`: it is only present transitively and
 * the shapes we care about are shallow enough to walk by hand.
 */

/** Longest step list we'll build for a single test. */
const MAX_STEPS = 200;
/** Longest raw source snippet shown for an unrecognized statement. */
const MAX_RAW_LENGTH = 160;
/** Files larger than this aren't worth parsing on the main process. */
const MAX_SOURCE_BYTES = 2_000_000;

// =============================================================================
// Minimal AST shapes
//
// `@babel/types` is not a declared dependency, so rather than importing its
// node types we describe just the properties this module reads. Narrowing goes
// through the `is*` guards below, which keeps everything strict-mode clean
// without an `any` in sight.
// =============================================================================

interface Node {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: { line: number } } | null;
}

interface Identifier extends Node {
  type: "Identifier";
  name: string;
}
interface StringLiteral extends Node {
  type: "StringLiteral";
  value: string;
}
interface NumericLiteral extends Node {
  type: "NumericLiteral";
  value: number;
}
interface RegExpLiteral extends Node {
  type: "RegExpLiteral";
  pattern: string;
  flags: string;
}
interface TemplateLiteral extends Node {
  type: "TemplateLiteral";
  expressions: Node[];
  quasis: { value: { cooked?: string | null; raw: string } }[];
}
interface CallExpression extends Node {
  type: "CallExpression";
  callee: Node;
  arguments: Node[];
}
interface MemberExpression extends Node {
  type: "MemberExpression";
  object: Node;
  property: Node;
  computed: boolean;
}
interface AwaitExpression extends Node {
  type: "AwaitExpression";
  argument: Node;
}
interface ExpressionStatement extends Node {
  type: "ExpressionStatement";
  expression: Node;
}
interface VariableDeclarator extends Node {
  type: "VariableDeclarator";
  id: Node;
  init?: Node | null;
}
interface VariableDeclaration extends Node {
  type: "VariableDeclaration";
  declarations: VariableDeclarator[];
}
interface ObjectProperty extends Node {
  type: "ObjectProperty";
  key: Node;
  value: Node;
  computed: boolean;
}
interface ObjectExpression extends Node {
  type: "ObjectExpression";
  properties: Node[];
}
interface FunctionLike extends Node {
  body: Node;
}
interface BlockStatement extends Node {
  type: "BlockStatement";
  body: Node[];
}
interface ImportDeclaration extends Node {
  type: "ImportDeclaration";
  source: StringLiteral;
  specifiers: { local?: Identifier }[];
}
interface ParsedFile {
  program: { body: Node[] };
}

function isType<T extends Node>(
  node: Node | null | undefined,
  type: string,
): node is T {
  return !!node && node.type === type;
}
const isIdentifier = (n?: Node | null): n is Identifier =>
  isType(n, "Identifier");
const isStringLiteral = (n?: Node | null): n is StringLiteral =>
  isType(n, "StringLiteral");
const isNumericLiteral = (n?: Node | null): n is NumericLiteral =>
  isType(n, "NumericLiteral");
const isRegExpLiteral = (n?: Node | null): n is RegExpLiteral =>
  isType(n, "RegExpLiteral");
const isTemplateLiteral = (n?: Node | null): n is TemplateLiteral =>
  isType(n, "TemplateLiteral");
const isCallExpression = (n?: Node | null): n is CallExpression =>
  isType(n, "CallExpression");
const isObjectExpression = (n?: Node | null): n is ObjectExpression =>
  isType(n, "ObjectExpression");
const isBlockStatement = (n?: Node | null): n is BlockStatement =>
  isType(n, "BlockStatement");

function isMemberExpression(n?: Node | null): n is MemberExpression {
  return isType(n, "MemberExpression") || isType(n, "OptionalMemberExpression");
}

function isFunctionLike(n?: Node | null): n is FunctionLike {
  return (
    isType(n, "ArrowFunctionExpression") ||
    isType(n, "FunctionExpression") ||
    isType(n, "FunctionDeclaration")
  );
}

/** Strips `await`, TS assertions, and parentheses so the real call is visible. */
function unwrap(node: Node): Node {
  let current = node;
  for (;;) {
    if (isType<AwaitExpression>(current, "AwaitExpression")) {
      current = current.argument;
    } else if (
      isType<{ expression: Node } & Node>(current, "TSNonNullExpression") ||
      isType<{ expression: Node } & Node>(current, "TSAsExpression") ||
      isType<{ expression: Node } & Node>(current, "ParenthesizedExpression")
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** The static name of a member access (`a.b` -> "b", `a["b"]` -> null). */
function propertyName(member: MemberExpression): string | null {
  if (member.computed) return null;
  if (isIdentifier(member.property)) return member.property.name;
  if (isStringLiteral(member.property)) return member.property.value;
  return null;
}

/** Flattens a pure identifier member chain, e.g. `test.describe.serial`. */
function memberChain(node: Node): string | null {
  if (isIdentifier(node)) return node.name;
  if (!isMemberExpression(node)) return null;
  const object = memberChain(node.object);
  const property = propertyName(node);
  return object && property ? `${object}.${property}` : null;
}

function lineOf(node: Node): number {
  return node.loc?.start.line ?? 1;
}

// =============================================================================
// Values
// =============================================================================

interface DescribedValue {
  text: string;
  kind: "string" | "number" | "code";
}

function formatValue(value: DescribedValue): string {
  if (value.kind === "number") return value.text;
  if (value.kind === "code") return `\`${value.text}\``;
  return `"${value.text}"`;
}

function describeValue(
  node: Node,
  source: string,
  scope: Scope,
): DescribedValue {
  const target = unwrap(node);
  if (isStringLiteral(target)) {
    return { text: target.value, kind: "string" };
  }
  // `const email = "a@b.com"` earlier in the test, then `.fill(email)`.
  if (isIdentifier(target)) {
    const constant = scope.constants.get(target.name);
    if (constant) return constant;
  }
  if (isNumericLiteral(target)) {
    return { text: String(target.value), kind: "number" };
  }
  if (isTemplateLiteral(target)) {
    if (target.expressions.length === 0) {
      return { text: target.quasis[0]?.value.cooked ?? "", kind: "string" };
    }
    // Keep the `${…}` placeholders — honest about the value being dynamic while
    // still readable (`/users/${id}`).
    const raw = sourceSlice(target, source);
    return { text: raw.replace(/^`|`$/g, ""), kind: "string" };
  }
  if (isRegExpLiteral(target)) {
    return { text: `/${target.pattern}/${target.flags}`, kind: "code" };
  }
  return { text: collapse(sourceSlice(target, source)), kind: "code" };
}

function sourceSlice(node: Node, source: string): string {
  if (node.start == null || node.end == null) return "";
  return source.slice(node.start, node.end);
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Reads a literal property off an options object, e.g. `{ name: "Submit" }`. */
function optionValue(
  options: Node | undefined,
  key: string,
  source: string,
  scope: Scope,
): DescribedValue | null {
  if (!isObjectExpression(options)) return null;
  for (const property of options.properties) {
    if (!isType<ObjectProperty>(property, "ObjectProperty")) continue;
    if (property.computed) continue;
    const name = isIdentifier(property.key)
      ? property.key.name
      : isStringLiteral(property.key)
        ? property.key.value
        : null;
    if (name === key) return describeValue(property.value, source, scope);
  }
  return null;
}

// =============================================================================
// Locators -> noun phrases
// =============================================================================

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

function ordinal(position: number): string {
  const known = ORDINALS[position - 1];
  if (known) return known;
  const remainderTen = position % 10;
  const remainderHundred = position % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${position}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${position}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${position}rd`;
  return `${position}th`;
}

/**
 * ARIA role names that read badly verbatim. Anything not listed is already a
 * normal English word ("button", "heading", "link", …) and is used as-is.
 */
const ROLE_NAMES: Record<string, string> = {
  alertdialog: "alert dialog",
  columnheader: "column header",
  combobox: "combo box",
  contentinfo: "content info",
  gridcell: "grid cell",
  img: "image",
  listbox: "list box",
  listitem: "list item",
  menubar: "menu bar",
  menuitem: "menu item",
  menuitemcheckbox: "menu item checkbox",
  menuitemradio: "menu item radio",
  progressbar: "progress bar",
  radiogroup: "radio group",
  rowgroup: "row group",
  rowheader: "row header",
  searchbox: "search box",
  spinbutton: "spin button",
  tablist: "tab list",
  tabpanel: "tab panel",
  textbox: "text box",
  treegrid: "tree grid",
  treeitem: "tree item",
};

function humanRole(role: string): string {
  return ROLE_NAMES[role] ?? role;
}

/** Turns `the "Save" button` into `the first "Save" button`. */
function qualify(phrase: string, word: string): string {
  return phrase.startsWith("the ")
    ? `the ${word} ${phrase.slice(4)}`
    : `the ${word} ${phrase}`;
}

interface Scope {
  /** Variable name -> locator phrase, for `const row = page.getByRole(...)`. */
  locators: Map<string, string>;
  /** Variable name -> literal value, for `const email = "a@b.com"`. */
  constants: Map<string, DescribedValue>;
  /** Names imported from a relative module — treated as the app's own helpers. */
  helpers: Set<string>;
}

function childScope(scope: Scope): Scope {
  return {
    locators: new Map(scope.locators),
    constants: new Map(scope.constants),
    helpers: scope.helpers,
  };
}

function isPage(node: Node): boolean {
  return isIdentifier(node) && node.name === "page";
}

/**
 * Describes a locator expression as a noun phrase (`the "Submit" button`), or
 * null when the expression isn't a locator we understand.
 */
function describeLocator(
  node: Node,
  source: string,
  scope: Scope,
): string | null {
  const target = unwrap(node);

  if (isIdentifier(target)) {
    return scope.locators.get(target.name) ?? null;
  }
  if (!isCallExpression(target)) return null;
  if (!isMemberExpression(target.callee)) return null;

  const method = propertyName(target.callee);
  if (!method) return null;

  const receiver = unwrap(target.callee.object);
  const rootIsPage = isPage(receiver);
  const parent = rootIsPage ? null : describeLocator(receiver, source, scope);
  if (!rootIsPage && parent === null) return null;

  const args = target.arguments;
  const first = args[0];

  const base = ((): string | null => {
    switch (method) {
      case "getByRole": {
        if (!isStringLiteral(first)) return null;
        const role = humanRole(first.value);
        const name = optionValue(args[1], "name", source, scope);
        return name ? `the ${formatValue(name)} ${role}` : `the ${role}`;
      }
      case "getByLabel":
      case "getByPlaceholder": {
        if (!first) return null;
        return `the ${formatValue(describeValue(first, source, scope))} field`;
      }
      case "getByText": {
        if (!first) return null;
        return `the text ${formatValue(describeValue(first, source, scope))}`;
      }
      case "getByTestId":
      case "getByTitle": {
        if (!first) return null;
        return `the ${formatValue(describeValue(first, source, scope))} element`;
      }
      case "getByAltText": {
        if (!first) return null;
        return `the ${formatValue(describeValue(first, source, scope))} image`;
      }
      case "locator": {
        if (!first) return null;
        return `the element matching ${formatValue(describeValue(first, source, scope))}`;
      }
      case "frameLocator": {
        if (!first) return null;
        return `the frame matching ${formatValue(describeValue(first, source, scope))}`;
      }
      default:
        return null;
    }
  })();

  if (base) {
    return parent ? `${base} inside ${parent}` : base;
  }

  // Refiners operate on an existing locator, so they need a parent phrase.
  if (!parent) return null;
  switch (method) {
    case "first":
      return qualify(parent, "first");
    case "last":
      return qualify(parent, "last");
    case "nth": {
      if (!isNumericLiteral(first)) return null;
      // Playwright's `nth` is 0-based; humans count from one.
      return qualify(parent, ordinal(first.value + 1));
    }
    case "filter": {
      const hasText = optionValue(first, "hasText", source, scope);
      if (hasText) return `${parent} containing ${formatValue(hasText)}`;
      const hasNotText = optionValue(first, "hasNotText", source, scope);
      if (hasNotText)
        return `${parent} not containing ${formatValue(hasNotText)}`;
      return null;
    }
    default:
      return null;
  }
}

// =============================================================================
// Statements -> sentences
// =============================================================================

type Sentence = { kind: TestStep["kind"]; text: string };

function describePageAction(
  call: CallExpression,
  source: string,
  scope: Scope,
): Sentence | null {
  if (!isMemberExpression(call.callee)) return null;
  const method = propertyName(call.callee);
  if (!method) return null;
  const receiver = unwrap(call.callee.object);
  const args = call.arguments;
  const first = args[0];
  const value = first ? formatValue(describeValue(first, source, scope)) : null;

  if (isPage(receiver)) {
    switch (method) {
      case "goto":
        return value
          ? { kind: "navigation", text: `Go to ${value}.` }
          : { kind: "navigation", text: "Go to the app." };
      case "reload":
        return { kind: "navigation", text: "Reload the page." };
      case "goBack":
        return { kind: "navigation", text: "Go back to the previous page." };
      case "goForward":
        return { kind: "navigation", text: "Go forward to the next page." };
      case "waitForURL":
        return value
          ? { kind: "wait", text: `Wait until the page URL is ${value}.` }
          : null;
      case "waitForLoadState":
        return { kind: "wait", text: "Wait for the page to finish loading." };
      case "waitForTimeout":
        return isNumericLiteral(first)
          ? { kind: "wait", text: `Wait ${first.value}ms.` }
          : null;
      case "setViewportSize": {
        const width = optionValue(first, "width", source, scope);
        const height = optionValue(first, "height", source, scope);
        return width && height
          ? {
              kind: "action",
              text: `Resize the window to ${width.text}×${height.text}.`,
            }
          : null;
      }
      default:
        return null;
    }
  }

  // `page.keyboard.press("Enter")` / `page.keyboard.type("hi")`
  if (memberChain(receiver) === "page.keyboard") {
    if (method === "press" && value) {
      return { kind: "action", text: `Press ${value}.` };
    }
    if ((method === "type" || method === "insertText") && value) {
      return { kind: "action", text: `Type ${value}.` };
    }
  }
  return null;
}

function describeLocatorAction(
  call: CallExpression,
  source: string,
  scope: Scope,
): Sentence | null {
  if (!isMemberExpression(call.callee)) return null;
  const method = propertyName(call.callee);
  if (!method) return null;
  const subject = describeLocator(call.callee.object, source, scope);
  if (!subject) return null;

  const args = call.arguments;
  const first = args[0];
  const value = first ? formatValue(describeValue(first, source, scope)) : null;
  const action = (text: string): Sentence => ({ kind: "action", text });

  switch (method) {
    case "click":
      return action(`Click ${subject}.`);
    case "dblclick":
      return action(`Double-click ${subject}.`);
    case "tap":
      return action(`Tap ${subject}.`);
    case "hover":
      return action(`Hover over ${subject}.`);
    case "focus":
      return action(`Focus ${subject}.`);
    case "blur":
      return action(`Move focus away from ${subject}.`);
    case "clear":
      return action(`Clear ${subject}.`);
    case "check":
      return action(`Check ${subject}.`);
    case "uncheck":
      return action(`Uncheck ${subject}.`);
    case "scrollIntoViewIfNeeded":
      return action(`Scroll ${subject} into view.`);
    case "selectText":
      return action(`Select the text in ${subject}.`);
    case "fill":
      return value ? action(`Fill ${subject} with ${value}.`) : null;
    case "type":
    case "pressSequentially":
      return value ? action(`Type ${value} into ${subject}.`) : null;
    case "press":
      return value ? action(`Press ${value} in ${subject}.`) : null;
    case "setInputFiles":
      return value ? action(`Upload ${value} to ${subject}.`) : null;
    case "selectOption": {
      if (!first) return null;
      const label =
        optionValue(first, "label", source, scope) ??
        optionValue(first, "value", source, scope);
      const selected = label ? formatValue(label) : value;
      return selected ? action(`Select ${selected} in ${subject}.`) : null;
    }
    case "dragTo": {
      const target = first ? describeLocator(first, source, scope) : null;
      return target ? action(`Drag ${subject} onto ${target}.`) : null;
    }
    default:
      return null;
  }
}

/**
 * Matchers, as a verb plus the rest of the predicate. Splitting them this way
 * lets `.not` produce grammatical negations ("does not have" rather than
 * "not has").
 */
const NEGATIVE_VERBS: Record<string, string> = {
  is: "is not",
  has: "does not have",
  contains: "does not contain",
  appears: "does not appear",
  matches: "does not match",
};

function predicate(verb: string, rest: string, negated: boolean): string {
  const form = negated ? (NEGATIVE_VERBS[verb] ?? `does not ${verb}`) : verb;
  return rest ? `${form} ${rest}` : form;
}

function describeAssertion(
  call: CallExpression,
  source: string,
  scope: Scope,
): Sentence | null {
  if (!isMemberExpression(call.callee)) return null;
  const matcher = propertyName(call.callee);
  if (!matcher) return null;

  // Walk back through any `.not` links to the `expect(...)` call itself.
  let cursor: Node = unwrap(call.callee.object);
  let negated = false;
  while (isMemberExpression(cursor) && propertyName(cursor) === "not") {
    negated = !negated;
    cursor = unwrap(cursor.object);
  }
  if (!isCallExpression(cursor)) return null;

  const expectCallee = cursor.callee;
  const expectName = memberChain(expectCallee);
  if (expectName !== "expect" && expectName !== "expect.soft") return null;

  const target = cursor.arguments[0];
  if (!target) return null;

  const args = call.arguments;
  const first = args[0];
  const value = first ? describeValue(first, source, scope) : null;
  const check = (subject: string, verb: string, rest: string): Sentence => ({
    kind: "assertion",
    text: `Check that ${subject} ${predicate(verb, rest, negated)}.`,
  });

  if (isPage(unwrap(target))) {
    switch (matcher) {
      case "toHaveURL":
        if (!value) return null;
        return value.kind === "code"
          ? check("the page URL", "matches", formatValue(value))
          : check("the page URL", "is", formatValue(value));
      case "toHaveTitle":
        if (!value) return null;
        return value.kind === "code"
          ? check("the page title", "matches", formatValue(value))
          : check("the page title", "is", formatValue(value));
      case "toHaveScreenshot":
        return check("the page", "matches", "its reference screenshot");
      default:
        return null;
    }
  }

  const subject = describeLocator(target, source, scope);
  if (!subject) return null;

  const textVerb = value?.kind === "code" ? "matches" : "has";
  switch (matcher) {
    case "toBeVisible":
      return check(subject, "is", "visible");
    case "toBeHidden":
      return check(subject, "is", "hidden");
    case "toBeChecked":
      return check(subject, "is", "checked");
    case "toBeEnabled":
      return check(subject, "is", "enabled");
    case "toBeDisabled":
      return check(subject, "is", "disabled");
    case "toBeFocused":
      return check(subject, "is", "focused");
    case "toBeEmpty":
      return check(subject, "is", "empty");
    case "toBeEditable":
      return check(subject, "is", "editable");
    case "toBeAttached":
      return check(subject, "is", "attached to the page");
    case "toBeInViewport":
      return check(subject, "is", "in the viewport");
    case "toHaveText":
      return value
        ? check(subject, textVerb, `the text ${formatValue(value)}`)
        : null;
    case "toContainText":
      return value
        ? check(subject, "contains", `the text ${formatValue(value)}`)
        : null;
    case "toHaveValue":
      return value
        ? check(subject, textVerb, `the value ${formatValue(value)}`)
        : null;
    case "toHaveClass":
      return value
        ? check(subject, "has", `the class ${formatValue(value)}`)
        : null;
    case "toHaveId":
      return value
        ? check(subject, "has", `the id ${formatValue(value)}`)
        : null;
    case "toHaveCount": {
      if (!isNumericLiteral(first)) return null;
      const times = first.value === 1 ? "1 time" : `${first.value} times`;
      return check(subject, "appears", times);
    }
    case "toHaveAttribute": {
      if (!value) return null;
      const attributeValue = args[1]
        ? describeValue(args[1], source, scope)
        : null;
      return check(
        subject,
        "has",
        attributeValue
          ? `the attribute ${formatValue(value)} set to ${formatValue(attributeValue)}`
          : `the attribute ${formatValue(value)}`,
      );
    }
    case "toHaveScreenshot":
      return check(subject, "matches", "its reference screenshot");
    default:
      return null;
  }
}

/** `await signIn(page)` where `signIn` came from one of the app's own files. */
function describeHelperCall(
  call: CallExpression,
  scope: Scope,
): Sentence | null {
  if (!isIdentifier(call.callee)) return null;
  if (!scope.helpers.has(call.callee.name)) return null;
  return { kind: "action", text: `Run the "${call.callee.name}" helper.` };
}

// =============================================================================
// Walking a test body
// =============================================================================

interface StepCollector {
  steps: TestStep[];
  truncated: boolean;
}

function pushStep(collector: StepCollector, step: TestStep): void {
  if (collector.steps.length >= MAX_STEPS) {
    collector.truncated = true;
    return;
  }
  collector.steps.push(step);
}

function pushRaw(
  collector: StepCollector,
  node: Node,
  source: string,
  depth: number,
): void {
  const text = truncate(collapse(sourceSlice(node, source)), MAX_RAW_LENGTH);
  if (!text) return;
  pushStep(collector, { kind: "raw", text, line: lineOf(node), depth });
}

/** `test.step("Sign in", async () => { … })` */
function asTestStepCall(node: Node): CallExpression | null {
  const call = unwrap(node);
  if (!isCallExpression(call)) return null;
  return memberChain(call.callee) === "test.step" ? call : null;
}

function describeStatements(
  statements: Node[],
  source: string,
  scope: Scope,
  depth: number,
  collector: StepCollector,
): void {
  for (const statement of statements) {
    if (collector.truncated) return;
    describeStatement(statement, source, scope, depth, collector);
  }
}

function describeStatement(
  statement: Node,
  source: string,
  scope: Scope,
  depth: number,
  collector: StepCollector,
): void {
  try {
    if (isType<VariableDeclaration>(statement, "VariableDeclaration")) {
      let allBound = statement.declarations.length > 0;
      for (const declarator of statement.declarations) {
        if (!isIdentifier(declarator.id) || !declarator.init) {
          allBound = false;
          continue;
        }
        const locator = describeLocator(declarator.init, source, scope);
        if (locator) {
          scope.locators.set(declarator.id.name, locator);
          continue;
        }
        const init = unwrap(declarator.init);
        if (isStringLiteral(init) || isNumericLiteral(init)) {
          scope.constants.set(
            declarator.id.name,
            describeValue(init, source, scope),
          );
          continue;
        }
        allBound = false;
      }
      // A binding isn't an action, so bound declarations produce no step. Any
      // declaration we couldn't interpret is still surfaced verbatim.
      if (!allBound) pushRaw(collector, statement, source, depth);
      return;
    }

    if (isType<ExpressionStatement>(statement, "ExpressionStatement")) {
      const stepCall = asTestStepCall(statement.expression);
      if (stepCall) {
        const title = stepCall.arguments[0];
        const body = stepCall.arguments.find(isFunctionLike);
        if (isStringLiteral(title)) {
          pushStep(collector, {
            kind: "group",
            text: title.value,
            line: lineOf(statement),
            depth,
          });
          if (body && isBlockStatement(body.body)) {
            describeStatements(
              body.body.body,
              source,
              childScope(scope),
              depth + 1,
              collector,
            );
          }
          return;
        }
      }

      const call = unwrap(statement.expression);
      if (isCallExpression(call)) {
        const sentence =
          describePageAction(call, source, scope) ??
          describeLocatorAction(call, source, scope) ??
          describeAssertion(call, source, scope) ??
          describeHelperCall(call, scope);
        if (sentence) {
          pushStep(collector, {
            ...sentence,
            line: lineOf(statement),
            depth,
          });
          return;
        }
      }
    }

    pushRaw(collector, statement, source, depth);
  } catch {
    // A mapping bug must degrade a single statement, never blank the dialog.
    pushRaw(collector, statement, source, depth);
  }
}

// =============================================================================
// Finding tests
// =============================================================================

type TestCallKind = "test" | "describe" | "beforeEach";

const TEST_ROOTS = new Set(["test", "it"]);
const TEST_MODIFIERS = new Set(["only", "skip", "fixme", "fail"]);

function classifyTestCall(call: CallExpression): TestCallKind | null {
  const chain = memberChain(call.callee);
  if (!chain) return null;
  const [root, ...rest] = chain.split(".");
  if (!TEST_ROOTS.has(root)) return null;
  if (rest.length === 0) return "test";
  if (rest.length === 1 && TEST_MODIFIERS.has(rest[0])) return "test";
  if (rest[0] === "describe") {
    // `test.describe.configure(...)` is setup, not a group of tests.
    return rest[1] === "configure" ? null : "describe";
  }
  if (rest[0] === "beforeEach" && rest.length === 1) return "beforeEach";
  return null;
}

function asCall(statement: Node): CallExpression | null {
  if (!isType<ExpressionStatement>(statement, "ExpressionStatement"))
    return null;
  const call = unwrap(statement.expression);
  return isCallExpression(call) ? call : null;
}

function bodyStatements(call: CallExpression): Node[] | null {
  const fn = call.arguments.find(isFunctionLike);
  if (!fn || !isBlockStatement(fn.body)) return null;
  return fn.body.body;
}

/**
 * Collects the tests declared in `statements`, recursing into `test.describe`
 * blocks. `inheritedSetup` carries the steps of any enclosing `beforeEach` so a
 * test's list starts with the setup that really runs before it.
 */
function collectTests(
  statements: Node[],
  source: string,
  scope: Scope,
  inheritedSetup: TestStep[],
  out: DescribedTest[],
): void {
  // beforeEach applies to every test in the block regardless of where it is
  // written, so gather setup first.
  const setup = [...inheritedSetup];
  for (const statement of statements) {
    const call = asCall(statement);
    if (!call || classifyTestCall(call) !== "beforeEach") continue;
    const body = bodyStatements(call);
    if (!body) continue;
    const collector: StepCollector = { steps: [], truncated: false };
    describeStatements(body, source, childScope(scope), 1, collector);
    if (collector.steps.length === 0) continue;
    setup.push({
      kind: "group",
      text: "Before each test",
      line: lineOf(statement),
      depth: 0,
    });
    setup.push(...collector.steps);
  }

  for (const statement of statements) {
    const call = asCall(statement);
    if (!call) continue;
    const kind = classifyTestCall(call);
    if (kind === "describe") {
      const body = bodyStatements(call);
      if (body) collectTests(body, source, childScope(scope), setup, out);
      continue;
    }
    if (kind !== "test") continue;

    const title = call.arguments.find(isStringLiteral);
    if (!title) continue;
    const body = bodyStatements(call);
    const collector: StepCollector = { steps: [...setup], truncated: false };
    if (body) {
      describeStatements(body, source, childScope(scope), 0, collector);
    }
    out.push({
      title: title.value,
      // Matches `parseTestCases` (and Playwright's `file:line` selector), which
      // both key off the line the `test(` call starts on.
      line: lineOf(call.callee),
      steps: collector.steps,
      truncated: collector.truncated,
    });
  }
}

/** Names imported from a relative path — the app's own fixtures and helpers. */
function collectHelpers(body: Node[]): Set<string> {
  const helpers = new Set<string>();
  for (const statement of body) {
    if (!isType<ImportDeclaration>(statement, "ImportDeclaration")) continue;
    if (!statement.source.value.startsWith(".")) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.local?.name) helpers.add(specifier.local.name);
    }
  }
  return helpers;
}

// =============================================================================
// Entry point
// =============================================================================

/**
 * Describes every `test()` in a Playwright spec as an ordered list of
 * plain-English steps. Never throws: an unparseable file comes back as
 * `parseError` with an empty `tests` array so callers can degrade gracefully.
 */
export function describeTestSteps(source: string): DescribeAppTestsResult {
  if (source.length > MAX_SOURCE_BYTES) {
    return { tests: [], parseError: "This test file is too large to read." };
  }

  let file: ParsedFile;
  try {
    file = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      // Keep going through recoverable syntax errors so a spec that is mid-edit
      // still yields the steps it does have.
      errorRecovery: true,
    }) as unknown as ParsedFile;
  } catch (error) {
    return {
      tests: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  const body = file.program.body;
  const scope: Scope = {
    locators: new Map(),
    constants: new Map(),
    helpers: collectHelpers(body),
  };
  const tests: DescribedTest[] = [];
  collectTests(body, source, scope, [], tests);
  return { tests };
}
