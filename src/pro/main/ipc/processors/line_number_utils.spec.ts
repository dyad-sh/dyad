import { describe, it, expect } from "vitest";
import {
  addLineNumberPrefixes,
  stripLineNumberPrefixes,
  LINE_NUMBER_REGEX,
} from "./line_number_utils";

describe("line_number_utils", () => {
  describe("LINE_NUMBER_REGEX", () => {
    it("matches single digit line numbers", () => {
      const match = "1| content here".match(LINE_NUMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("1");
      expect(match![2]).toBe("content here");
    });

    it("matches padded single digit line numbers", () => {
      const match = "  1| content here".match(LINE_NUMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("1");
      expect(match![2]).toBe("content here");
    });

    it("matches double digit line numbers", () => {
      const match = " 10| content here".match(LINE_NUMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("10");
      expect(match![2]).toBe("content here");
    });

    it("matches triple digit line numbers", () => {
      const match = "100| content here".match(LINE_NUMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("100");
      expect(match![2]).toBe("content here");
    });

    it("captures empty content after pipe with space", () => {
      const match = "1| ".match(LINE_NUMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("1");
      expect(match![2]).toBe("");
    });

    it("captures empty content after pipe without space", () => {
      const match = "1|".match(LINE_NUMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("1");
      expect(match![2]).toBe("");
    });

    it("matches lines without space after pipe (content present)", () => {
      const match = "1|content".match(LINE_NUMBER_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("1");
      expect(match![2]).toBe("content");
    });

    it("does not match lines without proper format", () => {
      expect("content without line number".match(LINE_NUMBER_REGEX)).toBeNull();
      expect("1: content with colon".match(LINE_NUMBER_REGEX)).toBeNull();
    });
  });

  describe("addLineNumberPrefixes", () => {
    it("returns empty string for empty input", () => {
      expect(addLineNumberPrefixes("")).toBe("");
    });

    it("adds line numbers to single line", () => {
      expect(addLineNumberPrefixes("hello")).toBe("1| hello");
    });

    it("adds line numbers to multiple lines", () => {
      const input = "line one\nline two\nline three";
      const expected = "1| line one\n2| line two\n3| line three";
      expect(addLineNumberPrefixes(input)).toBe(expected);
    });

    it("right-aligns line numbers based on total line count", () => {
      const input = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join(
        "\n",
      );
      const result = addLineNumberPrefixes(input);
      const lines = result.split("\n");

      // First line should have space padding
      expect(lines[0]).toBe(" 1| line 1");
      // Line 10 should have no padding
      expect(lines[9]).toBe("10| line 10");
      // Line 12 should have no padding
      expect(lines[11]).toBe("12| line 12");
    });

    it("handles 100+ lines correctly", () => {
      const input = Array.from({ length: 105 }, (_, i) => `line ${i + 1}`).join(
        "\n",
      );
      const result = addLineNumberPrefixes(input);
      const lines = result.split("\n");

      // First line should have two spaces padding
      expect(lines[0]).toBe("  1| line 1");
      // Line 10 should have one space padding
      expect(lines[9]).toBe(" 10| line 10");
      // Line 100 should have no padding
      expect(lines[99]).toBe("100| line 100");
    });

    it("handles empty lines in content", () => {
      const input = "line one\n\nline three";
      const expected = "1| line one\n2| \n3| line three";
      expect(addLineNumberPrefixes(input)).toBe(expected);
    });

    it("preserves indentation in content", () => {
      const input = "function test() {\n  return 42;\n}";
      const expected = "1| function test() {\n2|   return 42;\n3| }";
      expect(addLineNumberPrefixes(input)).toBe(expected);
    });

    it("handles content with special characters", () => {
      const input = "const x = 1;\nconst y = 'hello | world';";
      const expected = "1| const x = 1;\n2| const y = 'hello | world';";
      expect(addLineNumberPrefixes(input)).toBe(expected);
    });

    it("supports custom start line number", () => {
      const input = "line one\nline two\nline three";
      const expected = "5| line one\n6| line two\n7| line three";
      expect(addLineNumberPrefixes(input, 5)).toBe(expected);
    });

    it("adjusts width based on max line number with custom start", () => {
      const input = "a\nb\nc";
      // Starting at line 98 means max line is 100, so width is 3
      const expected = " 98| a\n 99| b\n100| c";
      expect(addLineNumberPrefixes(input, 98)).toBe(expected);
    });
  });

  describe("stripLineNumberPrefixes", () => {
    it("returns original content with hasLineNumbers false for empty input", () => {
      const result = stripLineNumberPrefixes("");
      expect(result.content).toBe("");
      expect(result.hasLineNumbers).toBe(false);
      expect(result.startLineNumber).toBe(0);
    });

    it("does not strip line numbers from single line (too ambiguous)", () => {
      // Single lines matching the pattern are too ambiguous to confidently strip
      // (e.g., "42| some data" could be actual file content, not a line number prefix)
      const result = stripLineNumberPrefixes("1| hello");
      expect(result.content).toBe("1| hello");
      expect(result.hasLineNumbers).toBe(false);
      expect(result.startLineNumber).toBe(0);
    });

    it("strips line numbers from multiple lines", () => {
      const input = "1| line one\n2| line two\n3| line three";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe("line one\nline two\nline three");
      expect(result.hasLineNumbers).toBe(true);
      expect(result.startLineNumber).toBe(1);
    });

    it("strips padded line numbers", () => {
      // Use sequential line numbers (e.g., 8, 9, 10) with padding
      const input = " 8| line eight\n 9| line nine\n10| line ten";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe("line eight\nline nine\nline ten");
      expect(result.hasLineNumbers).toBe(true);
    });

    it("returns original content when no line numbers present", () => {
      const input = "line one\nline two\nline three";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe(input);
      expect(result.hasLineNumbers).toBe(false);
    });

    it("returns original content when mixed (some lines have numbers, some don't)", () => {
      const input = "1| line one\nline two without number\n3| line three";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe(input);
      expect(result.hasLineNumbers).toBe(false);
    });

    it("handles empty lines in line-numbered content", () => {
      // Empty lines in the middle - when formatted, they would be "2| "
      const input = "1| line one\n2| \n3| line three";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe("line one\n\nline three");
      expect(result.hasLineNumbers).toBe(true);
    });

    it("preserves indentation in stripped content", () => {
      const input = "1| function test() {\n2|   return 42;\n3| }";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe("function test() {\n  return 42;\n}");
      expect(result.hasLineNumbers).toBe(true);
    });

    it("handles content with pipe characters that are not line numbers", () => {
      const input = "const x = 'a | b';\nconst y = foo || bar;";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe(input);
      expect(result.hasLineNumbers).toBe(false);
    });

    it("rejects non-sequential line numbers as false positives", () => {
      // Content that looks like line numbers but isn't sequential
      const input = "1| Alice\n3| Bob\n5| Charlie";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe(input);
      expect(result.hasLineNumbers).toBe(false);
    });

    it("accepts sequential line numbers starting from any number", () => {
      // Sequential line numbers starting from 5
      const input = "5| line five\n6| line six\n7| line seven";
      const result = stripLineNumberPrefixes(input);
      expect(result.content).toBe("line five\nline six\nline seven");
      expect(result.hasLineNumbers).toBe(true);
      expect(result.startLineNumber).toBe(5);
    });

    it("round-trips correctly with addLineNumberPrefixes", () => {
      const original = "function test() {\n  const x = 1;\n  return x * 2;\n}";
      const withNumbers = addLineNumberPrefixes(original);
      const stripped = stripLineNumberPrefixes(withNumbers);
      expect(stripped.content).toBe(original);
      expect(stripped.hasLineNumbers).toBe(true);
    });

    it("round-trips correctly for 100+ line content", () => {
      const original = Array.from(
        { length: 150 },
        (_, i) => `line ${i + 1}`,
      ).join("\n");
      const withNumbers = addLineNumberPrefixes(original);
      const stripped = stripLineNumberPrefixes(withNumbers);
      expect(stripped.content).toBe(original);
      expect(stripped.hasLineNumbers).toBe(true);
    });
  });
});
