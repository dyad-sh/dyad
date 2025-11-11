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

  it("errors when SEARCH and REPLACE blocks are identical", () => {
    const original = ["x", "y", "z"].join("\n");
    const diff = `
<<<<<<< SEARCH
middle
=======
middle
>>>>>>> REPLACE
`;
    const { success, error } = applySearchReplace(original, diff);
    expect(success).toBe(false);
    expect(error).toMatch(/Search and replace blocks are identical/i);
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

  it("errors when SEARCH block fuzzy matches multiple locations (ambiguous)", () => {
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
    expect(error).toMatch(/fuzzy matched/i);
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
