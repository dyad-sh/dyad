import { describe, expect, it } from "vitest";

import { isSingleAssertionStatement } from "./assertion_code";

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

  it("accepts a locator string that looks like a comment", () => {
    expect(
      isSingleAssertionStatement(
        `await expect(page.getByText("http://x")).toBeVisible();`,
      ),
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
