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
      isSingleAssertionStatement(
        `await expect(page.getByText("x")).not.toBeVisible();`,
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

  it("rejects an un-awaited assertion", () => {
    // Playwright's web-first matchers are async: without `await` the test can
    // finish before the assertion ever resolves.
    expect(
      isSingleAssertionStatement(`expect(page.getByText("x")).toBeVisible();`),
    ).toBe(false);
  });

  it("rejects delimiters that balance by count but not by type", () => {
    expect(
      isSingleAssertionStatement(`await expect(page.getByText("x"]).toBe(1);`),
    ).toBe(false);
  });

  it("rejects extra expressions smuggled onto the same statement", () => {
    expect(
      isSingleAssertionStatement(
        `await expect(a).toBeVisible(), fs.rmSync("/tmp/x");`,
      ),
    ).toBe(false);
    expect(
      isSingleAssertionStatement(
        `await expect(a).toBeVisible() || steal(document.cookie);`,
      ),
    ).toBe(false);
    // A bare `expect(...)` with no matcher asserts nothing.
    expect(isSingleAssertionStatement(`await expect(a);`)).toBe(false);
  });
});
