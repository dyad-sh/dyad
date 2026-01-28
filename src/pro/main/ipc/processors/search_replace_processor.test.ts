import { describe, it, expect } from "vitest";
import { applySearchReplace } from "./search_replace_processor";

describe("applySearchReplace", () => {
  describe("cascading fuzzy matching", () => {
    it("should match content with smart quotes normalized (Pass 4)", () => {
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

    it("should fail when content does not match in any pass", () => {
      const originalContent = `function hello() {
  console.log("Hello, World!");
  return true;
}`;

      // Search block is completely different
      const diffContent = `<<<<<<< SEARCH
function goodbye() {
  console.error("Bye, Earth!");
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
      expect(result.error).toContain("did not match any content");
    });

    it("should prefer exact match when available", () => {
      const originalContent = `function hello() {
  console.log("Hello");
}

function hello() {
  console.log("Hello");
}`;

      // Both occurrences are exact matches - should be ambiguous
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

    it("should handle whitespace differences with edge whitespace normalization (Pass 3)", () => {
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
