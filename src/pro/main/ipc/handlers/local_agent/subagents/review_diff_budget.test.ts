import { describe, expect, it } from "vitest";
import { boundReviewDiff, MAX_REVIEW_DIFF_CHARS } from "./review_diff_budget";

function fileSection(path: string, bodyLines: number): string {
  const body = Array.from(
    { length: bodyLines },
    (_, index) => `+line ${index} of ${path}`,
  ).join("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,5 @@",
    body,
  ].join("\n");
}

describe("boundReviewDiff", () => {
  it("leaves a diff that fits untouched", () => {
    const diff = fileSection("src/a.ts", 2);
    const bounded = boundReviewDiff(diff, 10_000);
    expect(bounded.text).toBe(diff);
    expect(bounded.omittedFiles).toEqual([]);
    expect(bounded.includedFiles).toEqual(["src/a.ts"]);
  });

  it("keeps whole files while the budget lasts", () => {
    const first = fileSection("src/a.ts", 2);
    const second = fileSection("src/b.ts", 2);
    const diff = `${first}\n${second}`;
    const bounded = boundReviewDiff(diff, first.length + 10);
    expect(bounded.text).toContain("src/a.ts");
    // The omitted file is named in the note, but its diff body is not present.
    expect(bounded.text).not.toContain("+line 0 of src/b.ts");
    expect(bounded.includedFiles).toEqual(["src/a.ts"]);
    expect(bounded.omittedFiles).toEqual(["src/b.ts"]);
  });

  it("names the omitted files instead of silently dropping them", () => {
    const first = fileSection("src/a.ts", 2);
    const second = fileSection("src/b.ts", 2);
    const third = fileSection("src/c.ts", 2);
    const diff = `${first}\n${second}\n${third}`;
    const bounded = boundReviewDiff(diff, first.length + 10);
    expect(bounded.text).toContain("were omitted");
    expect(bounded.text).toContain("src/b.ts");
    expect(bounded.text).toContain("src/c.ts");
  });

  it("still shows a truncated first file when nothing fits", () => {
    const diff = fileSection("src/a.ts", 400);
    const bounded = boundReviewDiff(diff, 500);
    expect(bounded.text.length).toBeLessThanOrEqual(500);
    expect(bounded.text).toContain("truncated to fit the review budget");
    expect(bounded.includedFiles).toEqual(["src/a.ts"]);
  });

  it("defaults to the shared review budget", () => {
    const diff = fileSection("src/a.ts", 2);
    const bounded = boundReviewDiff(diff);
    expect(bounded.text).toBe(diff);
    expect(MAX_REVIEW_DIFF_CHARS).toBeGreaterThan(0);
  });

  it("treats a diff without headers as a single section", () => {
    const diff = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join("\n");
    const bounded = boundReviewDiff(diff, 100);
    expect(bounded.text.length).toBeLessThanOrEqual(100);
    expect(bounded.includedFiles).toEqual([]);
  });
});
