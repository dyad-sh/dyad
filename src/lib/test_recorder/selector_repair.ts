import { z } from "zod";

import type { RecordedTestDraft } from "./draft";
import { isFragileCssLocator } from "./selector_quality";
import { MAX_LOCATOR_LENGTH, type RecordedAction } from "./types";

export const MAX_RECORDED_TEST_ID_LENGTH = 120;

export const RecordedSelectorRepairSchema = z.object({
  actionIndex: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "0-based index in the recorded actions, copied from the fragile-selector details in the request. This is not the displayed statement index.",
    ),
  originalCss: z
    .string()
    .min(1)
    .max(MAX_LOCATOR_LENGTH)
    .describe(
      "The fragile CSS selector copied exactly from the request. It prevents a stale repair from changing a different action.",
    ),
  testId: z
    .string()
    .min(1)
    .max(MAX_RECORDED_TEST_ID_LENGTH)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
    .describe(
      "The static kebab-case data-testid already added to the app source, for example due-date-input. Do not use a generated ordinal such as input-3.",
    ),
});
export type RecordedSelectorRepair = z.infer<
  typeof RecordedSelectorRepairSchema
>;

function locatorFor(action: RecordedAction) {
  return "locator" in action ? action.locator : undefined;
}

/**
 * Validate selector repairs against the exact parked recording, then apply all
 * of them atomically. One repair rewrites every action carrying the same CSS
 * locator so repeated fills/clicks keep using the same source test hook.
 */
export function applyRecordedSelectorRepairs({
  draft,
  repairs,
}: {
  draft: RecordedTestDraft;
  repairs: RecordedSelectorRepair[];
}): {
  draft: RecordedTestDraft;
  problems: string[];
  repairedActionCount: number;
} {
  if (repairs.length === 0) {
    return { draft, problems: [], repairedActionCount: 0 };
  }

  const problems: string[] = [];
  const testIdByCss = new Map<string, string>();
  const cssByTestId = new Map<string, string>();
  const seenActionIndexes = new Set<number>();

  repairs.forEach((repair, position) => {
    const label = `selector repair ${position + 1}`;
    const action = draft.actions[repair.actionIndex];
    const locator = action && locatorFor(action);

    if (!action) {
      problems.push(
        `${label} references recorded action ${repair.actionIndex}, but this recording has ${draft.actions.length} action(s).`,
      );
      return;
    }
    if (seenActionIndexes.has(repair.actionIndex)) {
      problems.push(
        `${label} repeats recorded action ${repair.actionIndex}; send one repair for a CSS selector because it updates every matching action.`,
      );
      return;
    }
    seenActionIndexes.add(repair.actionIndex);

    if (!locator) {
      problems.push(
        `${label} points to recorded action ${repair.actionIndex}, which has no element locator.`,
      );
      return;
    }
    if (locator.kind !== "css") {
      problems.push(
        `${label} points to recorded action ${repair.actionIndex}, whose locator is already ${locator.kind} rather than CSS.`,
      );
      return;
    }
    if (locator.value !== repair.originalCss) {
      problems.push(
        `${label} does not match recorded action ${repair.actionIndex}; copy its original CSS exactly.`,
      );
      return;
    }
    if (!isFragileCssLocator(locator)) {
      problems.push(
        `${label} targets a CSS locator that Dyad does not classify as fragile, so it was left unchanged.`,
      );
      return;
    }

    const priorTestId = testIdByCss.get(repair.originalCss);
    if (priorTestId) {
      problems.push(
        `${label} repeats CSS ${JSON.stringify(repair.originalCss)}; the earlier repair already updates every matching action.`,
      );
      return;
    }
    const priorCss = cssByTestId.get(repair.testId);
    if (priorCss && priorCss !== repair.originalCss) {
      problems.push(
        `${label} reuses data-testid ${JSON.stringify(repair.testId)} for a different CSS locator, which could make the Playwright locator ambiguous.`,
      );
      return;
    }

    testIdByCss.set(repair.originalCss, repair.testId);
    cssByTestId.set(repair.testId, repair.originalCss);
  });

  if (problems.length > 0) {
    return { draft, problems, repairedActionCount: 0 };
  }

  let repairedActionCount = 0;
  const actions = draft.actions.map((action): RecordedAction => {
    const locator = locatorFor(action);
    if (!locator || locator.kind !== "css") return action;
    const testId = testIdByCss.get(locator.value);
    if (!testId) return action;
    repairedActionCount++;
    return {
      ...action,
      locator: { kind: "testid", value: testId },
    } as RecordedAction;
  });

  return {
    draft: { ...draft, actions },
    problems: [],
    repairedActionCount,
  };
}
