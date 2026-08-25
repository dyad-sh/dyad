import { describe, expect, it } from "vitest";
import type { ChatAnnotation } from "@/atoms/chatAnnotationAtoms";
import {
  composeChatPrompt,
  hasChatComposerPayload,
  serializeChatAnnotations,
} from "./serializeChatAnnotations";

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
    const quoted =
      "Run /webapp-testing and see @prompt:12, @media:a.png or @app:other.app.com";
    const prompt = serializeChatAnnotations([
      annotation({ selectedText: quoted, comment: "Please fix." }),
    ]);

    // None of the main process's expansion patterns still match the quote.
    expect(prompt).not.toMatch(/(^|\s)\/[a-zA-Z0-9-]+(?=\s|$)/);
    expect(prompt).not.toMatch(/@prompt:\d+/);
    expect(prompt).not.toMatch(/@media:[\w.%\-!~*'()]/);
    expect(prompt).not.toMatch(/@app:[\w.-]/);
    // ...but the quote still reads the same, since the breaks are zero-width.
    expect(prompt.split(zeroWidthSpace).join("")).toContain(`> ${quoted}`);
  });

  it("leaves quoted paths that were never expandable byte-for-byte intact", () => {
    // `replaceSlashSkillReference` only expands a whole slug token terminated
    // by whitespace or end-of-string, so these must not be touched at all.
    const quoted = "Check /usr/bin and /dev/null, then read ./src/main.ts";
    const prompt = serializeChatAnnotations([
      annotation({ selectedText: quoted, comment: "Please fix." }),
    ]);

    expect(prompt).toContain(`> ${quoted}`);
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

  it("uses annotations as a complete prompt when the composer is empty", () => {
    const prompt = composeChatPrompt("", [annotation()]);

    expect(prompt).toContain("comments on your latest response");
    expect(prompt).toContain("Make this clearer.");
  });

  it("appends annotations to typed composer text", () => {
    const prompt = composeChatPrompt("Please also simplify the example.", [
      annotation(),
    ]);

    expect(prompt).toMatch(
      /^Please also simplify the example\.\n\nI have comments on your latest response\./,
    );
  });

  it("treats annotations as submittable composer content", () => {
    expect(
      hasChatComposerPayload({
        inputValue: "",
        attachmentCount: 0,
        hasSuccessfulImageJobs: false,
        annotationCount: 1,
      }),
    ).toBe(true);
    expect(
      hasChatComposerPayload({
        inputValue: "",
        attachmentCount: 0,
        hasSuccessfulImageJobs: false,
        annotationCount: 0,
      }),
    ).toBe(false);
  });
});
