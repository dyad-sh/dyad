import { describe, expect, it } from "vitest";

import {
  ASSERTION_PROPOSAL_VERSION,
  AssertionProposalPayloadSchema,
  buildPlanItems,
  countAssertions,
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
      ],
    };
    expect(
      AssertionProposalPayloadSchema.parse(JSON.parse(JSON.stringify(payload))),
    ).toEqual(payload);
  });
});
