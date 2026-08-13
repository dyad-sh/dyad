import { recordedBodyStatements } from "./codegen";
import type { RecordedTestDraft } from "./draft";
import { isFragileCssLocator } from "./selector_quality";

function fragileSelectorDetails(draft: RecordedTestDraft): string[] {
  const statementOffset =
    recordedBodyStatements(draft).length - draft.actions.length;
  const groups = new Map<
    string,
    {
      actionIndexes: number[];
      statementIndexes: number[];
      css: string;
      sourceHint: unknown;
    }
  >();

  draft.actions.forEach((action, actionIndex) => {
    const locator = "locator" in action ? action.locator : undefined;
    if (!locator || !isFragileCssLocator(locator)) {
      return;
    }

    const sourceHint = locator.sourceHint
      ? {
          file: locator.sourceHint.relativePath,
          line: locator.sourceHint.line,
          column: locator.sourceHint.column,
          element: locator.sourceHint.tagName,
          ...(locator.sourceHint.inputType
            ? { inputType: locator.sourceHint.inputType }
            : {}),
          exactElement: locator.sourceHint.exact,
        }
      : null;
    const key = JSON.stringify({ css: locator.value, sourceHint });
    const group = groups.get(key) ?? {
      actionIndexes: [],
      statementIndexes: [],
      css: locator.value,
      sourceHint,
    };
    group.actionIndexes.push(actionIndex);
    group.statementIndexes.push(statementOffset + actionIndex);
    groups.set(key, group);
  });

  const fragile = [...groups.values()].flatMap((group) => {
    const statements = group.statementIndexes.join(", ");
    const actions = group.actionIndexes.join(", ");
    return [
      `- Statement${group.statementIndexes.length === 1 ? "" : "s"} ${statements}; recorded action${group.actionIndexes.length === 1 ? "" : "s"} ${actions}`,
      `  Original CSS: ${JSON.stringify(group.css)}`,
      group.sourceHint
        ? `  Source hint: ${JSON.stringify(group.sourceHint)}`
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
    "2. After the source edit succeeds, include one selectorRepairs entry in generate_test_assertions for every listed recorded action that should use it, with that action index, exact original CSS, and test id. Each repair updates only its referenced action.",
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
