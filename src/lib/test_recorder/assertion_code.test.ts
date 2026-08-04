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

  it("accepts regex arguments", () => {
    // Rejecting these silently dropped a perfectly good assertion from the
    // spec: the delimiters and parens inside a regex aren't syntax.
    expect(
      isSingleAssertionStatement(`await expect(page).toHaveURL(/\\/items/);`),
    ).toBe(true);
    expect(
      isSingleAssertionStatement(
        `await expect(page.getByText(/\\(\\d+\\)/)).toBeVisible();`,
      ),
    ).toBe(true);
    expect(
      isSingleAssertionStatement(`await expect(page).toHaveURL(/[^/]+$/i);`),
    ).toBe(true);
    // An unterminated literal is still nonsense.
    expect(
      isSingleAssertionStatement(`await expect(page).toHaveURL(/items);`),
    ).toBe(false);
    // `//` is a comment wherever it appears — an empty regex literal isn't
    // valid JavaScript, so this must not be read as one.
    expect(isSingleAssertionStatement(`await expect(a).toHaveText(//);`)).toBe(
      false,
    );
    expect(
      isSingleAssertionStatement(`await expect(a).toHaveText(/* x */ "b");`),
    ).toBe(false);
  });

  it("reads a slash after a postfix operator as division, not a regex", () => {
    // `+`/`-` open an expression, so a `/` after them is a regex — but doubled
    // they are a postfix increment, which makes the slash division. Reading it
    // as an unterminated regex would drop the assertion from the spec.
    expect(
      isSingleAssertionStatement(`await expect(a++ / 2).toBeGreaterThan(1);`),
    ).toBe(true);
    expect(
      isSingleAssertionStatement(`await expect(a-- / 2).toBeGreaterThan(1);`),
    ).toBe(true);
    // Still a regex when the operator really is unary.
    expect(
      isSingleAssertionStatement(`await expect(page).toHaveURL(-/x/ ? 1 : 2);`),
    ).toBe(true);
  });

  it("rejects anything chained after the matcher call", () => {
    // `.catch` swallows the failure the assertion exists to report, leaving a
    // test that passes without ever checking its condition.
    expect(
      isSingleAssertionStatement(
        `await expect(a).toBeVisible().catch(() => {});`,
      ),
    ).toBe(false);
    expect(
      isSingleAssertionStatement(
        `await expect(a).toBeVisible().then(() => steal(document.cookie));`,
      ),
    ).toBe(false);
  });
});
