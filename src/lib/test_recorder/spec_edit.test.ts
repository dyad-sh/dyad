import { describe, expect, it } from "vitest";

import { generateSpecSource } from "./codegen";
import {
  ensureExpectImport,
  isSingleAssertionStatement,
  parseGeneratedSpec,
  renderSpec,
} from "./spec_edit";
import type { AssertionPlanItem } from "./assertion_proposal";
import type { RecordedAction } from "./types";

const ACTIONS: RecordedAction[] = [
  { kind: "click", locator: { kind: "role", value: "button", name: "Add" } },
  {
    kind: "fill",
    locator: { kind: "label", value: "Name" },
    value: "Ada",
  },
  { kind: "navigate", path: "/items" },
];

function stepsOnly(count: number): AssertionPlanItem[] {
  return Array.from({ length: count }, (_, stepIndex) => ({
    kind: "step" as const,
    stepIndex,
    text: `step ${stepIndex}`,
  }));
}

function assertion(
  id: string,
  code: string,
): Extract<AssertionPlanItem, { kind: "assertion" }> {
  return {
    kind: "assertion",
    id,
    text: `check ${id}`,
    code,
    needsCode: false,
    origin: "model",
  };
}

describe("parseGeneratedSpec + renderSpec round-trip", () => {
  it("reproduces a generated spec byte-for-byte when only steps are emitted", () => {
    const source = generateSpecSource(ACTIONS, {
      testName: "add an item",
      includeSignIn: true,
    });
    const parsed = parseGeneratedSpec(source)!;
    expect(parsed).not.toBeNull();
    expect(parsed.testTitle).toBe("add an item");
    // signIn + goto + the three actions.
    expect(parsed.bodyStatements).toHaveLength(5);
    expect(renderSpec(parsed, stepsOnly(5))).toBe(source);
  });

  it("round-trips a spec generated without signIn", () => {
    const source = generateSpecSource(ACTIONS, {
      testName: "add an item",
      includeSignIn: false,
    });
    const parsed = parseGeneratedSpec(source)!;
    expect(parsed.bodyStatements).toHaveLength(4);
    expect(renderSpec(parsed, stepsOnly(4))).toBe(source);
  });

  it("preserves CRLF line endings and a missing trailing newline", () => {
    const source = generateSpecSource(ACTIONS, {
      testName: "crlf",
      includeSignIn: false,
    })
      .replace(/\n/g, "\r\n")
      .replace(/\r\n$/, "");
    const parsed = parseGeneratedSpec(source)!;
    expect(parsed.eol).toBe("\r\n");
    expect(parsed.endsWithNewline).toBe(false);
    expect(renderSpec(parsed, stepsOnly(4))).toBe(source);
  });
});

describe("renderSpec splicing", () => {
  const source = generateSpecSource(ACTIONS, {
    testName: "add an item",
    includeSignIn: false,
  });

  it("splices an assertion before the first step", () => {
    const parsed = parseGeneratedSpec(source)!;
    const out = renderSpec(parsed, [
      assertion("a", `await expect(page).toHaveURL("/");`),
      ...stepsOnly(4),
    ]);
    const body = out.split("\n").filter((l) => l.startsWith("  "));
    expect(body[0]).toBe(`  await expect(page).toHaveURL("/");`);
  });

  it("splices in the middle and at the tail, and adds the expect import", () => {
    const parsed = parseGeneratedSpec(source)!;
    const steps = stepsOnly(4);
    const out = renderSpec(parsed, [
      steps[0],
      steps[1],
      assertion("mid", `await expect(page.getByLabel("Name")).toBeVisible();`),
      steps[2],
      steps[3],
      assertion("tail", `await expect(page).toHaveURL("/items");`),
    ]);
    const lines = out.split("\n");
    expect(lines[0]).toBe(`import { test, expect } from "@playwright/test";`);
    expect(lines).toContain(
      `  await expect(page.getByLabel("Name")).toBeVisible();`,
    );
    expect(lines[lines.length - 3]).toBe(
      `  await expect(page).toHaveURL("/items");`,
    );
  });

  it("throws rather than dropping or duplicating a recorded step", () => {
    const parsed = parseGeneratedSpec(source)!;
    expect(() => renderSpec(parsed, stepsOnly(3))).toThrow(/3 of 4/);
    expect(() =>
      renderSpec(parsed, [...stepsOnly(4), stepsOnly(1)[0]]),
    ).toThrow(/more than once/);
  });

  it("throws when an assertion has no code to write", () => {
    const parsed = parseGeneratedSpec(source)!;
    expect(() =>
      renderSpec(parsed, [
        ...stepsOnly(4),
        { ...assertion("x", ""), code: null },
      ]),
    ).toThrow(/no code/);
  });
});

describe("parseGeneratedSpec bails on hand-edited specs", () => {
  const cases: Record<string, string> = {
    "multi-line statement": `import { test } from "@playwright/test";

test("t", async ({ page }) => {
  await page.getByRole("button", {
    name: "Add",
  }).click();
});
`,
    "comment in the body": `import { test } from "@playwright/test";

test("t", async ({ page }) => {
  // set up
  await page.goto("/");
});
`,
    "two test blocks": `import { test } from "@playwright/test";

test("a", async ({ page }) => {
  await page.goto("/");
});

test("b", async ({ page }) => {
  await page.goto("/");
});
`,
    "describe wrapper": `import { test } from "@playwright/test";

test.describe("group", () => {
  test("a", async ({ page }) => {
    await page.goto("/");
  });
});
`,
    "extra fixtures": `import { test } from "@playwright/test";

test("t", async ({ page, request }) => {
  await page.goto("/");
});
`,
    "missing closing brace": `import { test } from "@playwright/test";

test("t", async ({ page }) => {
  await page.goto("/");
`,
    "statement without a semicolon": `import { test } from "@playwright/test";

test("t", async ({ page }) => {
  await page.goto("/")
});
`,
  };

  for (const [name, source] of Object.entries(cases)) {
    it(`returns null for a ${name}`, () => {
      expect(parseGeneratedSpec(source)).toBeNull();
    });
  }
});

describe("ensureExpectImport", () => {
  it("leaves an import that already has expect alone", () => {
    const header = [`import { test, expect } from "@playwright/test";`, ""];
    expect(ensureExpectImport(header)).toBe(header);
  });

  it("adds expect to an existing named import, preserving the quote style", () => {
    expect(
      ensureExpectImport([`import { test } from '@playwright/test';`]),
    ).toEqual([`import { test, expect } from '@playwright/test';`]);
  });

  it("prepends an import when @playwright/test isn't imported at all", () => {
    expect(
      ensureExpectImport([`import { signIn } from "./fixtures";`]),
    ).toEqual([
      `import { test, expect } from "@playwright/test";`,
      `import { signIn } from "./fixtures";`,
    ]);
  });
});

describe("isSingleAssertionStatement", () => {
  it("accepts a single assertion, including one whose string contains a semicolon", () => {
    expect(
      isSingleAssertionStatement(`await expect(page).toHaveURL("/items");`),
    ).toBe(true);
    expect(
      isSingleAssertionStatement(
        `await expect(page.getByText("a;b")).toBeVisible();`,
      ),
    ).toBe(true);
    expect(
      isSingleAssertionStatement(`expect(page.getByText("x")).toBeVisible();`),
    ).toBe(true);
  });

  it("rejects anything that isn't exactly one assertion statement", () => {
    expect(
      isSingleAssertionStatement(
        `await expect(a).toBeVisible(); await expect(b).toBeVisible();`,
      ),
    ).toBe(false);
    expect(
      isSingleAssertionStatement(`await expect(page.getByText("x").toBe();`),
    ).toBe(false);
    expect(isSingleAssertionStatement(`await page.click();`)).toBe(false);
    expect(
      isSingleAssertionStatement(`await expect(a).toBeVisible(); // note`),
    ).toBe(false);
    expect(
      isSingleAssertionStatement(`await expect(a)\n  .toBeVisible();`),
    ).toBe(false);
  });
});
