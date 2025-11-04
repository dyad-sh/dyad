import { describe, it, expect } from "vitest";
import { applySearchReplace } from "./search_replace_processor";

describe("applySearchReplace", () => {
  describe("fuzzy matching with Levenshtein distance", () => {
    it("should match content with minor typos", () => {
      const originalContent = `function hello() {
  console.log("Hello, World!");
  return true;
}`;

      // Search block has a typo: "consle" instead of "console"
      const diffContent = `<<<<<<< SEARCH
function hello() {
  consle.log("Hello, World!");
  return true;
}
=======
function hello() {
  console.log("Hello, Universe!");
  return true;
}
>>>>>>> REPLACE`;

      const result = applySearchReplace(originalContent, diffContent);
      expect(result.success).toBe(true);
      expect(result.content).toContain("Hello, Universe!");
    });

    it("should match content with smart quotes normalized", () => {
      const originalContent = `function greet() {
  console.log("Hello");
}`;

      // Search block uses smart quotes
      const diffContent = `<<<<<<< SEARCH
function greet() {
  console.log("Hello");
}
=======
function greet() {
  console.log("Goodbye");
}
>>>>>>> REPLACE`;

      const result = applySearchReplace(originalContent, diffContent);
      expect(result.success).toBe(true);
      expect(result.content).toContain("Goodbye");
    });

    it("should fail when similarity is below threshold", () => {
      const originalContent = `function hello() {
  console.log("Hello, World!");
  return true;
}`;

      // Search block is too different (multiple typos and changes)
      const diffContent = `<<<<<<< SEARCH
function goodbye() {
  consle.error("Bye, Earth!");
  return false;
}
=======
function hello() {
  console.log("Hello, Universe!");
  return true;
}
>>>>>>> REPLACE`;

      const result = applySearchReplace(originalContent, diffContent);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Best fuzzy match had similarity");
    });

    it("should prefer exact match over fuzzy match", () => {
      const originalContent = `function hello() {
  console.log("Hello");
}

function hello() {
  consle.log("Hello");
}`;

      // Should match the first exact occurrence, not the fuzzy one
      const diffContent = `<<<<<<< SEARCH
function hello() {
  console.log("Hello");
}
=======
function hello() {
  console.log("Goodbye");
}
>>>>>>> REPLACE`;

      const result = applySearchReplace(originalContent, diffContent);
      expect(result.success).toBe(true);
      // Should only replace the first exact match
      expect(result.content).toContain('console.log("Goodbye")');
      expect(result.content).toContain('consle.log("Hello")');
    });

    it("should handle whitespace differences with lenient matching before fuzzy", () => {
      const originalContent = `function test() {
    console.log("test");
}`;

      // Different indentation
      const diffContent = `<<<<<<< SEARCH
function test() {
  console.log("test");
}
=======
function test() {
  console.log("updated");
}
>>>>>>> REPLACE`;

      const result = applySearchReplace(originalContent, diffContent);
      expect(result.success).toBe(true);
      expect(result.content).toContain("updated");
    });
  });

  describe("existing functionality", () => {
    it("should handle exact matches", () => {
      const originalContent = `function hello() {
  console.log("Hello");
}`;

      const diffContent = `<<<<<<< SEARCH
function hello() {
  console.log("Hello");
}
=======
function hello() {
  console.log("Goodbye");
}
>>>>>>> REPLACE`;

      const result = applySearchReplace(originalContent, diffContent);
      expect(result.success).toBe(true);
      expect(result.content).toContain("Goodbye");
    });

    it("should detect ambiguous matches", () => {
      const originalContent = `function hello() {
  console.log("Hello");
}

function hello() {
  console.log("Hello");
}`;

      const diffContent = `<<<<<<< SEARCH
function hello() {
  console.log("Hello");
}
=======
function hello() {
  console.log("Goodbye");
}
>>>>>>> REPLACE`;

      const result = applySearchReplace(originalContent, diffContent);
      expect(result.success).toBe(false);
      expect(result.error).toContain("ambiguous");
    });
  });
});
