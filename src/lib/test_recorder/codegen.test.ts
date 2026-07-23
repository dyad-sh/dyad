import { describe, expect, it } from "vitest";

import { generateSpecSource, locatorToCode } from "./codegen";
import type { RecordedAction } from "./types";

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
      generateSpecSource(actions, { testName: "my flow", includeSignIn: true }),
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

  it("omits the sign-in fixture when includeSignIn is false", () => {
    const source = generateSpecSource(actions, {
      testName: "anon",
      includeSignIn: false,
    });
    expect(source).not.toContain("signIn");
    expect(source).not.toContain("./fixtures/test-user");
    expect(source).toContain(`await page.goto("/");`);
  });

  it("emits an array argument for multi-value selects", () => {
    const source = generateSpecSource(
      [
        {
          kind: "select",
          locator: { kind: "testid", value: "tags" },
          values: ["a", "b"],
        },
      ],
      { testName: "multi", includeSignIn: false },
    );
    expect(source).toContain(`.selectOption(["a", "b"]);`);
  });

  it("escapes special characters in recorded values", () => {
    const source = generateSpecSource(
      [
        {
          kind: "fill",
          locator: { kind: "placeholder", value: "Bio" },
          value: 'he said "hi"\nbye',
        },
      ],
      { testName: 'weird "name"', includeSignIn: false },
    );
    expect(source).toContain(`.fill("he said \\"hi\\"\\nbye");`);
    expect(source).toContain(`test("weird \\"name\\"",`);
  });
});
