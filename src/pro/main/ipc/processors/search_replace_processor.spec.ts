import { describe, it, expect } from "vitest";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";

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
  describe("exactMatchOnly option", () => {
    it("succeeds with exact match when exactMatchOnly is true", () => {
      const original = ["alpha", "beta", "gamma"].join("\n");
      const diff = `
<<<<<<< SEARCH
beta
=======
BETA
>>>>>>> REPLACE
`;
      const { success, content } = applySearchReplace(original, diff, {
        exactMatchOnly: true,
      });
      expect(success).toBe(true);
      expect(content).toBe(["alpha", "BETA", "gamma"].join("\n"));
    });

    it("fails when only lenient match exists and exactMatchOnly is true", () => {
      // Original has tab indentation, search uses spaces
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

      // Without exactMatchOnly, this would succeed via lenient matching
      const lenientResult = applySearchReplace(original, diff);
      expect(lenientResult.success).toBe(true);

      // With exactMatchOnly, it should fail
      const { success, error } = applySearchReplace(original, diff, {
        exactMatchOnly: true,
      });
      expect(success).toBe(false);
      expect(error).toMatch(/did not match exactly/i);
    });

    it("fails when only fuzzy match exists and exactMatchOnly is true", () => {
      // Original has a minor typo that fuzzy matching would accept
      const original = [
        "function test() {",
        "  console.log('helo');",
        "}",
      ].join("\n");

      const diff = `
<<<<<<< SEARCH
function test() {
  console.log('hello');
}
=======
function test() {
  console.log('goodbye');
}
>>>>>>> REPLACE
`;

      // With exactMatchOnly, fuzzy matching is skipped
      const { success, error } = applySearchReplace(original, diff, {
        exactMatchOnly: true,
      });
      expect(success).toBe(false);
      expect(error).toMatch(/did not match exactly/i);
    });
  });

  describe("rejectIdentical option", () => {
    it("errors when search and replace are identical with rejectIdentical", () => {
      const original = ["x", "middle", "z"].join("\n");
      const diff = `
<<<<<<< SEARCH
middle
=======
middle
>>>>>>> REPLACE
`;
      const { success, error } = applySearchReplace(original, diff, {
        rejectIdentical: true,
      });
      expect(success).toBe(false);
      expect(error).toMatch(/identical/i);
    });

    it("succeeds when search and replace are identical without rejectIdentical", () => {
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
  });

  describe("combined options", () => {
    it("applies both options together", () => {
      const original = ["line1", "line2", "line3"].join("\n");
      const diff = `
<<<<<<< SEARCH
line2
=======
line2
>>>>>>> REPLACE
`;
      const { success, error } = applySearchReplace(original, diff, {
        exactMatchOnly: true,
        rejectIdentical: true,
      });
      expect(success).toBe(false);
      expect(error).toMatch(/identical/i);
    });
  });
});
