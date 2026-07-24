import { describe, expect, it } from "vitest";
import { describeTestSteps } from "./describe_test_steps";
import { parseTestCases } from "./parse_test_cases";

/** Wraps statements in a single test so the fixtures stay readable. */
function spec(...lines: string[]): string {
  return [
    `import { test, expect } from "@playwright/test";`,
    ``,
    `test("a test", async ({ page }) => {`,
    ...lines.map((line) => `  ${line}`),
    `});`,
    ``,
  ].join("\n");
}

/** The step sentences of the first (usually only) test in a spec. */
function steps(source: string): string[] {
  const result = describeTestSteps(source);
  expect(result.parseError).toBeUndefined();
  return result.tests[0].steps.map((step) => step.text);
}

describe("describeTestSteps", () => {
  it("describes clicks on role locators", () => {
    expect(
      steps(
        spec(`await page.getByRole("button", { name: "Submit" }).click();`),
      ),
    ).toEqual([`Click the "Submit" button.`]);
  });

  it("describes navigation", () => {
    expect(
      steps(
        spec(
          `await page.goto("/login");`,
          `await page.reload();`,
          `await page.goBack();`,
        ),
      ),
    ).toEqual([
      `Go to "/login".`,
      `Reload the page.`,
      `Go back to the previous page.`,
    ]);
  });

  it("describes form input", () => {
    expect(
      steps(
        spec(
          `await page.getByLabel("Email").fill("a@b.com");`,
          `await page.getByPlaceholder("Search").fill("shoes");`,
          `await page.getByLabel("Terms").check();`,
          `await page.getByLabel("Country").selectOption("US");`,
          `await page.getByRole("textbox", { name: "Name" }).press("Enter");`,
        ),
      ),
    ).toEqual([
      `Fill the "Email" field with "a@b.com".`,
      `Fill the "Search" field with "shoes".`,
      `Check the "Terms" field.`,
      `Select "US" in the "Country" field.`,
      `Press "Enter" in the "Name" text box.`,
    ]);
  });

  it("describes locator assertions", () => {
    expect(
      steps(
        spec(
          `await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();`,
          `await expect(page.getByTestId("total")).toHaveText("$42");`,
          `await expect(page.getByRole("listitem")).toHaveCount(3);`,
          `await expect(page.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");`,
        ),
      ),
    ).toEqual([
      `Check that the "Welcome" heading is visible.`,
      `Check that the "total" element has the text "$42".`,
      `Check that the list item appears 3 times.`,
      `Check that the "Docs" link has the attribute "href" set to "/docs".`,
    ]);
  });

  it("describes page-level assertions", () => {
    expect(
      steps(
        spec(
          `await expect(page).toHaveURL("/dashboard");`,
          `await expect(page).toHaveTitle("Dyad");`,
        ),
      ),
    ).toEqual([
      `Check that the page URL is "/dashboard".`,
      `Check that the page title is "Dyad".`,
    ]);
  });

  it("negates assertions grammatically", () => {
    expect(
      steps(
        spec(
          `await expect(page.getByText("Error")).not.toBeVisible();`,
          `await expect(page.getByTestId("total")).not.toHaveText("$0");`,
          `await expect(page.getByRole("listitem")).not.toHaveCount(0);`,
        ),
      ),
    ).toEqual([
      `Check that the text "Error" is not visible.`,
      `Check that the "total" element does not have the text "$0".`,
      `Check that the list item does not appear 0 times.`,
    ]);
  });

  it("resolves locators bound to variables, including nesting", () => {
    expect(
      steps(
        spec(
          `const row = page.getByRole("row", { name: "Alice" });`,
          `await row.getByRole("button", { name: "Delete" }).click();`,
        ),
      ),
    ).toEqual([`Click the "Delete" button inside the "Alice" row.`]);
  });

  it("resolves string constants used as values", () => {
    expect(
      steps(
        spec(
          `const email = "a@b.com";`,
          `await page.getByLabel("Email").fill(email);`,
        ),
      ),
    ).toEqual([`Fill the "Email" field with "a@b.com".`]);
  });

  it("describes locator refiners, converting nth() from 0-based", () => {
    expect(
      steps(
        spec(
          `await page.getByRole("listitem").first().click();`,
          `await page.getByRole("listitem").nth(2).click();`,
          `await page.getByRole("listitem").last().click();`,
          `await page.getByRole("row").filter({ hasText: "Alice" }).click();`,
        ),
      ),
    ).toEqual([
      `Click the first list item.`,
      `Click the third list item.`,
      `Click the last list item.`,
      `Click the row containing "Alice".`,
    ]);
  });

  it("turns test.step into a group with indented children", () => {
    const result = describeTestSteps(
      spec(
        `await test.step("Sign in", async () => {`,
        `  await page.getByLabel("Email").fill("a@b.com");`,
        `});`,
        `await page.getByRole("button", { name: "Done" }).click();`,
      ),
    );
    expect(result.tests[0].steps).toEqual([
      { kind: "group", text: "Sign in", line: 4, depth: 0 },
      {
        kind: "action",
        text: `Fill the "Email" field with "a@b.com".`,
        line: 5,
        depth: 1,
      },
      { kind: "action", text: `Click the "Done" button.`, line: 7, depth: 0 },
    ]);
  });

  it("prepends beforeEach setup as a group, wherever it is declared", () => {
    const source = [
      `import { test, expect } from "@playwright/test";`,
      `test("a test", async ({ page }) => {`,
      `  await page.getByRole("button", { name: "Go" }).click();`,
      `});`,
      `test.beforeEach(async ({ page }) => {`,
      `  await page.goto("/");`,
      `});`,
    ].join("\n");
    expect(describeTestSteps(source).tests[0].steps).toEqual([
      { kind: "group", text: "Before each test", line: 5, depth: 0 },
      { kind: "navigation", text: `Go to "/".`, line: 6, depth: 1 },
      { kind: "action", text: `Click the "Go" button.`, line: 3, depth: 0 },
    ]);
  });

  it("falls back to the raw source for statements it can't describe", () => {
    const result = describeTestSteps(
      spec(
        `await page.goto("/");`,
        `await page.evaluate(() => {`,
        `  window.scrollTo(0, 0);`,
        `});`,
        `await page.getByRole("button", { name: "Top" }).click();`,
      ),
    );
    expect(result.tests[0].steps).toEqual([
      { kind: "navigation", text: `Go to "/".`, line: 4, depth: 0 },
      {
        kind: "raw",
        text: `await page.evaluate(() => { window.scrollTo(0, 0); });`,
        line: 5,
        depth: 0,
      },
      { kind: "action", text: `Click the "Top" button.`, line: 8, depth: 0 },
    ]);
  });

  it("keeps dynamic values readable instead of dropping them", () => {
    expect(
      steps(
        spec(
          "await page.goto(`/users/${id}`);",
          `await page.getByLabel("Email").fill(user.email);`,
        ),
      ),
    ).toEqual([
      'Go to "/users/${id}".',
      'Fill the "Email" field with `user.email`.',
    ]);
  });

  it("names calls to the app's own fixture helpers", () => {
    const source = [
      `import { test, expect } from "@playwright/test";`,
      `import { signIn } from "./fixtures/test-user";`,
      `test("a test", async ({ page }) => {`,
      `  await signIn(page);`,
      `});`,
    ].join("\n");
    expect(describeTestSteps(source).tests[0].steps.map((s) => s.text)).toEqual(
      [`Run the "signIn" helper.`],
    );
  });

  it("reports the same titles and lines as parseTestCases", () => {
    const source = [
      `import { test, expect } from "@playwright/test";`, // 1
      ``, // 2
      `test("logs in", async ({ page }) => {`, // 3
      `  await page.goto("/");`, // 4
      `});`, // 5
      ``, // 6
      `test.describe("checkout", () => {`, // 7
      `  test.only("pays", async ({ page }) => {`, // 8
      `    await page.goto("/pay");`, // 9
      `  });`, // 10
      `});`, // 11
      ``, // 12
      `it("aliases", async ({ page }) => {});`, // 13
    ].join("\n");
    const described = describeTestSteps(source).tests.map(
      ({ title, line }) => ({
        title,
        line,
      }),
    );
    // `test.describe` itself is never listed as a runnable test by either parser.
    expect(described).toEqual(parseTestCases(source));
    expect(described).toEqual([
      { title: "logs in", line: 3 },
      { title: "pays", line: 8 },
      { title: "aliases", line: 13 },
    ]);
  });

  it("returns a parseError instead of throwing on a broken file", () => {
    const result = describeTestSteps(`test("broken", async ({ page ) => {`);
    expect(result.tests).toEqual([]);
    expect(result.parseError).toBeTruthy();
  });

  it("caps very long tests and flags them as truncated", () => {
    const body = Array.from(
      { length: 250 },
      () => `await page.getByRole("button", { name: "Go" }).click();`,
    );
    const test = describeTestSteps(spec(...body)).tests[0];
    expect(test.steps).toHaveLength(200);
    expect(test.truncated).toBe(true);
  });

  it("describes a test with no recognizable steps as empty, not broken", () => {
    const result = describeTestSteps(
      `import { test } from "@playwright/test";\ntest("empty", async () => {});\n`,
    );
    expect(result.parseError).toBeUndefined();
    expect(result.tests).toEqual([
      { title: "empty", line: 2, steps: [], truncated: false },
    ]);
  });
});
