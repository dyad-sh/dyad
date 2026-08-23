import { describe, expect, it } from "vitest";
import type { ChatAnnotation } from "@/atoms/chatAnnotationAtoms";
import { serializeChatAnnotations } from "./serializeChatAnnotations";

function annotation(overrides: Partial<ChatAnnotation> = {}): ChatAnnotation {
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

  it("keeps chat syntax inside the quoted assistant text inert", () => {
    const zeroWidthSpace = String.fromCharCode(0x200b);
    const quoted = "Run /webapp-testing and see @prompt:12 or @media:a.png";
    const prompt = serializeChatAnnotations([
      annotation({ selectedText: quoted, comment: "Please fix." }),
    ]);

    // None of the main process's expansion patterns still match the quote.
    expect(prompt).not.toMatch(/(^|\s)\/[a-zA-Z0-9-]+(?=\s|$)/);
    expect(prompt).not.toMatch(/@prompt:\d+/);
    expect(prompt).not.toMatch(/@media:[\w.%\-!~*'()]/);
    // ...but the quote still reads the same, since the breaks are zero-width.
    expect(prompt.split(zeroWidthSpace).join("")).toContain(`> ${quoted}`);
  });

  it("leaves the user's own comment text untouched", () => {
    const prompt = serializeChatAnnotations([
      annotation({
        selectedText: "plain text",
        comment: "Use /webapp-testing on this.",
      }),
    ]);

    expect(prompt).toContain("Use /webapp-testing on this.");
  });
});
