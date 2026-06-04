import { beforeEach, describe, expect, it } from "vitest";
import type { PlanAnnotation } from "@/atoms/planAtoms";
import {
  applyPlanAnnotationHighlights,
  clearPlanAnnotationHighlights,
  getPlanSelectionSnapshot,
} from "@/components/preview_panel/plan/planAnnotationDom";

function createAnnotation(overrides: Partial<PlanAnnotation>): PlanAnnotation {
  return {
    id: "annotation-1",
    chatId: 1,
    selectedText: "",
    comment: "comment",
    createdAt: 1,
    startOffset: 0,
    selectionLength: 0,
    ...overrides,
  };
}

describe("planAnnotationDom", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("computes selection offsets from rendered plan text while ignoring plan UI chrome", () => {
    const container = document.createElement("div");
    container.innerHTML =
      "<p>Intro</p><div data-plan-annotation-ignore>Copy</div><p>  Hello world  </p>";
    document.body.appendChild(container);

    const textNode = container.querySelectorAll("p")[1]?.firstChild;
    expect(textNode).not.toBeNull();

    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.setEnd(textNode!, textNode!.textContent?.length ?? 0);

    expect(getPlanSelectionSnapshot(container, range)).toEqual({
      selectedText: "Hello world",
      startOffset: 7,
      selectionLength: 11,
    });
  });

  it("highlights text that spans multiple inline nodes", () => {
    const container = document.createElement("div");
    container.innerHTML = `<p>Hello <strong>bold</strong> world</p>`;
    document.body.appendChild(container);

    applyPlanAnnotationHighlights(container, [
      createAnnotation({
        id: "annotation-1",
        selectedText: "bold world",
        startOffset: 6,
        selectionLength: 10,
      }),
    ]);

    const marks = [
      ...container.querySelectorAll<HTMLElement>(
        'mark[data-annotation-id="annotation-1"]',
      ),
    ];

    expect(marks).toHaveLength(2);
    expect(marks.map((mark) => mark.textContent).join("")).toBe("bold world");
    expect(marks[0]?.getAttribute("role")).toBe("button");
    expect(marks[0]?.getAttribute("tabindex")).toBe("0");
    expect(marks[0]?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(marks[0]?.getAttribute("aria-label")).toBe(
      "View comment for bold world",
    );

    clearPlanAnnotationHighlights(container);
    expect(container.querySelectorAll("mark[data-annotation-id]")).toHaveLength(
      0,
    );
    expect(container.textContent).toBe("Hello bold world");
  });

  it("skips stale or overlapping annotations instead of corrupting the DOM", () => {
    const container = document.createElement("div");
    container.innerHTML = `<p>Hello brave new world</p>`;
    document.body.appendChild(container);

    applyPlanAnnotationHighlights(container, [
      createAnnotation({
        id: "valid",
        selectedText: "brave",
        startOffset: 6,
        selectionLength: 5,
      }),
      createAnnotation({
        id: "stale",
        selectedText: "planet",
        startOffset: 12,
        selectionLength: 6,
      }),
      createAnnotation({
        id: "overlap",
        selectedText: "ave new",
        startOffset: 8,
        selectionLength: 7,
      }),
    ]);

    const marks = [
      ...container.querySelectorAll<HTMLElement>("mark[data-annotation-id]"),
    ];

    expect(marks).toHaveLength(1);
    expect(marks[0]?.getAttribute("data-annotation-id")).toBe("valid");
    expect(marks[0]?.textContent).toBe("brave");
  });
});
