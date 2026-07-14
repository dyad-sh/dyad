import { describe, expect, it } from "vitest";
import { computeVisibleTabs } from "./PreviewToolbar";

const ORDER = ["a", "b", "c", "d", "e", "f"] as const;
const WIDTHS = { a: 100, b: 100, c: 100, d: 100, e: 100, f: 100 };
const GAP = 4;
const OVERFLOW = 28;

const compute = (availableWidth: number, active: string | null = "a") =>
  computeVisibleTabs({
    order: ORDER,
    active,
    widths: WIDTHS,
    availableWidth,
    gap: GAP,
    overflowWidth: OVERFLOW,
  });

describe("computeVisibleTabs", () => {
  it("shows all tabs when they fit", () => {
    // 6 * 100 + 5 * 4 = 620
    expect(compute(620)).toEqual({ visible: [...ORDER], hidden: [] });
  });

  it("collapses trailing tabs into overflow when space runs out", () => {
    // budget = 400 - 28 - 4 = 368 → fits a, b, c (308)
    expect(compute(400, "a")).toEqual({
      visible: ["a", "b", "c"],
      hidden: ["d", "e", "f"],
    });
  });

  it("swaps an overflowed active tab into the last visible slot", () => {
    expect(compute(400, "f")).toEqual({
      visible: ["a", "b", "f"],
      hidden: ["c", "d", "e"],
    });
  });

  it("keeps a visible active tab in its canonical position", () => {
    expect(compute(400, "b")).toEqual({
      visible: ["a", "b", "c"],
      hidden: ["d", "e", "f"],
    });
  });

  it("always shows the active tab even when nothing else fits", () => {
    expect(compute(100, "f")).toEqual({
      visible: ["f"],
      hidden: ["a", "b", "c", "d", "e"],
    });
  });

  it("ignores an active mode that is not in the tab order", () => {
    expect(compute(400, null)).toEqual({
      visible: ["a", "b", "c"],
      hidden: ["d", "e", "f"],
    });
  });
});
