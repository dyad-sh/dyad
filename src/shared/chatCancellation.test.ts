import { describe, it, expect } from "vitest";
import {
  isCancelledResponseContent,
  appendCancelledResponseNotice,
  stripCancelledResponseNotice,
  applyCancellationNoticeToLastAssistantMessage,
} from "@/shared/chatCancellation";

describe("chatCancellation", () => {
  describe("isCancelledResponseContent", () => {
    it("should return true for content ending with cancellation notice", () => {
      expect(
        isCancelledResponseContent("Some text\n\n[Response cancelled by user]"),
      ).toBe(true);
    });

    it("should return true for only the cancellation notice", () => {
      expect(isCancelledResponseContent("[Response cancelled by user]")).toBe(
        true,
      );
    });

    it("should return true with trailing whitespace", () => {
      expect(
        isCancelledResponseContent("[Response cancelled by user]   "),
      ).toBe(true);
    });

    it("should return false for empty string", () => {
      expect(isCancelledResponseContent("")).toBe(false);
    });

    it("should return false for regular content", () => {
      expect(isCancelledResponseContent("Hello world")).toBe(false);
    });

    it("should return false for partial match", () => {
      expect(isCancelledResponseContent("[Response cancelled")).toBe(false);
    });
  });

  describe("appendCancelledResponseNotice", () => {
    it("closes an unclosed suggestions tag before the notice", () => {
      expect(
        appendCancelledResponseNotice(
          "Done.\n<dyad-suggested-prompts>\nAdd a dark",
        ),
      ).toBe(
        "Done.\n<dyad-suggested-prompts>\nAdd a dark</dyad-suggested-prompts>\n\n[Response cancelled by user]",
      );
    });

    it("closes an unclosed suggestions tag before a following tool card", () => {
      expect(
        appendCancelledResponseNotice(
          'Done.\n<dyad-suggested-prompts>\nAdd\n<dyad-write path="a">x</dyad-write>',
        ),
      ).toBe(
        'Done.\n<dyad-suggested-prompts>\nAdd\n</dyad-suggested-prompts><dyad-write path="a">x</dyad-write>\n\n[Response cancelled by user]',
      );
    });

    it("closes an unclosed suggestions tag that has attributes", () => {
      expect(
        appendCancelledResponseNotice(
          'Done.\n<dyad-suggested-prompts foo="x">\nAdd',
        ),
      ).toBe(
        'Done.\n<dyad-suggested-prompts foo="x">\nAdd</dyad-suggested-prompts>\n\n[Response cancelled by user]',
      );
    });

    it("leaves a closed suggestions block and an existing notice alone", () => {
      const closed =
        "Done.\n<dyad-suggested-prompts>\nAdd a dark mode toggle\n</dyad-suggested-prompts>";
      expect(appendCancelledResponseNotice(closed)).toBe(
        `${closed}\n\n[Response cancelled by user]`,
      );
      const alreadyCancelled =
        "Done.\n<dyad-suggested-prompts>\nAdd\n\n[Response cancelled by user]";
      expect(appendCancelledResponseNotice(alreadyCancelled)).toBe(
        alreadyCancelled,
      );
    });

    it("should append notice to content", () => {
      expect(appendCancelledResponseNotice("Some text")).toBe(
        "Some text\n\n[Response cancelled by user]",
      );
    });

    it("should return just the notice for empty string", () => {
      expect(appendCancelledResponseNotice("")).toBe(
        "[Response cancelled by user]",
      );
    });

    it("should be idempotent - calling twice returns same result", () => {
      const once = appendCancelledResponseNotice("Some text");
      const twice = appendCancelledResponseNotice(once);
      expect(twice).toBe(once);
    });

    it("should trim trailing whitespace before appending", () => {
      expect(appendCancelledResponseNotice("Some text   ")).toBe(
        "Some text\n\n[Response cancelled by user]",
      );
    });

    it("should return just the notice for whitespace-only string", () => {
      expect(appendCancelledResponseNotice("   ")).toBe(
        "[Response cancelled by user]",
      );
    });
  });

  describe("stripCancelledResponseNotice", () => {
    it("should strip the notice from content", () => {
      expect(
        stripCancelledResponseNotice(
          "Some text\n\n[Response cancelled by user]",
        ),
      ).toBe("Some text");
    });

    it("should return empty string when content is only the notice", () => {
      expect(stripCancelledResponseNotice("[Response cancelled by user]")).toBe(
        "",
      );
    });

    it("should return original content when no notice present", () => {
      expect(stripCancelledResponseNotice("Hello world")).toBe("Hello world");
    });

    it("should handle trailing whitespace after notice", () => {
      expect(
        stripCancelledResponseNotice(
          "Some text\n\n[Response cancelled by user]   ",
        ),
      ).toBe("Some text");
    });

    it("should return empty string for empty input", () => {
      expect(stripCancelledResponseNotice("")).toBe("");
    });

    it("should roundtrip with appendCancelledResponseNotice", () => {
      const original = "Hello world";
      const withNotice = appendCancelledResponseNotice(original);
      const stripped = stripCancelledResponseNotice(withNotice);
      expect(stripped).toBe(original);
    });
  });

  describe("applyCancellationNoticeToLastAssistantMessage", () => {
    it("should add notice to last assistant message", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const result = applyCancellationNoticeToLastAssistantMessage(messages);
      expect(result[1].content).toBe(
        "Hi there\n\n[Response cancelled by user]",
      );
    });

    it("should not modify original array", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      applyCancellationNoticeToLastAssistantMessage(messages);
      expect(messages[1].content).toBe("Hi there");
    });

    it("should return same array when no assistant messages", () => {
      const messages = [{ role: "user", content: "Hello" }];
      const result = applyCancellationNoticeToLastAssistantMessage(messages);
      expect(result).toBe(messages);
    });

    it("should return same array when already cancelled", () => {
      const messages = [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: "Hi\n\n[Response cancelled by user]",
        },
      ];
      const result = applyCancellationNoticeToLastAssistantMessage(messages);
      expect(result).toBe(messages);
    });

    it("should handle empty messages array", () => {
      const result = applyCancellationNoticeToLastAssistantMessage([]);
      expect(result).toEqual([]);
    });
  });
});
