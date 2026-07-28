/**
 * Prompt for the assertion code-synthesis pass.
 *
 * The proposal itself comes from the agent's `generate_test_assertions` tool —
 * the model is given the recorded statements and hands us the steps and
 * assertions as tool arguments. This pass runs only on approve, and only for
 * assertions the user edited or authored themselves, so their plain-English
 * sentence still becomes working Playwright code before the spec is generated.
 *
 * The user payload uses line-anchored labels ("Playwright test:", "Statements:")
 * so the E2E fake-LLM server can match it precisely without hijacking ordinary
 * chat prompts that happen to mention the same words.
 */

export const TEST_ASSERTION_CODE_SYSTEM_PROMPT = `You translate plain-English assertions into Playwright code for ONE recorded test.

You are given the statements of the test body, numbered from 0, followed by
assertion descriptions written by a human. For each description, return the
single Playwright statement that checks it.

- "code" must be exactly ONE statement, on ONE line, starting with
  \`await expect(\` and ending with \`;\`. No comments. No test.step. No awaits
  other than the leading one.
- Prefer web-first assertions: expect(locator).toBeVisible() / .toHaveText() /
  .toHaveValue() / .toBeChecked(), and expect(page).toHaveURL().
- Reuse the exact locator chain from a nearby statement wherever possible.
- Never invent text, URLs, counts, roles, or test ids that do not already appear
  in the statements or in the description itself.
- Preserve every "id" exactly as given. If you cannot ground a description in the
  test, OMIT that entry rather than guessing.

Return ONLY JSON. No prose, no markdown fences:
{"assertions":[{"id":"...","code":"await expect(...).toBeVisible();"}]}`;

function formatStatements(bodyStatements: string[]): string {
  return bodyStatements
    .map((statement, index) => `${index}: ${statement}`)
    .join("\n");
}

export function buildAssertionCodePayload({
  testTitle,
  bodyStatements,
  requests,
}: {
  testTitle: string;
  bodyStatements: string[];
  requests: { id: string; afterStep: number; text: string }[];
}): string {
  return [
    `Playwright test: ${testTitle}`,
    `Statements:`,
    formatStatements(bodyStatements),
    ``,
    `Assertions to write:`,
    ...requests.map((r) => `${r.id} | after step ${r.afterStep} | ${r.text}`),
  ].join("\n");
}
