import { describe, expect, it } from "vitest";

import {
  actionToCodeLine,
  generateSpecSource,
  locatorToCode,
  recordedBodyStatements,
  recordedSpecFileName,
} from "./codegen";
import {
  draftIncludesSignIn,
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

/** The no-assertions save path, as `createRecordedSpec` composes it. */
function specForDraft(value: RecordedTestDraft): string {
  return generateSpecSource({
    testName: value.testName,
    includeSignIn: draftIncludesSignIn(value),
    bodyStatements: recordedBodyStatements(value),
  });
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
    expect(locatorToCode({ kind: "css", value: ".foo > .bar" })).toBe(
      `locator(".foo > .bar")`,
    );
    expect(
      locatorToCode({ kind: "role", value: "button", name: "Item", nth: 1 }),
    ).toBe(`getByRole("button", { name: "Item" }).nth(1)`);
  });

  it("carries exact through every name-matching builder", () => {
    // The recorder decides uniqueness by exact equality, but getByRole/getByLabel
    // /getByPlaceholder match case-insensitive substrings by default — so a
    // "Save" locator it called unique would also match "Save draft" at replay
    // and trip strict mode.
    expect(
      locatorToCode({
        kind: "role",
        value: "button",
        name: "Save",
        exact: true,
      }),
    ).toBe(`getByRole("button", { name: "Save", exact: true })`);
    expect(
      locatorToCode({ kind: "placeholder", value: "Email", exact: true }),
    ).toBe(`getByPlaceholder("Email", { exact: true })`);
    expect(locatorToCode({ kind: "label", value: "Email", exact: true })).toBe(
      `getByLabel("Email", { exact: true })`,
    );
  });
});

describe("recordedSpecFileName", () => {
  it("slugifies the test name, with a fallback and a numeric suffix", () => {
    expect(recordedSpecFileName("Add an item!")).toBe(
      "recorded-add-an-item.spec.ts",
    );
    expect(recordedSpecFileName("  ***  ")).toBe("recorded-test.spec.ts");
    expect(recordedSpecFileName("add", 1)).toBe("recorded-add.spec.ts");
    expect(recordedSpecFileName("add", 2)).toBe("recorded-add-2.spec.ts");
  });

  it("caps a very long name so the write can't fail with ENAMETOOLONG", () => {
    const name = recordedSpecFileName("a very long name ".repeat(50));
    expect(name.length).toBeLessThan(120);
    expect(name.startsWith("recorded-a-very-long-name-")).toBe(true);
    expect(name.endsWith(".spec.ts")).toBe(true);
    // No dangling separator where the slug was cut.
    expect(name).not.toContain("-.spec.ts");
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

  it("renders each action kind, escaping recorded values", () => {
    expect(actionToCodeLine({ kind: "press", key: "Escape" })).toBe(
      `await page.keyboard.press("Escape");`,
    );
    expect(
      actionToCodeLine({
        kind: "select",
        locator: { kind: "testid", value: "tags" },
        values: ["a", "b"],
      }),
    ).toBe(`await page.getByTestId("tags").selectOption(["a", "b"]);`);
    expect(
      actionToCodeLine({
        kind: "fill",
        locator: { kind: "placeholder", value: "Bio" },
        value: 'he said "hi"\nbye',
      }),
    ).toBe(
      `await page.getByPlaceholder("Bio").fill("he said \\"hi\\"\\nbye");`,
    );
  });
});

describe("generateSpecSource", () => {
  it("generates a signed-in spec from a draft", () => {
    const source = specForDraft(
      draft(
        [
          {
            kind: "fill",
            locator: { kind: "placeholder", value: "Email" },
            value: "a@b.com",
          },
          {
            kind: "click",
            locator: { kind: "role", value: "button", name: "Add" },
          },
          { kind: "navigate", path: "/done" },
          {
            kind: "dblclick",
            locator: { kind: "text", value: "Row", exact: true, nth: 2 },
          },
        ],
        { authMode: "neon-better-auth" },
      ),
    );
    expect(source).toBe(`import { test, expect } from "@playwright/test";
import { signIn } from "./fixtures/test-user";

test("my flow", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.getByPlaceholder("Email").fill("a@b.com");
  await page.getByRole("button", { name: "Add" }).click();
  await page.goto("/done");
  await page.getByText("Row", { exact: true }).nth(2).dblclick();
});
`);
  });

  it("omits the sign-in fixture for an unauthenticated recording", () => {
    const source = specForDraft(draft([], { testName: 'weird "name"' }));
    expect(source).not.toContain("signIn");
    expect(source).not.toContain("./fixtures/test-user");
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
