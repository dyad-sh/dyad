import { describe, it, expect } from "vitest";
import {
  applySearchReplace,
  parseSearchReplaceBlocks,
} from "@/ipc/processors/search_replace_processor";

describe("search_replace_processor - parseSearchReplaceBlocks", () => {
  it("parses multiple blocks with start_line in ascending order", () => {
    const diff = `
<<<<<<< SEARCH
:start_line:1
-------
line one
=======
LINE ONE
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
-------
line four
=======
LINE FOUR
>>>>>>> REPLACE
`;
    const blocks = parseSearchReplaceBlocks(diff);
    expect(blocks.length).toBe(2);
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[1].startLine).toBe(4);
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
:start_line:1
-------
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
-------
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
:start_line:1
-------
1
=======
ONE\nONE-EXTRA
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
-------
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
1 | a
2 | b
=======
1 | A
2 | B
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
:start_line:2
-------
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
:start_line:2
-------
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
:start_line:2
-------
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
-------
\\>>>>>>> REPLACE
=======
LITERAL MARKER
>>>>>>> REPLACE
`;
    const { success, content } = applySearchReplace(original, diff);
    expect(success).toBe(true);
    expect(content).toBe(["begin", "LITERAL MARKER", "end"].join("\n"));
  });

  it("returns failure when no blocks can be applied", () => {
    const original = "foo\nbar\nbaz";
    const diff = `
<<<<<<< SEARCH
:start_line:1
-------
NOT IN FILE
=======
STILL NOT
>>>>>>> REPLACE
`;
    const { success, error } = applySearchReplace(original, diff);
    expect(success).toBe(false);
    expect(error).toMatch(/No search\/replace blocks could be applied/);
  });
});
