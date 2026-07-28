/**
 * Fake responses for the recorder's "Generate assertions" flow.
 *
 * Three different things are faked here, because three different prompts are
 * involved:
 *
 * 1. The AGENT turn. The recorder's "Generate assertions" button sends a chat
 *    prompt containing the recorded statements — the test is NOT a file yet, so
 *    there is nothing to read_file. We answer with a single
 *    `generate_test_assertions` tool call, deriving the steps/assertions from
 *    the statements in the prompt.
 *
 * 2. The approve-time CODE SYNTHESIS pass
 *    (src/prompts/test_assertions_prompt.ts buildAssertionCodePayload), a plain
 *    one-off model call that still expects JSON back. Shared by the
 *    chat-completions and responses fake routes so it works regardless of which
 *    protocol the selected fake model uses.
 *
 * 3. The VERIFICATION turn the card sends after approval, asking the agent to
 *    run the generated spec. Answered with plain text so E2E exercises the
 *    hand-off without spawning a real Playwright run.
 *
 * The matchers key off exact line-anchored labels, not bare substrings — an
 * ordinary chat prompt that happens to mention "Statements:" must not be
 * hijacked into a JSON assertion plan.
 */

/** Matches the prompt the recorder's "Generate assertions" button sends. */
const ASSERTIONS_REQUEST_RE =
  /^Add assertions to the test I just recorded: "(.+)"\s*$/m;

/** Matches the run request the assertions card sends after approval. */
const VERIFY_REQUEST_RE =
  /^I approved the assertions\. Dyad generated (\S+) from my recording\.\s*$/m;

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
 * `{"type":"text","value":"…"}` envelope, so the tool's reply is only
 * recognizable after parsing. Anything else is returned unchanged.
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
 * Pull the numbered statements out of the request. This is the same numbering
 * `generate_test_assertions` validates against, so a plan built from these
 * indices is accepted.
 */
function parseNumberedStatements(text: string): string[] {
  const statements: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^(\d+): (.+)$/.exec(line);
    if (!match) continue;
    // Indices are contiguous from 0; anything else is a different list.
    if (Number(match[1]) !== statements.length) continue;
    statements.push(match[2]);
  }
  return statements;
}

export interface AssertionsToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Answer the agent turn for a "Generate assertions" request, or null when this
 * conversation isn't one.
 *
 * `messageTexts` is every message's text in order, so a turn that already
 * produced the card can be recognized and ended.
 */
export function matchAssertionsAgentTurn(
  lastUserText: string,
  messageTexts: string[],
): AssertionsToolCall | null {
  if (!ASSERTIONS_REQUEST_RE.test(lastUserText)) return null;

  // The card is already up (the tool said so), so the turn is over. Falling
  // through to the canned text response is what ends it — answering with the
  // tool call again would loop, since the triggering user message never
  // changes.
  const plainTexts = messageTexts.map(toPlainText);
  if (plainTexts.some((text) => text.includes(ASSERTIONS_TOOL_DONE_MARKER))) {
    return null;
  }

  const statements = parseNumberedStatements(lastUserText);
  if (statements.length === 0) return null;

  const locator = reusableLocator(statements);
  return {
    name: "generate_test_assertions",
    args: {
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
 * The post-approval turn: the card asks the agent to run the spec it just
 * generated. Answered as plain text so E2E can assert the hand-off happened
 * without paying for a real Playwright run.
 */
export function matchAssertionsVerifyTurn(text: string): string | null {
  const match = VERIFY_REQUEST_RE.exec(text);
  return match ? `Running ${match[1]} to check the recorded flow.` : null;
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
