import { describe, expect, it } from "vitest";

import { RECORDED_TEST_DRAFT_VERSION, type RecordedTestDraft } from "./draft";
import {
  applyRecordedSelectorRepairs,
  RecordedSelectorRepairSchema,
} from "./selector_repair";

const CSS = "#root > main > form > div:nth-of-type(2) > input";

function draft(): RecordedTestDraft {
  return {
    version: RECORDED_TEST_DRAFT_VERSION,
    draftId: "draft-1",
    authMode: "none",
    actions: [
      { kind: "fill", locator: { kind: "css", value: CSS }, value: "a" },
      { kind: "fill", locator: { kind: "css", value: CSS }, value: "b" },
      {
        kind: "click",
        locator: { kind: "role", value: "button", name: "Save" },
      },
    ],
  };
}

describe("applyRecordedSelectorRepairs", () => {
  it("accepts descriptive kebab-case ids and rejects generated-looking syntax", () => {
    expect(
      RecordedSelectorRepairSchema.safeParse({
        actionIndex: 0,
        originalCss: CSS,
        testId: "due-date-input",
      }).success,
    ).toBe(true);
    expect(
      RecordedSelectorRepairSchema.safeParse({
        actionIndex: 0,
        originalCss: CSS,
        testId: "Due Date Input",
      }).success,
    ).toBe(false);
  });

  it("repairs only the indexed action when another route uses the same CSS", () => {
    const original = draft();
    const result = applyRecordedSelectorRepairs({
      draft: original,
      repairs: [{ actionIndex: 0, originalCss: CSS, testId: "due-date-input" }],
    });

    expect(result.problems).toEqual([]);
    expect(result.repairedActionCount).toBe(1);
    expect(result.draft.actions).toEqual([
      {
        kind: "fill",
        locator: { kind: "testid", value: "due-date-input" },
        value: "a",
      },
      {
        kind: "fill",
        locator: { kind: "css", value: CSS },
        value: "b",
      },
      original.actions[2],
    ]);
    expect(original.actions[0]).toMatchObject({
      locator: { kind: "css", value: CSS },
    });
  });

  it("rejects stale, non-fragile, and ambiguous repairs without changing the draft", () => {
    const original = draft();
    const result = applyRecordedSelectorRepairs({
      draft: original,
      repairs: [
        { actionIndex: 0, originalCss: "body > wrong", testId: "due-date" },
        { actionIndex: 2, originalCss: "#save", testId: "save-button" },
      ],
    });

    expect(result.problems).toEqual([
      expect.stringContaining("does not match recorded action 0"),
      expect.stringContaining("already role rather than CSS"),
    ]);
    expect(result.draft).toBe(original);
    expect(result.repairedActionCount).toBe(0);
  });

  it("rejects duplicate test ids for different elements", () => {
    const original = draft();
    original.actions.push({
      kind: "click",
      locator: { kind: "css", value: "body > aside > button" },
    });

    const result = applyRecordedSelectorRepairs({
      draft: original,
      repairs: [
        { actionIndex: 0, originalCss: CSS, testId: "target-control" },
        {
          actionIndex: 3,
          originalCss: "body > aside > button",
          testId: "target-control",
        },
      ],
    });

    expect(result.problems).toEqual([
      expect.stringContaining('reuses data-testid "target-control"'),
    ]);
    expect(result.draft).toBe(original);
  });

  it("rejects a test id already used by the parked draft", () => {
    const original = draft();
    original.actions.push({
      kind: "click",
      locator: { kind: "testid", value: "due-date-input" },
    });

    const result = applyRecordedSelectorRepairs({
      draft: original,
      repairs: [{ actionIndex: 0, originalCss: CSS, testId: "due-date-input" }],
    });

    expect(result.problems).toEqual([
      expect.stringContaining('data-testid "due-date-input"'),
    ]);
    expect(result.draft).toBe(original);
  });

  it("allows explicit repairs to reuse an id for the same source element", () => {
    const original = draft();
    const sourceHint = {
      relativePath: "src/EventForm.tsx",
      line: 84,
      column: 10,
      tagName: "input",
      exact: true,
    } as const;
    for (const action of original.actions.slice(0, 2)) {
      if ("locator" in action && action.locator) {
        action.locator.sourceHint = sourceHint;
      }
    }

    const result = applyRecordedSelectorRepairs({
      draft: original,
      repairs: [
        { actionIndex: 0, originalCss: CSS, testId: "due-date-input" },
        { actionIndex: 1, originalCss: CSS, testId: "due-date-input" },
      ],
    });

    expect(result.problems).toEqual([]);
    expect(result.repairedActionCount).toBe(2);
  });
});
