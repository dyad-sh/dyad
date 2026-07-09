import { describe, expect, it } from "vitest";
import { computeLineDiffStats } from "./lineDiffStats";
import {
  DIFF_BINARY_PLACEHOLDER,
  DIFF_TOO_LARGE_PLACEHOLDER,
} from "@/shared/diff_placeholders";

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

  it("counts accurately for a small edit in a large file (prefix/suffix trim)", () => {
    // A 10k-line file where a single line in the middle is changed. Trimming the
    // shared prefix/suffix keeps the diff exact (and fast).
    const lines = Array.from({ length: 10_000 }, (_, i) => `line ${i}`);
    const oldContent = lines.join("\n");
    const changed = [...lines];
    changed[5000] = "CHANGED";
    expect(computeLineDiffStats(oldContent, changed.join("\n"))).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it("returns zeros when either side is a sanitized placeholder", () => {
    // Binary/oversized files are replaced by placeholder strings upstream;
    // diffing those against real content would report meaningless line counts.
    expect(
      computeLineDiffStats(DIFF_BINARY_PLACEHOLDER, "line1\nline2"),
    ).toEqual({ additions: 0, deletions: 0 });
    expect(
      computeLineDiffStats("line1\nline2", DIFF_TOO_LARGE_PLACEHOLDER),
    ).toEqual({ additions: 0, deletions: 0 });
    expect(
      computeLineDiffStats(DIFF_TOO_LARGE_PLACEHOLDER, DIFF_BINARY_PLACEHOLDER),
    ).toEqual({ additions: 0, deletions: 0 });
  });

  it("falls back to worst-case counts for a huge fully-different middle", () => {
    // Every line differs and there is no shared prefix/suffix to trim, so the DP
    // exceeds the size guard and we report a worst-case (all lines changed).
    const oldContent = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join(
      "\n",
    );
    const newContent = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join(
      "\n",
    );
    expect(computeLineDiffStats(oldContent, newContent)).toEqual({
      additions: 3000,
      deletions: 3000,
    });
  });
});
