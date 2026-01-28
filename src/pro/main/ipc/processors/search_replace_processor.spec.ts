import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";

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
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";

describe("search_replace_processor - parseSearchReplaceBlocks", () => {
  it("parses multiple blocks with start_line in ascending order", () => {
    const diff = `
<<<<<<< SEARCH
line one
=======
LINE ONE
>>>>>>> REPLACE

<<<<<<< SEARCH
line four
=======
LINE FOUR
>>>>>>> REPLACE
`;
    const blocks = parseSearchReplaceBlocks(diff);
    expect(blocks.length).toBe(2);
    expect(blocks[0].searchContent.trim()).toBe("line one");
    expect(blocks[0].replaceContent.trim()).toBe("LINE ONE");
  });
});

describe("search_replace_processor - applySearchReplace", () => {
  it("applies single block with exact start_line match", () => {
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

    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain("def calculate_sum(items):");
    expect(content).not.toContain("def calculate_total(items):");
  });

  it("falls back to global exact search when start_line missing", () => {
    const original = ["alpha", "beta", "gamma"].join("\n");
    const diff = `
<<<<<<< SEARCH
beta
=======
BETA
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toBe(["alpha", "BETA", "gamma"].join("\n"));
  });

  it("applies multiple blocks in order and accounts for line deltas", () => {
    const original = ["1", "2", "3", "4", "5"].join("\n");
    const diff = `
<<<<<<< SEARCH
1
=======
ONE\nONE-EXTRA
>>>>>>> REPLACE

<<<<<<< SEARCH
4
=======
FOUR
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toBe(
      ["ONE", "ONE-EXTRA", "2", "3", "FOUR", "5"].join("\n"),
    );
  });

  it("detects and strips line-numbered content, inferring start line when omitted", () => {
    const original = ["a", "b", "c", "d"].join("\n");
    const diff = `
<<<<<<< SEARCH
a\nb
=======
A\nB
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toBe(["A", "B", "c", "d"].join("\n"));
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
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    // The replacement lines should keep the base indent of two spaces (from matched block)
    expect(content).toContain("  if (x) {");
    expect(content).toContain("      doOther();");
    expect(content).toContain("    doAnother();");
  });

  it("supports deletions when replace content is empty", () => {
    const original = ["x", "y", "z"].join("\n");
    const diff = `
<<<<<<< SEARCH
y
=======

>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
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
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toBe(["a", "B", "c"].join("\r\n"));
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
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toBe(["begin", "LITERAL MARKER", "end"].join("\n"));
  });

  it("errors when SEARCH block does not match any content", () => {
    const original = "foo\nbar\nbaz";
    const diff = `
<<<<<<< SEARCH
NOT IN FILE
=======
STILL NOT
>>>>>>> REPLACE
`;
    const { success, error } = applySearchReplace(original, diff);
    expect(success).toBe(false);
    expect(error).toMatch(/Search block did not match any content/i);
  });

  it("matches despite differing indentation and trailing whitespace", () => {
    const original = [
      "\tfunction example() {",
      "\t    doThing();   ", // extra trailing spaces
      "\t}",
    ].join("\n");

    const diff = `
<<<<<<< SEARCH
function example() {
  doThing();
}
=======
function example() {
  doOther();
}
>>>>>>> REPLACE
`;

    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain("doOther();");
    expect(content).not.toContain("doThing();");
  });

  it("matches when search uses spaces and target uses tabs (and vice versa)", () => {
    const original = ["\tif (ready) {", "\t\tstart();", "\t}"].join("\n");

    const diff = `
<<<<<<< SEARCH
  if (ready) {
    start();
  }
=======
  if (ready) {
    launch();
  }
>>>>>>> REPLACE
`;

    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain("launch();");
    expect(content).not.toContain("start();");
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
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toBe(original);
  });

  it("errors when SEARCH block matches multiple locations (ambiguous)", () => {
    const original = ["foo", "bar", "baz", "bar", "qux"].join("\n");

    const diff = `
<<<<<<< SEARCH
bar
=======
BAR
>>>>>>> REPLACE
`;

    const { success, error } = applySearchReplace(original, diff);
    expect(success).toBe(false);
    expect(error).toMatch(/(ambiguous|multiple)/i);
  });

  it("errors when SEARCH block matches multiple locations with whitespace normalization (ambiguous)", () => {
    const original = [
      "\tif (ready) {",
      "\t\tstart();   ",
      "\t}",
      "  if (ready) {",
      "    start();   ",
      "  }",
    ].join("\n");

    const diff = `
<<<<<<< SEARCH
if (ready) {
  start();
}
=======
if (ready) {
  launch();
}
>>>>>>> REPLACE
`;

    const { success, error } = applySearchReplace(original, diff);
    expect(success).toBe(false);
    expect(error).toMatch(/ambiguous/i);
  });

  it("errors when SEARCH block is empty", () => {
    const original = ["a", "b"].join("\n");
    const diff = `
<<<<<<< SEARCH
=======
REPLACEMENT
>>>>>>> REPLACE
`;
    const { success, error } = applySearchReplace(original, diff);
    expect(success).toBe(false);
    expect(error).toMatch(/empty SEARCH block is not allowed/i);
  });
});

describe("search_replace_processor - cascading matching passes", () => {
  it("Pass 1: matches exactly when content is identical", () => {
    const original = ["  hello world", "  goodbye"].join("\n");
    const diff = `
<<<<<<< SEARCH
  hello world
=======
  hi world
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain("hi world");
  });

  it("Pass 2: matches when only trailing whitespace differs", () => {
    const original = ["hello world   ", "goodbye"].join("\n"); // trailing spaces in file
    const diff = `
<<<<<<< SEARCH
hello world
=======
hi world
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain("hi world");
  });

  it("Pass 3: matches when leading/trailing whitespace differs", () => {
    const original = ["  hello world  ", "goodbye"].join("\n"); // spaces on both ends
    const diff = `
<<<<<<< SEARCH
hello world
=======
hi world
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain("hi world");
  });

  it("Pass 4: matches with unicode normalization (smart quotes)", () => {
    const original = ['console.log("hello")', "other line"].join("\n"); // smart quotes
    const diff = `
<<<<<<< SEARCH
console.log("hello")
=======
console.log("goodbye")
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain('console.log("goodbye")');
  });

  it("Pass 4: matches with unicode normalization (en-dash/em-dash)", () => {
    const original = ["value = 10–20", "other line"].join("\n"); // en-dash
    const diff = `
<<<<<<< SEARCH
value = 10-20
=======
value = 5-15
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain("value = 5-15");
  });

  it("Pass 4: matches with unicode normalization (non-breaking space)", () => {
    const original = ["hello\u00A0world", "other line"].join("\n"); // non-breaking space
    const diff = `
<<<<<<< SEARCH
hello world
=======
hi world
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toContain("hi world");
  });

  it("fails when no pass matches", () => {
    const original = ["completely different content", "more lines"].join("\n");
    const diff = `
<<<<<<< SEARCH
this does not exist
=======
replacement
>>>>>>> REPLACE
`;
    const { success, error } = applySearchReplace(original, diff);
    expect(success).toBe(false);
    expect(error).toMatch(/did not match any content/i);
  });
});

describe("search_replace_processor - options", () => {
  describe("leading/trailing empty line trimming", () => {
    it("matches when search has extra trailing newline", () => {
      const original = ["function test() {", "  return 1;", "}"].join("\n");
      const diff = `
<<<<<<< SEARCH
  return 1;

=======
  return 2;
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplace(original, diff);
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
      const { success, content } = applySearchReplace(original, diff);
      expect(success).toBe(true);
      expect(content).toContain("return 2");
    });

    it("matches when search has both leading and trailing empty lines", () => {
      const original = ["function test() {", "  return 1;", "}"].join("\n");
      const diff = `
<<<<<<< SEARCH


  return 1;


=======
  return 2;
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplace(original, diff);
      expect(success).toBe(true);
      expect(content).toContain("return 2");
    });

    it("uses trimmed match only when exact match fails", () => {
      // File does NOT have a leading empty line before the target
      const original = ["function test() {", "  return 1;", "}"].join("\n");
      // Search has leading empty line that doesn't exist in file
      const diff = `
<<<<<<< SEARCH

  return 1;
=======
  return 2;
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplace(original, diff);
      expect(success).toBe(true);
      // Should match via trimming since exact match with empty line fails
      expect(content).toContain("return 2");
      // Original structure preserved (no extra empty lines added)
      expect(content).toBe(
        ["function test() {", "  return 2;", "}"].join("\n"),
      );
    });

    it("does not trim if exact match succeeds", () => {
      const original = ["line1", "line2", "line3"].join("\n");
      const diff = `
<<<<<<< SEARCH
line2
=======
REPLACED
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplace(original, diff);
      expect(success).toBe(true);
      expect(content).toBe(["line1", "REPLACED", "line3"].join("\n"));
    });
  });
});

describe("search_replace_processor - detailed failure logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs detailed diagnostic information when search block does not match", () => {
    const original = [
      "function greet() {",
      "  console.log('Hello');",
      "  return true;",
      "}",
      "",
      "function farewell() {",
      "  console.log('Goodbye');",
      "  return false;",
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

    const { success, error } = applySearchReplace(original, diff);
    expect(success).toBe(false);
    expect(error).toContain("did not match");

    // Verify detailed logging was called with expected diagnostic information
    const allErrorCalls = mockError.mock.calls
      .map((call) => call[0])
      .join("\n");
    expect(allErrorCalls).toMatchInlineSnapshot(`
      "=== SEARCH/REPLACE MATCH FAILURE (Block 1) ===

      --- SEARCH CONTENT (4 lines) ---
          1: "function greet() {"
          2: "  console.log('Hi there');"
          3: "  return true;"
          4: "}"

      --- BEST PARTIAL MATCH: 3/4 lines match ---
          Location: lines 1-4 of original file
          First mismatch at search line: 2

      --- ORIGINAL FILE (lines 1-9, match region marked with >) ---
        >    1: "function greet() {"
        X    2: "  console.log('Hello');"
        >    3: "  return true;"
        >    4: "}"
             5: ""
             6: "function farewell() {"
             7: "  console.log('Goodbye');"
             8: "  return false;"
             9: "}"

      --- FIRST MISMATCH DETAILS ---
        Search line 2: "  console.log('Hi there');"
        File line 2:   "  console.log('Hello');"

      === END MATCH FAILURE ===
      "
    `);
  });

  it("logs the correct number of matching lines in partial match", () => {
    const original = [
      "line one",
      "line two",
      "line three",
      "line four",
      "line five",
    ].join("\n");

    // Search for content where 2 out of 3 lines match
    const diff = `
<<<<<<< SEARCH
line two
WRONG LINE
line four
=======
replaced
>>>>>>> REPLACE
`;

    const { success } = applySearchReplace(original, diff);
    expect(success).toBe(false);

    // Verify logging shows partial match info
    const allErrorCalls = mockError.mock.calls
      .map((call) => call[0])
      .join("\n");
    expect(allErrorCalls).toMatchInlineSnapshot(`
      "=== SEARCH/REPLACE MATCH FAILURE (Block 1) ===

      --- SEARCH CONTENT (3 lines) ---
          1: "line two"
          2: "WRONG LINE"
          3: "line four"

      --- BEST PARTIAL MATCH: 2/3 lines match ---
          Location: lines 2-4 of original file
          First mismatch at search line: 2

      --- ORIGINAL FILE (lines 1-5, match region marked with >) ---
             1: "line one"
        >    2: "line two"
        X    3: "line three"
        >    4: "line four"
             5: "line five"

      --- FIRST MISMATCH DETAILS ---
        Search line 2: "WRONG LINE"
        File line 3:   "line three"

      === END MATCH FAILURE ===
      "
    `);
  });

  it("logs with JSON escaping to show invisible characters", () => {
    const original = "hello\tworld\ntest";

    const diff = `
<<<<<<< SEARCH
hello world
=======
replaced
>>>>>>> REPLACE
`;

    const { success } = applySearchReplace(original, diff);
    expect(success).toBe(false);

    // Verify JSON.stringify is used (shows \t as escaped in the output)
    const allErrorCalls = mockError.mock.calls
      .map((call) => call[0])
      .join("\n");
    expect(allErrorCalls).toMatchInlineSnapshot(`
      "=== SEARCH/REPLACE MATCH FAILURE (Block 1) ===

      --- SEARCH CONTENT (1 lines) ---
          1: "hello world"

      --- BEST PARTIAL MATCH: 0/1 lines match ---
          Location: lines 1-1 of original file
          First mismatch at search line: 1

      --- ORIGINAL FILE (lines 1-2, match region marked with >) ---
        X    1: "hello\\tworld"
             2: "test"

      --- FIRST MISMATCH DETAILS ---
        Search line 1: "hello world"
        File line 1:   "hello\\tworld"

      === END MATCH FAILURE ===
      "
    `);
  });
});
