import { describe, expect, it } from "vitest";
import type { ChatAnnotation } from "@/atoms/chatAnnotationAtoms";
import { serializeChatAnnotations } from "./serializeChatAnnotations";

function annotation(
  overrides: Partial<ChatAnnotation> = {},
): ChatAnnotation {
  return {
    id: "one",
    chatId: 1,
    messageId: 10,
    selectedText: "first line\nsecond line",
    comment: "Make this clearer.",
    createdAt: 1,
    startOffset: 0,
    selectionLength: 22,
    ...overrides,
  };
}

describe("serializeChatAnnotations", () => {
  it("orders annotations and preserves multiline selections as blockquotes", () => {
    const prompt = serializeChatAnnotations([
      annotation({ id: "two", messageId: 20, createdAt: 2 }),
      annotation(),
    ]);

    expect(prompt).toContain("Address every comment below");
    expect(prompt).toContain("> first line\n> second line");
    expect(prompt.indexOf("message 10")).toBeLessThan(
      prompt.indexOf("message 20"),
    );
    expect(prompt).toContain("Make this clearer.");
  });
});
