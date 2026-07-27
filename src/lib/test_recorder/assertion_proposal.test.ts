import { describe, expect, it } from "vitest";

import {
  AssertionProposalPayloadSchema,
  buildPlanItems,
  countAssertions,
  moveAssertion,
  type AssertionPlanItem,
} from "./assertion_proposal";

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

  it("falls back to the raw statement for a missing description and ignores a duplicate index", () => {
    const { items } = buildPlanItems({
      bodyStatements: STATEMENTS,
      stepDescriptions: [
        { index: 0, text: "First" },
        { index: 0, text: "Duplicate that must not win" },
      ],
      assertions: [],
      newId: idFactory(),
    });
    const steps = items.filter((i) => i.kind === "step");
    expect(steps[0].kind === "step" && steps[0].text).toBe("First");
    expect(steps[1].kind === "step" && steps[1].text).toBe(
      `page.getByRole("button", { name: "Add" }).click()`,
    );
  });

  it("places an afterStep of -1 before the first step", () => {
    const { items } = buildPlanItems({
      bodyStatements: STATEMENTS,
      stepDescriptions: [],
      assertions: [{ afterStep: -1, text: "before", code: "await expect(a);" }],
      newId: idFactory(),
    });
    expect(items[0].kind).toBe("assertion");
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

  it("keeps model order for two assertions on the same step", () => {
    const { items } = buildPlanItems({
      bodyStatements: STATEMENTS,
      stepDescriptions: [],
      assertions: [
        { afterStep: 1, text: "first", code: "await expect(a);" },
        { afterStep: 1, text: "second", code: "await expect(b);" },
      ],
      newId: idFactory(),
    });
    const texts = items
      .filter((i) => i.kind === "assertion")
      .map((i) => i.kind === "assertion" && i.text);
    expect(texts).toEqual(["first", "second"]);
  });

  it("marks every model assertion as not needing code re-synthesis", () => {
    const { items } = buildPlanItems({
      bodyStatements: STATEMENTS,
      stepDescriptions: [],
      assertions: [{ afterStep: 0, text: "x", code: "await expect(a);" }],
      newId: idFactory(),
    });
    const assertion = items.find((i) => i.kind === "assertion");
    expect(assertion).toMatchObject({ needsCode: false, origin: "model" });
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

  it("moves an assertion up", () => {
    const moved = moveAssertion(plan, 1, 0);
    expect(moved[0].kind).toBe("assertion");
  });

  it("returns the same reference on every no-op", () => {
    expect(moveAssertion(plan, 1, 1)).toBe(plan);
    expect(moveAssertion(plan, -1, 2)).toBe(plan);
    expect(moveAssertion(plan, 1, 9)).toBe(plan);
    // index 0 is a step, which is never draggable
    expect(moveAssertion(plan, 0, 2)).toBe(plan);
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
  it("round-trips a payload through JSON", () => {
    const payload = {
      version: 1 as const,
      appId: 7,
      specPath: "e2e-tests/recorded-add.spec.ts",
      testTitle: "add an item",
      specHash: "abc123",
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

  it("rejects an unknown item kind", () => {
    expect(
      AssertionProposalPayloadSchema.safeParse({
        version: 1,
        appId: 1,
        specPath: "p",
        testTitle: "t",
        specHash: "h",
        items: [{ kind: "note", text: "x" }],
      }).success,
    ).toBe(false);
  });
});
