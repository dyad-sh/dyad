import { describe, it, expect } from "vitest";
import {
  isCancelledResponseContent,
  appendCancelledResponseNotice,
  stripCancelledResponseNotice,
  applyCancellationNoticeToLastAssistantMessage,
  filterCancelledMessagePairs,
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

  describe("filterCancelledMessagePairs", () => {
    it("should filter out cancelled assistant messages", () => {
      const messages = [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: "Hi\n\n[Response cancelled by user]",
        },
        { role: "user", content: "Try again" },
        { role: "assistant", content: "Hello!" },
      ];
      const result = filterCancelledMessagePairs(messages);
      expect(result).toEqual([
        { role: "user", content: "Try again" },
        { role: "assistant", content: "Hello!" },
      ]);
    });

    it("should filter the preceding user message of a cancelled response", () => {
      const messages = [
        { role: "user", content: "First question" },
        {
          role: "assistant",
          content: "[Response cancelled by user]",
        },
      ];
      const result = filterCancelledMessagePairs(messages);
      expect(result).toEqual([]);
    });

    it("should not filter non-cancelled messages", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const result = filterCancelledMessagePairs(messages);
      expect(result).toEqual(messages);
    });

    it("should handle empty array", () => {
      expect(filterCancelledMessagePairs([])).toEqual([]);
    });

    it("should handle multiple cancelled pairs", () => {
      const messages = [
        { role: "user", content: "Q1" },
        {
          role: "assistant",
          content: "A1\n\n[Response cancelled by user]",
        },
        { role: "user", content: "Q2" },
        {
          role: "assistant",
          content: "[Response cancelled by user]",
        },
        { role: "user", content: "Q3" },
        { role: "assistant", content: "A3" },
      ];
      const result = filterCancelledMessagePairs(messages);
      expect(result).toEqual([
        { role: "user", content: "Q3" },
        { role: "assistant", content: "A3" },
      ]);
    });
  });
});
