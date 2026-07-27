/**
 * Fake responses for the "Add assertions with AI" flow.
 *
 * Two different things are faked here, because two different prompts are
 * involved:
 *
 * 1. The AGENT turn. The recorder's "Add assertions with AI" button sends a
 *    chat prompt; the agent is expected to read the spec and then call its
 *    `generate_test_assertions` tool. We answer with `read_file` first, then —
 *    once the spec content is in a tool result — with the tool call, deriving
 *    the steps/assertions from the statements we were shown.
 *
 * 2. The approve-time CODE SYNTHESIS pass
 *    (src/prompts/test_assertions_prompt.ts buildAssertionCodePayload), a plain
 *    one-off model call that still expects JSON back. Shared by the
 *    chat-completions and responses fake routes so it works regardless of which
 *    protocol the selected fake model uses.
 *
 * Both matchers key off exact line-anchored labels, not bare substrings — an
 * ordinary chat prompt that happens to mention "Statements:" must not be
 * hijacked into a JSON assertion plan.
 */

/** Matches the prompt the recorder's "Add assertions with AI" button sends. */
const ASSERTIONS_REQUEST_RE =
  /^Add assertions to the test I just recorded: (\S+)\s*$/m;

/**
 * Marker from the `generate_test_assertions` tool result (see
 * src/pro/main/ipc/handlers/local_agent/tools/generate_test_assertions.ts).
 * Keep the two in sync — it's how this fixture knows the card already exists.
 */
const ASSERTIONS_TOOL_DONE_MARKER = "review card for";

/** Derive a plain-English sentence for a recorded Playwright statement. */
function describeStatement(statement: string): string {
  if (statement.includes("signIn(page)")) return "Sign in as the test user";
  const gotoMatch = statement.match(/page\.goto\("([^"]*)"\)/);
  if (gotoMatch) return `Open ${gotoMatch[1]}`;
  const nameMatch = statement.match(/name:\s*"([^"]*)"/);
  const fillMatch = statement.match(/\.fill\("([^"]*)"\)/);
  if (fillMatch) {
    return `Type "${fillMatch[1]}" into the ${nameMatch?.[1] ?? "field"}`;
  }
  if (statement.includes(".click()")) {
    return `Click the ${nameMatch?.[1] ?? "element"}`;
  }
  if (statement.includes(".check()")) return "Check the box";
  if (statement.includes(".selectOption(")) return "Choose an option";
  const textMatch = statement.match(/getByText\("([^"]*)"\)/);
  if (textMatch) return `Interact with "${textMatch[1]}"`;
  return "Perform the recorded step";
}

/** The locator of the last statement we can reuse verbatim in an assertion. */
function reusableLocator(statements: string[]): string | null {
  for (let i = statements.length - 1; i >= 0; i--) {
    const locator = /^await (page\..*?)\.(click|fill|check|dblclick)\(/.exec(
      statements[i],
    );
    if (locator) return locator[1];
  }
  return null;
}

/**
 * Unwrap a tool result. The AI SDK sends them as a JSON-encoded
 * `{"type":"text","value":"…"}` envelope, so the file content a `read_file`
 * returned is only recognizable after parsing (its newlines are escaped inside
 * the envelope). Anything else is returned unchanged.
 */
function toPlainText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.value === "string") return parsed.value;
  } catch {
    // Not an envelope; fall through to the raw text.
  }
  return text;
}

/**
 * Pull the body statements out of a recorder-generated spec, numbered the way
 * `generate_test_assertions` counts them: non-blank lines between the `test(`
 * line and the closing `});`.
 */
function parseSpecStatements(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith("test("));
  if (start === -1) return [];
  const statements: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "});") break;
    if (trimmed === "") continue;
    statements.push(trimmed);
  }
  return statements;
}

export interface AssertionsToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Answer the agent turn for an "Add assertions" request, or null when this
 * conversation isn't one.
 *
 * `messageTexts` is every message's text in order, so the spec source can be
 * recovered from the `read_file` tool result of the previous turn.
 */
export function matchAssertionsAgentTurn(
  lastUserText: string,
  messageTexts: string[],
): AssertionsToolCall | null {
  const request = ASSERTIONS_REQUEST_RE.exec(lastUserText);
  if (!request) return null;
  const specPath = request[1];

  const plainTexts = messageTexts.map(toPlainText);

  // The card is already up (the tool said so), so the turn is over. Falling
  // through to the canned text response is what ends it — answering with the
  // tool call again would loop, since the triggering user message never
  // changes.
  if (plainTexts.some((text) => text.includes(ASSERTIONS_TOOL_DONE_MARKER))) {
    return null;
  }

  // Turn 2: the spec came back from read_file, so propose the plan. read_file
  // returns bare file content, so recognize it by shape rather than by path.
  const specSource = plainTexts.find(
    (text) =>
      /^import .*@playwright\/test/m.test(text) && /^test\(/m.test(text),
  );
  const statements = specSource ? parseSpecStatements(specSource) : [];
  if (statements.length === 0) {
    // Turn 1: read the spec first, exactly as the tool's description demands.
    return { name: "read_file", args: { path: specPath } };
  }

  const locator = reusableLocator(statements);
  return {
    name: "generate_test_assertions",
    args: {
      specPath,
      steps: statements.map((statement, index) => ({
        index,
        text: describeStatement(statement),
      })),
      assertions: locator
        ? [
            {
              afterStep: statements.length - 1,
              text: "The element stays visible after the interaction",
              code: `await expect(${locator}).toBeVisible();`,
            },
          ]
        : [],
    },
  };
}

/**
 * The approve-time pass: turn user-edited descriptions into code. Reuses the
 * same locator strategy so an edited assertion still produces a spec that
 * compiles.
 */
export function matchAssertionCodePayload(text: string): string | null {
  if (
    !/^Playwright test: /m.test(text) ||
    !/^Statements:$/m.test(text) ||
    !/^Assertions to write:$/m.test(text)
  ) {
    return null;
  }

  const lines = text.split("\n");
  const statementsStart = lines.findIndex((line) => line === "Statements:");
  const statements: string[] = [];
  for (let i = statementsStart + 1; i < lines.length; i++) {
    const match = /^(\d+): (.+)$/.exec(lines[i]);
    if (!match) break;
    statements.push(match[2]);
  }
  const fallbackLocator = reusableLocator(statements) ?? 'page.locator("body")';

  const start = lines.findIndex((line) => line === "Assertions to write:");
  const assertions: { id: string; code: string }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^(\S+) \| after step (-?\d+) \| (.*)$/.exec(lines[i]);
    if (!match) continue;
    assertions.push({
      id: match[1],
      code: `await expect(${fallbackLocator}).toBeVisible();`,
    });
  }

  return JSON.stringify({ assertions });
}
