import { describe, expect, it } from "vitest";

import {
  generateDraftSpecSource,
  generateSpecSource,
  locatorToCode,
  recordedBodyStatements,
  recordedSpecFileName,
} from "./codegen";
import {
  RECORDED_TEST_DRAFT_VERSION,
  type RecordedTestAuthMode,
  type RecordedTestDraft,
} from "./draft";
import type { RecordedAction } from "./types";

function draft(
  actions: RecordedAction[],
  {
    testName = "my flow",
    authMode = "none",
  }: { testName?: string; authMode?: RecordedTestAuthMode } = {},
): RecordedTestDraft {
  return {
    version: RECORDED_TEST_DRAFT_VERSION,
    testName,
    authMode,
    actions,
  };
}

describe("locatorToCode", () => {
  it("maps each locator kind to the matching Playwright builder", () => {
    expect(locatorToCode({ kind: "testid", value: "submit" })).toBe(
      `getByTestId("submit")`,
    );
    expect(locatorToCode({ kind: "role", value: "button", name: "Add" })).toBe(
      `getByRole("button", { name: "Add" })`,
    );
    expect(locatorToCode({ kind: "role", value: "button" })).toBe(
      `getByRole("button")`,
    );
    expect(locatorToCode({ kind: "placeholder", value: "Email" })).toBe(
      `getByPlaceholder("Email")`,
    );
    expect(locatorToCode({ kind: "label", value: "Email" })).toBe(
      `getByLabel("Email")`,
    );
    expect(locatorToCode({ kind: "text", value: "Row", exact: true })).toBe(
      `getByText("Row", { exact: true })`,
    );
    expect(locatorToCode({ kind: "dyadId", value: "src/App.tsx:12:4" })).toBe(
      `locator("[data-dyad-id=\\"src/App.tsx:12:4\\"]")`,
    );
    expect(locatorToCode({ kind: "css", value: ".foo > .bar" })).toBe(
      `locator(".foo > .bar")`,
    );
  });

  it("appends nth for ambiguous locators", () => {
    expect(
      locatorToCode({ kind: "role", value: "button", name: "Item", nth: 1 }),
    ).toBe(`getByRole("button", { name: "Item" }).nth(1)`);
  });
});

describe("recordedSpecFileName", () => {
  it("slugifies the test name", () => {
    expect(recordedSpecFileName("Add an item!")).toBe(
      "recorded-add-an-item.spec.ts",
    );
  });

  it("falls back to a usable name when nothing survives slugification", () => {
    expect(recordedSpecFileName("  ***  ")).toBe("recorded-test.spec.ts");
  });

  it("suffixes only from the second candidate on", () => {
    expect(recordedSpecFileName("add", 1)).toBe("recorded-add.spec.ts");
    expect(recordedSpecFileName("add", 2)).toBe("recorded-add-2.spec.ts");
  });
});

describe("recordedBodyStatements", () => {
  it("numbers the preamble and the recorded actions as one list", () => {
    expect(
      recordedBodyStatements(
        draft(
          [
            {
              kind: "click",
              locator: { kind: "role", value: "button", name: "Add" },
            },
          ],
          { authMode: "neon-better-auth" },
        ),
      ),
    ).toEqual([
      `await signIn(page);`,
      `await page.goto("/");`,
      `await page.getByRole("button", { name: "Add" }).click();`,
    ]);
  });

  it("drops the sign-in statement for an unauthenticated recording", () => {
    expect(recordedBodyStatements(draft([]))).toEqual([
      `await page.goto("/");`,
    ]);
  });
});

describe("generateSpecSource", () => {
  const actions: RecordedAction[] = [
    {
      kind: "fill",
      locator: { kind: "placeholder", value: "Email" },
      value: "a@b.com",
    },
    { kind: "click", locator: { kind: "role", value: "button", name: "Add" } },
    {
      kind: "check",
      locator: { kind: "role", value: "checkbox", name: "Subscribe" },
    },
    {
      kind: "select",
      locator: { kind: "testid", value: "color" },
      values: ["green"],
    },
    {
      kind: "press",
      locator: { kind: "placeholder", value: "Email" },
      key: "Enter",
    },
    { kind: "navigate", path: "/done" },
    {
      kind: "dblclick",
      locator: { kind: "text", value: "Row", exact: true, nth: 2 },
    },
  ];

  it("generates a signed-in spec", () => {
    expect(
      generateDraftSpecSource(draft(actions, { authMode: "neon-better-auth" })),
    ).toBe(`import { test, expect } from "@playwright/test";
import { signIn } from "./fixtures/test-user";

test("my flow", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.getByPlaceholder("Email").fill("a@b.com");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("checkbox", { name: "Subscribe" }).check();
  await page.getByTestId("color").selectOption("green");
  await page.getByPlaceholder("Email").press("Enter");
  await page.goto("/done");
  await page.getByText("Row", { exact: true }).nth(2).dblclick();
});
`);
  });

  it("omits the sign-in fixture for an unauthenticated recording", () => {
    const source = generateDraftSpecSource(draft(actions));
    expect(source).not.toContain("signIn");
    expect(source).not.toContain("./fixtures/test-user");
    expect(source).toContain(`await page.goto("/");`);
  });

  it("emits an array argument for multi-value selects", () => {
    const source = generateDraftSpecSource(
      draft([
        {
          kind: "select",
          locator: { kind: "testid", value: "tags" },
          values: ["a", "b"],
        },
      ]),
    );
    expect(source).toContain(`.selectOption(["a", "b"]);`);
  });

  it("escapes special characters in recorded values", () => {
    const source = generateDraftSpecSource(
      draft(
        [
          {
            kind: "fill",
            locator: { kind: "placeholder", value: "Bio" },
            value: 'he said "hi"\nbye',
          },
        ],
        { testName: 'weird "name"' },
      ),
    );
    expect(source).toContain(`.fill("he said \\"hi\\"\\nbye");`);
    expect(source).toContain(`test("weird \\"name\\"",`);
  });

  it("writes assertions exactly where the approved plan put them", () => {
    const source = generateSpecSource({
      testName: "checked",
      includeSignIn: false,
      bodyStatements: [
        `await page.goto("/");`,
        `await page.getByRole("button", { name: "Add" }).click();`,
        `await expect(page.getByTestId("row")).toBeVisible();`,
      ],
    });
    expect(source).toBe(`import { test, expect } from "@playwright/test";

test("checked", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("row")).toBeVisible();
});
`);
  });
});
