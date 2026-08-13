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
 * of them atomically. Each repair updates only the indexed action: two routes
 * can produce the same structural CSS for unrelated source elements.
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
  const testIdByActionIndex = new Map<number, string>();
  const sourceByTestId = new Map<string, string | null>();
  const testIdBySource = new Map<string, string>();
  const seenActionIndexes = new Set<number>();
  const reservedTestIds = new Set(
    draft.actions.flatMap((action) => {
      const locator = locatorFor(action);
      return locator?.kind === "testid" ? [locator.value] : [];
    }),
  );

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
        `${label} repeats recorded action ${repair.actionIndex}; send at most one repair per recorded action.`,
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

    if (reservedTestIds.has(repair.testId)) {
      problems.push(
        `${label} reuses data-testid ${JSON.stringify(repair.testId)}, which is already used by another recorded locator and could make the Playwright locator ambiguous.`,
      );
      return;
    }

    const sourceKey = locator.sourceHint
      ? JSON.stringify(locator.sourceHint)
      : null;
    if (
      sourceByTestId.has(repair.testId) &&
      (sourceKey === null || sourceByTestId.get(repair.testId) !== sourceKey)
    ) {
      problems.push(
        `${label} reuses data-testid ${JSON.stringify(repair.testId)} for a different or unverified source element, which could make the Playwright locator ambiguous.`,
      );
      return;
    }
    if (sourceKey !== null) {
      const priorTestId = testIdBySource.get(sourceKey);
      if (priorTestId && priorTestId !== repair.testId) {
        problems.push(
          `${label} assigns a second data-testid to the same source element; use ${JSON.stringify(priorTestId)} consistently.`,
        );
        return;
      }
      testIdBySource.set(sourceKey, repair.testId);
    }

    testIdByActionIndex.set(repair.actionIndex, repair.testId);
    sourceByTestId.set(repair.testId, sourceKey);
  });

  if (problems.length > 0) {
    return { draft, problems, repairedActionCount: 0 };
  }

  let repairedActionCount = 0;
  const actions = draft.actions.map((action, actionIndex): RecordedAction => {
    const testId = testIdByActionIndex.get(actionIndex);
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
