import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock logger functions that we can spy on
const mockError = vi.fn();
const mockWarn = vi.fn();
const mockDebug = vi.fn();

// Mock electron-log - must be before importing the module that uses it
vi.mock("electron-log", () => {
  return {
    default: {
      scope: () => ({
        log: vi.fn(),
        warn: (...args: unknown[]) => mockWarn(...args),
        error: (...args: unknown[]) => mockError(...args),
        debug: (...args: unknown[]) => mockDebug(...args),
      }),
    },
  };
});

// Import after mock is set up
import { applySearchReplaceWithLineNumbers } from "./search_replace_line_numbers_processor";

describe("search_replace_line_numbers_processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic search/replace operations", () => {
    it("accepts direct old/new content arguments", () => {
      const original = ["alpha", "beta", "gamma"].join("\n");

      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "beta",
        "BETA",
      );

      expect(success).toBe(true);
      expect(content).toBe(["alpha", "BETA", "gamma"].join("\n"));
    });

    it("applies single block with exact match", () => {
      const original = [
        "def calculate_total(items):",
        "    total = 0",
        "    for item in items:",
        "        total += item",
        "    return total",
        "",
      ].join("\n");

      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "def calculate_total(items):\n    total = 0",
        "def calculate_sum(items):\n    total = 0",
      );
      expect(success).toBe(true);
      expect(content).toContain("def calculate_sum(items):");
      expect(content).not.toContain("def calculate_total(items):");
    });

    it("supports deletions when replace content is empty", () => {
      const original = ["x", "y", "z"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "y",
        "",
      );
      expect(success).toBe(true);
      expect(content).toBe(["x", "z"].join("\n"));
    });

    it("preserves CRLF line endings", () => {
      const original = ["a", "b", "c"].join("\r\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "b",
        "B",
      );
      expect(success).toBe(true);
      expect(content).toBe(["a", "B", "c"].join("\r\n"));
    });
  });

  describe("line number stripping", () => {
    it("strips line number prefixes from search content and matches", () => {
      const original = [
        "function greet() {",
        "  console.log('Hello');",
        "  return true;",
        "}",
      ].join("\n");

      // Search content has line number prefixes (as if copied from read_file output)
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "1| function greet() {\n2|   console.log('Hello');",
        "function greet() {\n  console.log('Hi there');",
      );
      expect(success).toBe(true);
      expect(content).toContain("console.log('Hi there')");
      expect(content).not.toContain("console.log('Hello')");
    });

    it("strips line number prefixes from both search and replace content", () => {
      const original = [
        "function test() {",
        "  const x = 1;",
        "  return x;",
        "}",
      ].join("\n");

      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "1| function test() {\n2|   const x = 1;",
        "1| function test() {\n2|   const y = 2;",
      );
      expect(success).toBe(true);
      expect(content).toContain("const y = 2");
      expect(content).not.toContain("const x = 1");
    });

    it("handles padded line numbers (right-aligned)", () => {
      const original = Array.from(
        { length: 15 },
        (_, i) => `line ${i + 1}`,
      ).join("\n");

      // Padded line numbers for a file with 15+ lines
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "10| line 10\n11| line 11\n12| line 12",
        "line 10 modified\nline 11 modified\nline 12 modified",
      );
      expect(success).toBe(true);
      expect(content).toContain("line 10 modified");
      expect(content).toContain("line 11 modified");
      expect(content).toContain("line 12 modified");
    });

    it("works without line numbers (backward compatible)", () => {
      const original = ["alpha", "beta", "gamma"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "beta",
        "BETA",
      );
      expect(success).toBe(true);
      expect(content).toBe(["alpha", "BETA", "gamma"].join("\n"));
    });

    it("does not strip partial line number patterns", () => {
      const original = ["const x = '1| hello';", "const y = 'world';"].join(
        "\n",
      );

      // This should NOT be treated as having line numbers since not all lines match
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "const x = '1| hello';\nconst y = 'world';",
        "const x = 'changed';\nconst y = 'also changed';",
      );
      expect(success).toBe(true);
      expect(content).toContain("const x = 'changed'");
    });
  });

  describe("line number direct matching", () => {
    it("uses line numbers to match directly when they match file content", () => {
      const original = ["line 1", "line 2", "line 3", "line 4", "line 5"].join(
        "\n",
      );

      // Line numbers 2-3 should match lines 2-3 in file
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "2| line 2\n3| line 3",
        "modified 2\nmodified 3",
      );
      expect(success).toBe(true);
      expect(content).toBe(
        ["line 1", "modified 2", "modified 3", "line 4", "line 5"].join("\n"),
      );
      expect(mockDebug).toHaveBeenCalledWith(
        expect.stringContaining("line numbers directly"),
      );
    });

    it("falls back to fuzzy matching when line numbers don't match file", () => {
      const original = ["line 1", "line 2", "line 3", "line 4", "line 5"].join(
        "\n",
      );

      // Search content claims to be at lines 10-11, but content matches lines 2-3
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "10| line 2\n11| line 3",
        "modified 2\nmodified 3",
      );
      expect(success).toBe(true);
      expect(content).toBe(
        ["line 1", "modified 2", "modified 3", "line 4", "line 5"].join("\n"),
      );
      expect(mockDebug).toHaveBeenCalledWith(
        expect.stringContaining("falling back to fuzzy matching"),
      );
    });

    it("handles file modifications that shift line numbers", () => {
      // Simulates a file where content has moved from its original position
      const original = [
        "new line added at top",
        "function test() {",
        "  return 42;",
        "}",
      ].join("\n");

      // Search claims line 1-2, but content is now at lines 2-3
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "1| function test() {\n2|   return 42;",
        "function test() {\n  return 100;",
      );
      expect(success).toBe(true);
      expect(content).toContain("return 100");
    });
  });

  describe("cascading fuzzy matching", () => {
    it("Pass 1: matches exactly when content is identical", () => {
      const original = ["  hello world", "  goodbye"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "  hello world",
        "  hi world",
      );
      expect(success).toBe(true);
      expect(content).toContain("hi world");
    });

    it("Pass 2: matches when only trailing whitespace differs", () => {
      const original = ["hello world   ", "goodbye"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "hello world",
        "hi world",
      );
      expect(success).toBe(true);
      expect(content).toContain("hi world");
    });

    it("Pass 3: matches when leading/trailing whitespace differs", () => {
      const original = ["  hello world  ", "goodbye"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "hello world",
        "hi world",
      );
      expect(success).toBe(true);
      expect(content).toContain("hi world");
    });

    it("Pass 4: matches with unicode normalization (smart quotes)", () => {
      const original = ['console.log("hello")', "other line"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        'console.log("hello")',
        'console.log("goodbye")',
      );
      expect(success).toBe(true);
      expect(content).toContain('console.log("goodbye")');
    });

    it("Pass 4: matches with unicode normalization (en-dash)", () => {
      const original = ["value = 10–20", "other line"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "value = 10-20",
        "value = 5-15",
      );
      expect(success).toBe(true);
      expect(content).toContain("value = 5-15");
    });
  });

  describe("enhanced error messages", () => {
    it("provides detailed no-match error with partial match info", () => {
      const original = [
        "function greet() {",
        "  console.log('Hello');",
        "  return true;",
        "}",
      ].join("\n");

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        "function greet() {\n  console.log('Hi there');\n  return true;\n}",
        "function greet() {\n  console.log('Hello World');\n  return true;\n}",
      );
      expect(success).toBe(false);
      expect(error).toContain("Search block did not match any content");
      expect(error).toContain("SEARCH CONTENT");
      expect(error).toContain("BEST PARTIAL MATCH");
      expect(error).toContain("MISMATCH DETAILS");
      expect(error).toContain("SUGGESTION");
    });

    it("provides detailed ambiguous match error", () => {
      const original = ["foo", "bar", "baz", "bar", "qux"].join("\n");

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        "bar",
        "BAR",
      );
      expect(success).toBe(false);
      expect(error).toContain("matched multiple locations");
      expect(error).toContain("MATCHED LOCATIONS");
      expect(error).toContain("SUGGESTION");
      expect(error).toContain("context");
    });

    it("shows correct line range in ambiguous match error for multi-line search", () => {
      const original = [
        "start",
        "match line 1",
        "match line 2",
        "match line 3",
        "middle",
        "match line 1",
        "match line 2",
        "match line 3",
        "end",
      ].join("\n");

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        "match line 1\nmatch line 2\nmatch line 3",
        "replaced",
      );
      expect(success).toBe(false);
      // Should show Lines 2-4 and Lines 6-8 (not Lines 2-3 and Lines 6-7)
      expect(error).toContain("Lines 2-4");
      expect(error).toContain("Lines 6-8");
    });

    it("shows line numbers in error messages", () => {
      const original = [
        "line one",
        "line two",
        "line three",
        "line four",
        "line five",
      ].join("\n");

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        "line two\nWRONG LINE\nline four",
        "replaced",
      );
      expect(success).toBe(false);
      expect(error).toContain("Line 1:");
      expect(error).toContain("Line 2:");
      expect(error).toContain("Line 3:");
    });

    it("shows JSON-escaped content in error messages for invisible characters", () => {
      const original = "hello\tworld\ntest";

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        "hello world",
        "replaced",
      );
      expect(success).toBe(false);
      // The error message should show the tab character escaped
      expect(error).toContain("\\t");
    });
  });

  describe("edge cases", () => {
    it("errors when SEARCH block is empty", () => {
      const original = ["a", "b"].join("\n");
      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        "",
        "REPLACEMENT",
      );
      expect(success).toBe(false);
      expect(error).toContain("empty SEARCH block");
    });

    it("matches when search has extra trailing newline", () => {
      const original = ["function test() {", "  return 1;", "}"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "  return 1;\n",
        "  return 2;",
      );
      expect(success).toBe(true);
      expect(content).toContain("return 2");
    });

    it("matches when search has extra leading newline", () => {
      const original = ["function test() {", "  return 1;", "}"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "\n  return 1;",
        "  return 2;",
      );
      expect(success).toBe(true);
      expect(content).toContain("return 2");
    });

    it("not an error when SEARCH and REPLACE blocks are identical", () => {
      const original = ["x", "middle", "z"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "middle",
        "middle",
      );
      expect(success).toBe(true);
      expect(content).toBe(original);
    });

    it("preserves indentation relative to matched block", () => {
      const original = [
        "function test() {",
        "  if (x) {",
        "    doThing();",
        "  }",
        "}",
      ].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "  if (x) {\n    doThing();",
        "  if (x) {\n      doOther();\n    doAnother();",
      );
      expect(success).toBe(true);
      expect(content).toContain("  if (x) {");
      expect(content).toContain("      doOther();");
      expect(content).toContain("    doAnother();");
    });

    it("preserves intentional trailing whitespace in replacement", () => {
      // Trailing whitespace can be significant in some file types (e.g., Markdown hard breaks)
      const original = ["line 1", "line 2", "line 3"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "line 2",
        "line 2 with trailing   ", // 3 trailing spaces
      );
      expect(success).toBe(true);
      // The trailing spaces should be preserved
      expect(content).toContain("line 2 with trailing   ");
    });

    it("handles content with literal search/replace markers", () => {
      // Content that literally contains marker-like patterns (no escaping needed in 3-arg mode)
      const original = ["begin", ">>>>>>> REPLACE", "end"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        ">>>>>>> REPLACE",
        "LITERAL MARKER",
      );
      expect(success).toBe(true);
      expect(content).toBe(["begin", "LITERAL MARKER", "end"].join("\n"));
    });
  });

  describe("line numbers with various formats", () => {
    it("handles single digit line numbers", () => {
      const original = ["a", "b", "c"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "1| a\n2| b",
        "A\nB",
      );
      expect(success).toBe(true);
      expect(content).toBe(["A", "B", "c"].join("\n"));
    });

    it("handles 100+ line numbers with padding", () => {
      const lines = Array.from({ length: 105 }, (_, i) => `line ${i + 1}`);
      const original = lines.join("\n");

      // Simulate line-numbered content with padding for 100+ lines
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "100| line 100\n101| line 101\n102| line 102",
        "modified 100\nmodified 101\nmodified 102",
      );
      expect(success).toBe(true);
      expect(content).toContain("modified 100");
      expect(content).toContain("modified 101");
      expect(content).toContain("modified 102");
    });

    it("handles empty lines in line-numbered content", () => {
      const original = ["line 1", "", "line 3"].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        "1| line 1\n2|\n3| line 3",
        "modified 1\nstill empty\nmodified 3",
      );
      expect(success).toBe(true);
      expect(content).toBe(
        ["modified 1", "still empty", "modified 3"].join("\n"),
      );
    });
  });
});
