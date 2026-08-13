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
    draftId: "draft-test",
    testName,
    authMode,
    actions,
  };
}

/** A draft's spec with no assertions in it, as the approval composes one. */
function specForDraft(value: RecordedTestDraft): string {
  return generateSpecSource({
    testName: value.testName ?? "recorded test",
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

  it("never emits development source hints into Playwright code", () => {
    expect(
      locatorToCode({
        kind: "css",
        value: "body > input",
        sourceHint: {
          relativePath: "src/EventForm.tsx",
          line: 84,
          column: 10,
          tagName: "input",
          inputType: "date",
          exact: true,
        },
      }),
    ).toBe(`locator("body > input")`);
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

  // The session opened on that route, so replay has to as well — a leading "/"
  // would load a page it immediately leaves.
  it("lets the recorder's opening route replace the root navigation", () => {
    expect(
      recordedBodyStatements(
        draft([{ kind: "navigate", path: "/items", initial: true }]),
      ),
    ).toEqual([`await page.goto("/items");`]);
  });

  // ...but a navigation the user made mid-flow started somewhere, and that
  // somewhere is the history entry Back replays onto. Without the root `goto`,
  // `page.goBack()` returns to `about:blank` rather than to "/".
  it("keeps the root navigation before a user-initiated first navigation", () => {
    expect(
      recordedBodyStatements(
        draft([{ kind: "navigate", path: "/items" }, { kind: "back" }]),
      ),
    ).toEqual([
      `await page.goto("/");`,
      `await page.goto("/items");`,
      `await page.goBack();`,
    ]);
  });

  it("renders each action kind, escaping recorded values", () => {
    expect(actionToCodeLine({ kind: "press", key: "Escape" })).toBe(
      `await page.keyboard.press("Escape");`,
    );
    expect(actionToCodeLine({ kind: "navigate", path: "/items?q=x" })).toBe(
      `await page.goto("/items?q=x");`,
    );
    // The preview's history buttons replay as history moves, so a broken
    // back-navigation fails the test instead of being jumped over.
    expect(actionToCodeLine({ kind: "back" })).toBe(`await page.goBack();`);
    expect(actionToCodeLine({ kind: "forward" })).toBe(
      `await page.goForward();`,
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
    // A press with a locator targets the control rather than the page — a
    // different statement from the page-level shortcut above.
    expect(
      actionToCodeLine({
        kind: "press",
        locator: { kind: "label", value: "Search" },
        key: "Enter",
      }),
    ).toBe(`await page.getByLabel("Search").press("Enter");`);
    expect(
      actionToCodeLine({
        kind: "check",
        locator: { kind: "testid", value: "agree" },
      }),
    ).toBe(`await page.getByTestId("agree").check();`);
    expect(
      actionToCodeLine({
        kind: "uncheck",
        locator: { kind: "testid", value: "agree" },
      }),
    ).toBe(`await page.getByTestId("agree").uncheck();`);
    expect(
      actionToCodeLine({
        kind: "dblclick",
        locator: { kind: "text", value: "Open" },
      }),
    ).toBe(`await page.getByText("Open").dblclick();`);
    expect(actionToCodeLine({ kind: "navigate", path: "/items?page=2" })).toBe(
      `await page.goto("/items?page=2");`,
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
