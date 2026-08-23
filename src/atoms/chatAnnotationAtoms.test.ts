import { describe, expect, it } from "vitest";
import {
  addChatAnnotation,
  clearChatAnnotations,
  pruneChatAnnotations,
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

  it("normalizes comment whitespace on both the add and update paths", () => {
    const added = addChatAnnotation(new Map(), {
      ...annotation,
      comment: "  Change this  ",
    });
    const updated = updateChatAnnotation(
      added,
      annotation.chatId,
      annotation.id,
      "  Change this  ",
    );

    expect(added.get(7)?.[0].comment).toBe("Change this");
    expect(updated.get(7)?.[0].comment).toBe("Change this");
  });

  it("prunes annotations whose message was retried away", () => {
    const annotations = addChatAnnotation(
      addChatAnnotation(new Map(), annotation),
      { ...annotation, id: "annotation-2", messageId: 12 },
    );

    const pruned = pruneChatAnnotations(annotations, 7, new Set([11]));

    expect(pruned.get(7)?.map((item) => item.id)).toEqual(["annotation-1"]);
    // Nothing to prune returns the same map so Jotai skips the re-render.
    expect(pruneChatAnnotations(pruned, 7, new Set([11]))).toBe(pruned);
    expect(pruneChatAnnotations(pruned, 7, new Set<number>()).has(7)).toBe(
      false,
    );
  });
});
