import { describe, expect, it } from "vitest";
import {
  addChatAnnotation,
  clearChatAnnotations,
  hasOverlappingChatAnnotation,
  removeChatAnnotation,
  updateChatAnnotation,
  type ChatAnnotation,
} from "./chatAnnotationAtoms";

const annotation: ChatAnnotation = {
  id: "annotation-1",
  chatId: 7,
  messageId: 11,
  selectedText: "selected text",
  comment: "Change this",
  createdAt: 1,
  startOffset: 10,
  selectionLength: 13,
};

describe("chat annotation state", () => {
  it("adds, updates, and removes annotations without mutating prior maps", () => {
    const initial = new Map();
    const added = addChatAnnotation(initial, annotation);
    const updated = updateChatAnnotation(
      added,
      annotation.chatId,
      annotation.id,
      "  Explain this  ",
    );
    const removed = removeChatAnnotation(
      updated,
      annotation.chatId,
      annotation.id,
    );

    expect(initial.size).toBe(0);
    expect(added.get(7)?.[0].comment).toBe("Change this");
    expect(updated.get(7)?.[0].comment).toBe("Explain this");
    expect(removed.has(7)).toBe(false);
  });

  it("clears only the requested chat", () => {
    const annotations = addChatAnnotation(
      addChatAnnotation(new Map(), annotation),
      { ...annotation, id: "annotation-2", chatId: 8 },
    );

    const cleared = clearChatAnnotations(annotations, 7);

    expect(cleared.has(7)).toBe(false);
    expect(cleared.get(8)).toHaveLength(1);
  });

  it("detects overlapping ranges but permits adjacent ranges", () => {
    expect(hasOverlappingChatAnnotation([annotation], 20, 5)).toBe(true);
    expect(hasOverlappingChatAnnotation([annotation], 23, 5)).toBe(false);
  });
});
