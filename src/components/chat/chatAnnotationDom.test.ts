import { beforeEach, describe, expect, it } from "vitest";
import type { ChatAnnotation } from "@/atoms/chatAnnotationAtoms";
import {
  applyChatAnnotationHighlights,
  clearChatAnnotationHighlights,
  findOverlappingChatAnnotation,
  getChatSelectionSnapshot,
} from "@/components/chat/chatAnnotationDom";

function createAnnotation(overrides: Partial<ChatAnnotation>): ChatAnnotation {
  return {
    id: "annotation-1",
    chatId: 1,
    messageId: 2,
    selectedText: "",
    comment: "comment",
    createdAt: 1,
    startOffset: 0,
    selectionLength: 0,
    ...overrides,
  };
}

function renderContainer(html: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function marks(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>("mark[data-chat-annotation-id]"),
  ];
}

describe("chatAnnotationDom", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("computes offsets across inline markup", () => {
    const container = renderContainer(
      "<p>Hello <strong>bold</strong> world</p>",
    );
    const boldText = container.querySelector("strong")!.firstChild!;
    const trailingText = container.querySelector("p")!.lastChild!;

    const range = document.createRange();
    range.setStart(boldText, 0);
    range.setEnd(trailingText, 6);

    expect(getChatSelectionSnapshot(container, range)).toEqual({
      selectedText: "bold world",
      startOffset: 6,
      selectionLength: 10,
    });
  });

  it("trims leading and trailing whitespace out of the saved offsets", () => {
    const container = renderContainer("<p>  Hello world  </p>");
    const textNode = container.querySelector("p")!.firstChild!;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, textNode.textContent!.length);

    expect(getChatSelectionSnapshot(container, range)).toEqual({
      selectedText: "Hello world",
      startOffset: 2,
      selectionLength: 11,
    });
  });

  it("keeps chat and plan UI chrome out of the offset space", () => {
    const container = renderContainer(
      "<p>Intro</p>" +
        "<div data-plan-annotation-ignore>Copy</div>" +
        "<div data-annotation-ignore>Thought</div>" +
        "<p>Hello world</p>",
    );
    const textNode = container.querySelectorAll("p")[1]!.firstChild!;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    expect(getChatSelectionSnapshot(container, range)).toEqual({
      selectedText: "Hello",
      startOffset: 5,
      selectionLength: 5,
    });
  });

  it("applies one mark per text node a selection spans", () => {
    const container = renderContainer(
      "<p>Hello <strong>bold</strong> world</p>",
    );

    applyChatAnnotationHighlights(container, [
      createAnnotation({
        selectedText: "bold world",
        startOffset: 6,
        selectionLength: 10,
      }),
    ]);

    const applied = marks(container);
    expect(applied).toHaveLength(2);
    expect(applied.map((mark) => mark.textContent).join("")).toBe("bold world");
    expect(applied[0].getAttribute("role")).toBe("button");
    expect(applied[0].getAttribute("tabindex")).toBe("0");
    // Continuation fragments hold real message text, so they must stay in the
    // accessibility tree.
    expect(applied[1].getAttribute("aria-hidden")).toBeNull();
    expect(applied[1].getAttribute("tabindex")).toBe("-1");
  });

  it("uses the supplied label for the accessible name", () => {
    const container = renderContainer("<p>Hello world</p>");

    applyChatAnnotationHighlights(
      container,
      [
        createAnnotation({
          selectedText: "Hello",
          startOffset: 0,
          selectionLength: 5,
        }),
      ],
      (text) => `Ver comentario sobre ${text}`,
    );

    expect(marks(container)[0].getAttribute("aria-label")).toBe(
      "Ver comentario sobre Hello",
    );
  });

  it("round-trips clear and re-apply without corrupting the text", () => {
    const container = renderContainer(
      "<p>Hello <strong>bold</strong> world</p>",
    );
    const annotation = createAnnotation({
      selectedText: "bold world",
      startOffset: 6,
      selectionLength: 10,
    });

    for (let cycle = 0; cycle < 3; cycle++) {
      clearChatAnnotationHighlights(container);
      applyChatAnnotationHighlights(container, [annotation]);
      expect(container.textContent).toBe("Hello bold world");
      expect(
        marks(container)
          .map((mark) => mark.textContent)
          .join(""),
      ).toBe("bold world");
    }

    clearChatAnnotationHighlights(container);
    expect(marks(container)).toHaveLength(0);
    expect(container.textContent).toBe("Hello bold world");
  });

  it("returns the colliding annotation for an overlapping range, but not an adjacent one", () => {
    const existing = createAnnotation({
      selectedText: "selected text",
      startOffset: 10,
      selectionLength: 13,
    });

    expect(findOverlappingChatAnnotation([existing], 20, 5)).toBe(existing);
    expect(findOverlappingChatAnnotation([existing], 23, 5)).toBeUndefined();
  });

  it("skips stale and overlapping annotations instead of corrupting the DOM", () => {
    const container = renderContainer("<p>Hello brave new world</p>");

    applyChatAnnotationHighlights(container, [
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

    const applied = marks(container);
    expect(applied).toHaveLength(1);
    expect(applied[0].getAttribute("data-chat-annotation-id")).toBe("valid");
    expect(applied[0].textContent).toBe("brave");
  });
});
