import { describe, expect, it } from "vitest";

import {
  ASSERTION_PROPOSAL_VERSION,
  AssertionProposalPayloadSchema,
  buildPlanItems,
  countAssertions,
  MAX_STEP_TEXT_DISPLAY_LENGTH,
  MAX_STEP_TEXT_LENGTH,
  moveAssertion,
  type AssertionPlanItem,
} from "./assertion_proposal";
import { RECORDED_TEST_DRAFT_VERSION } from "./draft";

const STATEMENTS = [
  `await page.goto("/");`,
  `await page.getByRole("button", { name: "Add" }).click();`,
  `await page.getByLabel("Name").fill("Ada");`,
];

function idFactory() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("buildPlanItems", () => {
  it("emits one step per statement, in order, with the model's sentences", () => {
    const { items } = buildPlanItems({
      bodyStatements: STATEMENTS,
      stepDescriptions: [
        { index: 0, text: "Open the home page" },
        { index: 1, text: "Click Add" },
        { index: 2, text: "Type Ada" },
      ],
      assertions: [],
      newId: idFactory(),
    });
    expect(items.map((i) => i.kind === "step" && i.text)).toEqual([
      "Open the home page",
      "Click Add",
      "Type Ada",
    ]);
  });

  // A recorded `fill` may carry 10,000 characters, and `actionToCodeLine`
  // JSON-escapes them — sixfold in the worst case. Left whole, the fallback
  // step text would blow past the payload schema and fail a recording that
  // never left its own limits.
  it("truncates a step row that would exceed the payload schema", () => {
    const value = "\u0001".repeat(10_000);
    const statement = `await page.getByLabel("Notes").fill(${JSON.stringify(value)});`;
    expect(statement.length).toBeGreaterThan(MAX_STEP_TEXT_LENGTH);

    const { items } = buildPlanItems({
      bodyStatements: [statement],
      // Also applied to a model description long enough to break the schema.
      stepDescriptions: [{ index: 0, text: "x".repeat(50_000) }],
      assertions: [],
      newId: idFactory(),
    });

    const [step] = items;
    expect(step.kind).toBe("step");
    if (step.kind !== "step") return;
    expect(step.text.length).toBe(MAX_STEP_TEXT_DISPLAY_LENGTH);
    expect(step.text.endsWith("…")).toBe(true);

    // And the whole payload still validates, which is the point.
    expect(
      AssertionProposalPayloadSchema.safeParse({
        version: ASSERTION_PROPOSAL_VERSION,
        appId: 1,
        draft: {
          version: RECORDED_TEST_DRAFT_VERSION,
          draftId: "draft-1",
          authMode: "none",
          actions: [],
        },
        testTitle: "long fill",
        specPath: null,
        items,
      }).success,
    ).toBe(true);
  });

  it("leaves a step row that already fits untouched", () => {
    const { items } = buildPlanItems({
      bodyStatements: [`await page.getByLabel("Name").fill("Ada");`],
      stepDescriptions: [],
      assertions: [],
      newId: idFactory(),
    });
    expect(items[0]).toMatchObject({
      kind: "step",
      text: `page.getByLabel("Name").fill("Ada")`,
    });
  });

  it("places an afterStep of -1 before the first step", () => {
    const { items } = buildPlanItems({
      bodyStatements: STATEMENTS,
      stepDescriptions: [],
      assertions: [{ afterStep: -1, text: "before", code: "await expect(a);" }],
      newId: idFactory(),
    });
    expect(items[0]).toMatchObject({
      kind: "assertion",
      needsCode: false,
      origin: "model",
    });
  });

  it("drops out-of-range afterStep values rather than clamping them", () => {
    const { items, droppedAssertionCount } = buildPlanItems({
      bodyStatements: STATEMENTS,
      stepDescriptions: [],
      assertions: [
        { afterStep: 3, text: "past the end", code: "await expect(a);" },
        { afterStep: -2, text: "before the start", code: "await expect(b);" },
        { afterStep: 1, text: "valid", code: "await expect(c);" },
      ],
      newId: idFactory(),
    });
    expect(droppedAssertionCount).toBe(2);
    expect(countAssertions(items)).toBe(1);
  });
});

describe("moveAssertion", () => {
  const plan: AssertionPlanItem[] = [
    { kind: "step", stepIndex: 0, text: "a" },
    {
      kind: "assertion",
      id: "x",
      text: "check",
      code: "await expect(a);",
      needsCode: false,
      origin: "model",
    },
    { kind: "step", stepIndex: 1, text: "b" },
    { kind: "step", stepIndex: 2, text: "c" },
  ];

  it("moves an assertion down past a step", () => {
    const next = moveAssertion(plan, 1, 3);
    expect(
      next.map((i) => (i.kind === "step" ? `s${i.stepIndex}` : i.id)),
    ).toEqual(["s0", "s1", "s2", "x"]);
  });

  const layout = (items: AssertionPlanItem[]) =>
    items.map((i) => (i.kind === "step" ? `s${i.stepIndex}` : i.id));

  it("moves an assertion up past a step", () => {
    expect(layout(moveAssertion(plan, 1, 0))).toEqual(["x", "s0", "s1", "s2"]);
  });

  it("leaves the plan alone for a move it can't make", () => {
    // The arrows and drag-and-drop both call this with whatever index the DOM
    // handed them, so every rejected case has to be a no-op rather than a
    // silent reshuffle of the steps.
    expect(moveAssertion(plan, 1, 1)).toBe(plan); // nowhere to go
    expect(moveAssertion(plan, 0, 2)).toBe(plan); // a step, not an assertion
    expect(moveAssertion(plan, -1, 2)).toBe(plan);
    expect(moveAssertion(plan, 1, plan.length)).toBe(plan);
  });

  it("never reorders the steps, for any (from, to) pair", () => {
    const bigPlan: AssertionPlanItem[] = [
      { kind: "step", stepIndex: 0, text: "a" },
      {
        kind: "assertion",
        id: "x",
        text: "1",
        code: "await expect(a);",
        needsCode: false,
        origin: "model",
      },
      { kind: "step", stepIndex: 1, text: "b" },
      { kind: "step", stepIndex: 2, text: "c" },
      {
        kind: "assertion",
        id: "y",
        text: "2",
        code: "await expect(b);",
        needsCode: false,
        origin: "model",
      },
      { kind: "step", stepIndex: 3, text: "d" },
    ];
    const stepOrder = (items: AssertionPlanItem[]) =>
      items.flatMap((i) => (i.kind === "step" ? [i.stepIndex] : []));
    const expected = stepOrder(bigPlan);

    for (let from = 0; from < bigPlan.length; from++) {
      for (let to = 0; to < bigPlan.length; to++) {
        expect(stepOrder(moveAssertion(bigPlan, from, to))).toEqual(expected);
      }
    }
  });
});

describe("AssertionProposalPayloadSchema", () => {
  const draft = {
    version: RECORDED_TEST_DRAFT_VERSION,
    draftId: "draft-test",
    testName: "add an item",
    authMode: "none" as const,
    actions: [
      {
        kind: "click" as const,
        locator: { kind: "role" as const, value: "button", name: "Add" },
      },
    ],
  };

  it("round-trips a payload through JSON", () => {
    // The payload lives in a chat message, so this round-trip is the storage
    // format — including the recording it must still be able to generate.
    const payload = {
      version: ASSERTION_PROPOSAL_VERSION,
      appId: 7,
      draft,
      testTitle: "add an item",
      specPath: null,
      items: [
        { kind: "step" as const, stepIndex: 0, text: "Open /" },
        {
          kind: "assertion" as const,
          id: "x",
          text: "It shows 1",
          code: `await expect(page.getByTestId("count")).toHaveText("1");`,
          needsCode: false,
          origin: "model" as const,
        },
        // What the card writes when the user adds a blank assertion of their
        // own: no code yet, flagged for synthesis on approve. A reloaded card
        // has to survive this shape, so the schema has to accept it.
        {
          kind: "assertion" as const,
          id: "y",
          text: "",
          code: null,
          needsCode: true,
          origin: "user" as const,
        },
      ],
    };
    expect(
      AssertionProposalPayloadSchema.parse(JSON.parse(JSON.stringify(payload))),
    ).toEqual(payload);
  });
});
