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

      const diff = `
<<<<<<< SEARCH
def calculate_total(items):
    total = 0
=======
def calculate_sum(items):
    total = 0
>>>>>>> REPLACE
`;

      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("def calculate_sum(items):");
      expect(content).not.toContain("def calculate_total(items):");
    });

    it("applies multiple blocks in order", () => {
      const original = ["1", "2", "3", "4", "5"].join("\n");
      const diff = `
<<<<<<< SEARCH
1
=======
ONE
ONE-EXTRA
>>>>>>> REPLACE

<<<<<<< SEARCH
4
=======
FOUR
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toBe(
        ["ONE", "ONE-EXTRA", "2", "3", "FOUR", "5"].join("\n"),
      );
    });

    it("supports deletions when replace content is empty", () => {
      const original = ["x", "y", "z"].join("\n");
      const diff = `
<<<<<<< SEARCH
y
=======

>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toBe(["x", "z"].join("\n"));
    });

    it("preserves CRLF line endings", () => {
      const original = ["a", "b", "c"].join("\r\n");
      const diff = `
<<<<<<< SEARCH
b
=======
B
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
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
      const diff = `
<<<<<<< SEARCH
1| function greet() {
2|   console.log('Hello');
=======
function greet() {
  console.log('Hi there');
>>>>>>> REPLACE
`;

      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
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

      const diff = `
<<<<<<< SEARCH
1| function test() {
2|   const x = 1;
=======
1| function test() {
2|   const y = 2;
>>>>>>> REPLACE
`;

      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
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
      const diff = `
<<<<<<< SEARCH
10| line 10
11| line 11
12| line 12
=======
line 10 modified
line 11 modified
line 12 modified
>>>>>>> REPLACE
`;

      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("line 10 modified");
      expect(content).toContain("line 11 modified");
      expect(content).toContain("line 12 modified");
    });

    it("works without line numbers (backward compatible)", () => {
      const original = ["alpha", "beta", "gamma"].join("\n");
      const diff = `
<<<<<<< SEARCH
beta
=======
BETA
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toBe(["alpha", "BETA", "gamma"].join("\n"));
    });

    it("does not strip partial line number patterns", () => {
      const original = ["const x = '1| hello';", "const y = 'world';"].join(
        "\n",
      );

      // This should NOT be treated as having line numbers since not all lines match
      const diff = `
<<<<<<< SEARCH
const x = '1| hello';
const y = 'world';
=======
const x = 'changed';
const y = 'also changed';
>>>>>>> REPLACE
`;

      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("const x = 'changed'");
    });
  });

  describe("cascading fuzzy matching", () => {
    it("Pass 1: matches exactly when content is identical", () => {
      const original = ["  hello world", "  goodbye"].join("\n");
      const diff = `
<<<<<<< SEARCH
  hello world
=======
  hi world
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("hi world");
    });

    it("Pass 2: matches when only trailing whitespace differs", () => {
      const original = ["hello world   ", "goodbye"].join("\n");
      const diff = `
<<<<<<< SEARCH
hello world
=======
hi world
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("hi world");
    });

    it("Pass 3: matches when leading/trailing whitespace differs", () => {
      const original = ["  hello world  ", "goodbye"].join("\n");
      const diff = `
<<<<<<< SEARCH
hello world
=======
hi world
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("hi world");
    });

    it("Pass 4: matches with unicode normalization (smart quotes)", () => {
      const original = ['console.log("hello")', "other line"].join("\n");
      const diff = `
<<<<<<< SEARCH
console.log("hello")
=======
console.log("goodbye")
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain('console.log("goodbye")');
    });

    it("Pass 4: matches with unicode normalization (en-dash)", () => {
      const original = ["value = 10–20", "other line"].join("\n");
      const diff = `
<<<<<<< SEARCH
value = 10-20
=======
value = 5-15
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
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

      const diff = `
<<<<<<< SEARCH
function greet() {
  console.log('Hi there');
  return true;
}
=======
function greet() {
  console.log('Hello World');
  return true;
}
>>>>>>> REPLACE
`;

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        diff,
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

      const diff = `
<<<<<<< SEARCH
bar
=======
BAR
>>>>>>> REPLACE
`;

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        diff,
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

      const diff = `
<<<<<<< SEARCH
match line 1
match line 2
match line 3
=======
replaced
>>>>>>> REPLACE
`;

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        diff,
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

      const diff = `
<<<<<<< SEARCH
line two
WRONG LINE
line four
=======
replaced
>>>>>>> REPLACE
`;

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(false);
      expect(error).toContain("Line 1:");
      expect(error).toContain("Line 2:");
      expect(error).toContain("Line 3:");
    });

    it("shows JSON-escaped content in error messages for invisible characters", () => {
      const original = "hello\tworld\ntest";

      const diff = `
<<<<<<< SEARCH
hello world
=======
replaced
>>>>>>> REPLACE
`;

      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(false);
      // The error message should show the tab character escaped
      expect(error).toContain("\\t");
    });
  });

  describe("edge cases", () => {
    it("errors when SEARCH block is empty", () => {
      const original = ["a", "b"].join("\n");
      const diff = `
<<<<<<< SEARCH
=======
REPLACEMENT
>>>>>>> REPLACE
`;
      const { success, error } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(false);
      expect(error).toContain("empty SEARCH block");
    });

    it("matches when search has extra trailing newline", () => {
      const original = ["function test() {", "  return 1;", "}"].join("\n");
      const diff = `
<<<<<<< SEARCH
  return 1;

=======
  return 2;
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("return 2");
    });

    it("matches when search has extra leading newline", () => {
      const original = ["function test() {", "  return 1;", "}"].join("\n");
      const diff = `
<<<<<<< SEARCH

  return 1;
=======
  return 2;
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("return 2");
    });

    it("unescapes markers inside content and matches literally", () => {
      const original = ["begin", ">>>>>>> REPLACE", "end"].join("\n");
      const diff = `
<<<<<<< SEARCH
\\>>>>>>> REPLACE
=======
LITERAL MARKER
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toBe(["begin", "LITERAL MARKER", "end"].join("\n"));
    });

    it("not an error when SEARCH and REPLACE blocks are identical", () => {
      const original = ["x", "middle", "z"].join("\n");
      const diff = `
<<<<<<< SEARCH
middle
=======
middle
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
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
      const diff = `
<<<<<<< SEARCH
  if (x) {
    doThing();
=======
  if (x) {
      doOther();
    doAnother();
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("  if (x) {");
      expect(content).toContain("      doOther();");
      expect(content).toContain("    doAnother();");
    });

    it("preserves intentional trailing whitespace in replacement", () => {
      // Trailing whitespace can be significant in some file types (e.g., Markdown hard breaks)
      const original = ["line 1", "line 2", "line 3"].join("\n");
      // Build the diff manually to ensure trailing spaces are preserved in the replacement
      const diff = [
        "<<<<<<< SEARCH",
        "line 2",
        "=======",
        "line 2 with trailing   ", // 3 trailing spaces
        ">>>>>>> REPLACE",
      ].join("\n");
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      // The trailing spaces should be preserved
      expect(content).toContain("line 2 with trailing   ");
    });
  });

  describe("line numbers with various formats", () => {
    it("handles single digit line numbers", () => {
      const original = ["a", "b", "c"].join("\n");
      const diff = `
<<<<<<< SEARCH
1| a
2| b
=======
A
B
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toBe(["A", "B", "c"].join("\n"));
    });

    it("handles 100+ line numbers with padding", () => {
      const lines = Array.from({ length: 105 }, (_, i) => `line ${i + 1}`);
      const original = lines.join("\n");

      // Simulate line-numbered content with padding for 100+ lines
      const diff = `
<<<<<<< SEARCH
100| line 100
101| line 101
102| line 102
=======
modified 100
modified 101
modified 102
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toContain("modified 100");
      expect(content).toContain("modified 101");
      expect(content).toContain("modified 102");
    });

    it("handles empty lines in line-numbered content", () => {
      const original = ["line 1", "", "line 3"].join("\n");
      const diff = `
<<<<<<< SEARCH
1| line 1
2|
3| line 3
=======
modified 1
still empty
modified 3
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplaceWithLineNumbers(
        original,
        diff,
      );
      expect(success).toBe(true);
      expect(content).toBe(
        ["modified 1", "still empty", "modified 3"].join("\n"),
      );
    });
  });
});
