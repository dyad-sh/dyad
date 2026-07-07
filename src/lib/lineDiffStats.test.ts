import { describe, expect, it } from "vitest";
import { computeLineDiffStats } from "./lineDiffStats";

describe("computeLineDiffStats", () => {
  it("returns zeros for identical content", () => {
    expect(computeLineDiffStats("a\nb\nc", "a\nb\nc")).toEqual({
      additions: 0,
      deletions: 0,
    });
  });

  it("counts every line as an addition for a new (empty old) file", () => {
    expect(computeLineDiffStats("", "line1\nline2\nline3")).toEqual({
      additions: 3,
      deletions: 0,
    });
  });

  it("counts every line as a deletion for a removed (empty new) file", () => {
    expect(computeLineDiffStats("line1\nline2", "")).toEqual({
      additions: 0,
      deletions: 2,
    });
  });

  it("ignores a single trailing newline", () => {
    expect(computeLineDiffStats("", "line1\nline2\n")).toEqual({
      additions: 2,
      deletions: 0,
    });
  });

  it("counts a changed line as one deletion and one addition", () => {
    expect(computeLineDiffStats("a\nb\nc", "a\nB\nc")).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it("counts pure insertions without deletions", () => {
    expect(computeLineDiffStats("a\nc", "a\nb\nc")).toEqual({
      additions: 1,
      deletions: 0,
    });
  });

  it("counts pure removals without additions", () => {
    expect(computeLineDiffStats("a\nb\nc", "a\nc")).toEqual({
      additions: 0,
      deletions: 1,
    });
  });

  it("handles mixed additions and deletions", () => {
    // old: a b c d  -> new: a x c e f
    // LCS = a, c (length 2). old unique: b, d (2 del). new unique: x, e, f (3 add).
    expect(computeLineDiffStats("a\nb\nc\nd", "a\nx\nc\ne\nf")).toEqual({
      additions: 3,
      deletions: 2,
    });
  });

  it("returns zeros when both sides are empty", () => {
    expect(computeLineDiffStats("", "")).toEqual({
      additions: 0,
      deletions: 0,
    });
  });
});
