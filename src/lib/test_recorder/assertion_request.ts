import { recordedBodyStatements } from "./codegen";
import type { RecordedTestDraft } from "./draft";
import { isFragileCssLocator } from "./selector_quality";

function fragileSelectorDetails(draft: RecordedTestDraft): string[] {
  const statementOffset =
    recordedBodyStatements(draft).length - draft.actions.length;
  const fragile = draft.actions.flatMap((action, actionIndex) => {
    const locator = "locator" in action ? action.locator : undefined;
    if (!locator || !isFragileCssLocator(locator)) {
      return [];
    }

    const hint = locator.sourceHint;
    return [
      `- Statement ${statementOffset + actionIndex}; recorded action ${actionIndex}`,
      `  Original CSS: ${JSON.stringify(locator.value)}`,
      hint
        ? `  Source hint: ${JSON.stringify({
            file: hint.relativePath,
            line: hint.line,
            column: hint.column,
            element: hint.tagName,
            ...(hint.inputType ? { inputType: hint.inputType } : {}),
            exactElement: hint.exact,
          })}`
        : "  Source hint: unavailable — search the app code and only repair it if the element is unambiguous.",
    ];
  });

  if (fragile.length === 0) return [];
  return [
    "",
    "Fragile selectors to stabilize before proposing the test:",
    ...fragile,
    "",
    "For each element you can identify safely:",
    "1. Inspect the hinted app source. Reuse an existing stable data-testid, or add one with the normal file-editing tools. Use a descriptive static kebab-case value; do not use an ordinal such as input-3.",
    "2. After the source edit succeeds, include one selectorRepairs entry in generate_test_assertions with the recorded action index, exact original CSS, and test id. One repair updates every action with that CSS.",
    "3. Use the repaired getByTestId locator in any assertion that targets that element.",
    "If the hint is missing, points only to an ancestor, identifies a repeated list item, or is otherwise ambiguous, do not guess: omit that repair and keep the recorded CSS locator.",
  ];
}

/** The user message that hands one parked recording to the local agent. */
export function buildRecordedTestProposalPrompt(
  draft: RecordedTestDraft,
  steps: string[] = recordedBodyStatements(draft),
): string {
  return [
    `Add assertions to the test I just recorded${draft.testName ? `: "${draft.testName}"` : ""}`,
    "",
    // Named in the prompt and echoed back through the tool, so a request that
    // sat queued while a newer recording replaced this one is rejected.
    `Recording id: ${draft.draftId}`,
    "",
    draft.testName
      ? `Use "${draft.testName}" as the test name — I chose it.`
      : "I didn't name it, so name it yourself from what the steps actually do.",
    "",
    "It isn't a file yet — here are its statements, numbered the way your generate_test_assertions tool counts them:",
    ...steps.map((step, index) => `${index}: ${step}`),
    ...fragileSelectorDetails(draft),
    "",
    'Note: I see these numbered from 1, not 0 — if I ask for a check after "step N", that\'s the statement you see as N-1.',
    "",
    "Call generate_test_assertions with that recording id, a test name, one plain-English step description per statement, plus the assertions you'd propose and any completed selector repairs. There's nothing to read as a test and nothing to run yet — I'll review the proposal, and Dyad generates the test file when I approve it.",
  ].join("\n");
}
