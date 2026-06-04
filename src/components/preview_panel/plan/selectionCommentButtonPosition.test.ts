import { describe, expect, it } from "vitest";
import { getSelectionCommentAnchorRect } from "@/components/preview_panel/plan/selectionCommentButtonPosition";

describe("getSelectionCommentAnchorRect", () => {
  it("anchors multi-line selections to the last client rect", () => {
    const firstRect = new DOMRect(10, 20, 100, 18);
    const lastRect = new DOMRect(12, 44, 60, 18);
    const fallbackRect = new DOMRect(10, 20, 140, 42);
    const range = {
      getClientRects: () =>
        [firstRect, lastRect] as unknown as DOMRectList | DOMRect[],
      getBoundingClientRect: () => fallbackRect,
    };

    expect(getSelectionCommentAnchorRect(range)).toBe(lastRect);
  });

  it("falls back to the bounding rect when client rects are empty", () => {
    const fallbackRect = new DOMRect(8, 16, 120, 32);
    const range = {
      getClientRects: () => [] as unknown as DOMRectList | DOMRect[],
      getBoundingClientRect: () => fallbackRect,
    };

    expect(getSelectionCommentAnchorRect(range)).toBe(fallbackRect);
  });
});
