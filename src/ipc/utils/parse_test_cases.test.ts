import { describe, expect, it } from "vitest";
import { parseTestCases } from "./parse_test_cases";

describe("parseTestCases", () => {
  it("extracts test titles with 1-based line numbers", () => {
    const src = [
      `import { test, expect } from "@playwright/test";`, // 1
      ``, // 2
      `test("logs in", async ({ page }) => {`, // 3
      `  await page.goto("/");`, // 4
      `});`, // 5
      ``, // 6
      `test('signs up', async ({ page }) => {});`, // 7
    ].join("\n");
    expect(parseTestCases(src)).toEqual([
      { title: "logs in", line: 3 },
      { title: "signs up", line: 7 },
    ]);
  });

  it("supports test modifiers and the it() alias", () => {
    const src = [
      `test.only("focused", async () => {});`, // 1
      `test.skip("skipped", async () => {});`, // 2
      `it("alias", async () => {});`, // 3
    ].join("\n");
    expect(parseTestCases(src)).toEqual([
      { title: "focused", line: 1 },
      { title: "skipped", line: 2 },
      { title: "alias", line: 3 },
    ]);
  });

  it("extracts multiple test calls on the same line", () => {
    const src = `test("first", async () => {}); test("second", async () => {});`;
    expect(parseTestCases(src)).toEqual([
      { title: "first", line: 1 },
      { title: "second", line: 1 },
    ]);
  });

  it("ignores describe blocks and expect calls", () => {
    const src = [
      `test.describe("a group", () => {`, // 1
      `  test("inside", async () => {`, // 2
      `    expect(true).toBe(true);`, // 3
      `  });`, // 4
      `});`, // 5
    ].join("\n");
    expect(parseTestCases(src)).toEqual([{ title: "inside", line: 2 }]);
  });

  it("does not match identifiers that merely end in 'test'", () => {
    const src = `myTest("nope", () => {});\nlatest("nope", () => {});`;
    expect(parseTestCases(src)).toEqual([]);
  });

  it("unescapes quotes in titles", () => {
    const src = `test("it's \\"quoted\\"", async () => {});`;
    expect(parseTestCases(src)).toEqual([{ title: `it's "quoted"`, line: 1 }]);
  });

  it("ignores tests inside comments", () => {
    const src = [
      `/*`, // 1
      `test("inside a block comment", () => {});`, // 2
      `*/`, // 3
      `doThing(); // test("inline comment")`, // 4
      `test("real", () => {});`, // 5
      `/* test("one-line block") */ test("after block", () => {});`, // 6
    ].join("\n");
    expect(parseTestCases(src)).toEqual([
      { title: "real", line: 5 },
      { title: "after block", line: 6 },
    ]);
  });
});
