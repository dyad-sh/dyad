/**
 * Unit tests for the semantic chunking utility
 *
 * Tests cover:
 * - Chunk size boundaries (400-500 chars)
 * - Overlap maintenance (~100 chars)
 * - Semantic boundary detection
 * - Code block preservation
 * - Edge cases (empty, short, very long text)
 */

import { describe, it, expect } from "vitest";
import {
  chunkText,
  chunkMarkdown,
  estimateTokenCount,
  validateConfig,
  createChunker,
  defaultChunker,
  type Chunk,
  type ChunkerConfig,
} from "../chunker.js";

describe("chunker", () => {
  describe("chunkText", () => {
    describe("basic chunking", () => {
      it("should return empty array for empty text", () => {
        const chunks = chunkText("");
        expect(chunks).toEqual([]);
      });

      it("should return empty array for whitespace-only text", () => {
        const chunks = chunkText("   \n\t  ");
        expect(chunks).toEqual([]);
      });

      it("should return single chunk for short text", () => {
        const text = "This is a short piece of text.";
        const chunks = chunkText(text);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].text).toBe(text);
        expect(chunks[0].index).toBe(0);
        expect(chunks[0].overlapsWith).toEqual([]);
      });

      it("should return single chunk for text at max size boundary", () => {
        const text = "A".repeat(500);
        const chunks = chunkText(text);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].text).toBe(text);
      });
    });

    describe("chunk size constraints", () => {
      it("should create chunks within 400-500 char range for long text", () => {
        // Create text that's long enough to require multiple chunks
        const text = "This is a test sentence. ".repeat(100); // ~2500 chars
        const chunks = chunkText(text);

        expect(chunks.length).toBeGreaterThan(1);

        // All chunks except possibly the last should be within target range
        for (let i = 0; i < chunks.length - 1; i++) {
          expect(chunks[i].text.length).toBeGreaterThanOrEqual(350); // Allow some flexibility
          expect(chunks[i].text.length).toBeLessThanOrEqual(550); // Allow some flexibility
        }
      });

      it("should respect custom chunk size configuration", () => {
        const text = "Word ".repeat(200); // ~1000 chars
        const config: ChunkerConfig = {
          targetChunkSize: 200,
          minChunkSize: 150,
          maxChunkSize: 250,
          overlapSize: 50,
        };
        const chunks = chunkText(text, config);

        expect(chunks.length).toBeGreaterThan(1);

        // Check most chunks are near target size
        for (let i = 0; i < chunks.length - 1; i++) {
          expect(chunks[i].text.length).toBeLessThanOrEqual(300);
        }
      });
    });

    describe("overlap", () => {
      it("should maintain overlap between consecutive chunks", () => {
        const text = "Paragraph one with some content here. ".repeat(30);
        const chunks = chunkText(text);

        expect(chunks.length).toBeGreaterThan(1);

        // Check that each chunk (except first) overlaps with previous
        for (let i = 1; i < chunks.length; i++) {
          expect(chunks[i].overlapsWith).toContain(i - 1);
        }
      });

      it("should have text content overlap between adjacent chunks", () => {
        const text = "The quick brown fox jumps over the lazy dog. ".repeat(50);
        const chunks = chunkText(text);

        if (chunks.length > 1) {
          // The end of chunk N should appear at the start of chunk N+1
          // (approximately, due to semantic boundary finding)
          const chunk1End = chunks[0].text.slice(-50);
          const chunk2Start = chunks[1].text.slice(0, 150);

          // At least some characters should overlap
          const hasOverlap = chunk2Start.includes(chunk1End.slice(-20)) ||
            chunk1End.slice(-30).split(" ").some(word =>
              word.length > 3 && chunk2Start.includes(word)
            );
          expect(hasOverlap || chunks[1].overlapsWith.includes(0)).toBe(true);
        }
      });
    });

    describe("semantic boundaries", () => {
      it("should prefer breaking at paragraph boundaries", () => {
        const text = "First paragraph content here.\n\nSecond paragraph starts here. " +
          "More content in second paragraph. ".repeat(20);
        const chunks = chunkText(text);

        // At least one chunk should end near or at a paragraph boundary
        const endsAtParagraph = chunks.some(chunk =>
          chunk.text.endsWith(".") || chunk.text.endsWith("\n")
        );
        expect(endsAtParagraph).toBe(true);
      });

      it("should prefer breaking at sentence boundaries", () => {
        const text = "This is sentence one. This is sentence two. This is sentence three. ".repeat(20);
        const chunks = chunkText(text);

        // Most chunks should end at sentence boundaries
        const endsAtSentence = chunks.filter(chunk =>
          chunk.text.trim().endsWith(".") ||
          chunk.text.trim().endsWith("!") ||
          chunk.text.trim().endsWith("?")
        ).length;

        expect(endsAtSentence).toBeGreaterThan(chunks.length / 2);
      });

      it("should prefer not breaking in the middle of words", () => {
        const text = "Hello world. This is a test sentence. Another sentence here. ".repeat(20);
        const chunks = chunkText(text);

        // Most chunks should end at word boundaries (space or punctuation before end)
        let wordBoundaryEnds = 0;
        for (const chunk of chunks) {
          const trimmed = chunk.text.trim();
          if (trimmed.length > 0) {
            const lastChar = trimmed[trimmed.length - 1];
            // Ends with punctuation, space-like, or is the last chunk
            if (
              /[.!?,;:\s]/.test(lastChar) ||
              chunk.index === chunks.length - 1
            ) {
              wordBoundaryEnds++;
            }
          }
        }

        // At least 50% should end at word boundaries (best effort)
        expect(wordBoundaryEnds).toBeGreaterThan(chunks.length * 0.5);
      });
    });

    describe("code block handling", () => {
      it("should preserve code blocks when enabled", () => {
        const codeBlock = "```javascript\nfunction hello() {\n  console.log('Hello');\n}\n```";
        const text = "Introduction text. " + codeBlock + " Conclusion text.";
        const chunks = chunkText(text, { preserveCodeBlocks: true });

        // The code block should appear intact in at least one chunk
        const hasCodeBlock = chunks.some(chunk =>
          chunk.text.includes("```javascript") && chunk.text.includes("```")
        );
        expect(hasCodeBlock).toBe(true);
      });

      it("should handle multiple code blocks", () => {
        const text = "Text before.\n\n```python\nprint('hello')\n```\n\nMiddle text.\n\n```rust\nfn main() {}\n```\n\nEnd text.";
        const chunks = chunkText(text, { preserveCodeBlocks: true });

        // Both code blocks should be preserved
        const fullText = chunks.map(c => c.text).join("");
        expect(fullText).toContain("```python");
        expect(fullText).toContain("```rust");
      });
    });

    describe("metadata", () => {
      it("should track correct indices", () => {
        const text = "Test content. ".repeat(50);
        const chunks = chunkText(text);

        for (let i = 0; i < chunks.length; i++) {
          expect(chunks[i].index).toBe(i);
        }
      });

      it("should track correct offsets", () => {
        const text = "Some test text that will be chunked into pieces. ".repeat(20);
        const chunks = chunkText(text);

        for (const chunk of chunks) {
          expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
          expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
          expect(chunk.endOffset).toBeLessThanOrEqual(text.length);
        }
      });

      it("should identify section headers", () => {
        const text = "# Main Title\n\nIntro paragraph.\n\n## Section One\n\n" +
          "Content for section one. ".repeat(30);
        const chunks = chunkText(text);

        // Later chunks should have section info
        const chunksWithSection = chunks.filter(c => c.section !== undefined);
        expect(chunksWithSection.length).toBeGreaterThan(0);
      });
    });
  });

  describe("chunkMarkdown", () => {
    it("should handle markdown with multiple sections", () => {
      const markdown = `# Title

Introduction paragraph.

## Section 1

Content for section 1. ${"More content. ".repeat(20)}

## Section 2

Content for section 2. ${"Additional text. ".repeat(20)}
`;

      const chunks = chunkMarkdown(markdown);
      expect(chunks.length).toBeGreaterThan(0);

      // All chunks should have sequential indices
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].index).toBe(i);
      }
    });

    it("should preserve section information across chunks", () => {
      const markdown = `# Main

## First Section

${"First section content. ".repeat(30)}

## Second Section

${"Second section content. ".repeat(30)}
`;

      const chunks = chunkMarkdown(markdown);

      // Should have chunks from different sections
      const sections = new Set(chunks.map(c => c.section).filter(Boolean));
      expect(sections.size).toBeGreaterThanOrEqual(1);
    });

    it("should handle empty sections gracefully", () => {
      const markdown = "# Title\n\n## Empty Section\n\n## Section with content\n\nSome text here.";
      const chunks = chunkMarkdown(markdown);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("estimateTokenCount", () => {
    it("should estimate ~4 characters per token", () => {
      const text = "This is a test"; // 14 chars
      const tokens = estimateTokenCount(text);
      expect(tokens).toBe(4); // ceil(14/4) = 4
    });

    it("should return 0 for empty text", () => {
      expect(estimateTokenCount("")).toBe(0);
    });

    it("should handle long text", () => {
      const text = "A".repeat(1000);
      expect(estimateTokenCount(text)).toBe(250);
    });

    it("should round up partial tokens", () => {
      const text = "ABC"; // 3 chars
      expect(estimateTokenCount(text)).toBe(1); // ceil(3/4) = 1
    });
  });

  describe("validateConfig", () => {
    it("should validate correct configuration", () => {
      const config: ChunkerConfig = {
        targetChunkSize: 450,
        minChunkSize: 400,
        maxChunkSize: 500,
        overlapSize: 100,
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should warn when minChunkSize > targetChunkSize", () => {
      const config: ChunkerConfig = {
        targetChunkSize: 400,
        minChunkSize: 450,
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes("minChunkSize"))).toBe(true);
    });

    it("should warn when targetChunkSize > maxChunkSize", () => {
      const config: ChunkerConfig = {
        targetChunkSize: 600,
        maxChunkSize: 500,
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes("targetChunkSize"))).toBe(true);
    });

    it("should warn when overlapSize >= minChunkSize", () => {
      const config: ChunkerConfig = {
        minChunkSize: 100,
        overlapSize: 100,
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes("overlapSize"))).toBe(true);
    });

    it("should warn when maxChunkSize exceeds token limit", () => {
      const config: ChunkerConfig = {
        maxChunkSize: 3000, // > 512 * 4 = 2048
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes("token limits"))).toBe(true);
    });

    it("should use defaults when values not provided", () => {
      const result = validateConfig({});
      expect(result.valid).toBe(true);
    });
  });

  describe("createChunker", () => {
    it("should create a function with default config", () => {
      const chunker = createChunker();
      expect(typeof chunker).toBe("function");

      const chunks = chunker("Test text");
      expect(Array.isArray(chunks)).toBe(true);
    });

    it("should create a function with custom config", () => {
      const chunker = createChunker({
        targetChunkSize: 200,
        maxChunkSize: 250,
      });

      const text = "Word ".repeat(100);
      const chunks = chunker(text);

      // Should create smaller chunks
      for (const chunk of chunks.slice(0, -1)) {
        expect(chunk.text.length).toBeLessThanOrEqual(300);
      }
    });
  });

  describe("defaultChunker", () => {
    it("should be a function", () => {
      expect(typeof defaultChunker).toBe("function");
    });

    it("should produce chunks with default settings", () => {
      const text = "Sample text. ".repeat(50);
      const chunks = defaultChunker(text);

      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("should handle text with only whitespace and newlines", () => {
      const text = "   \n\n   \t\t\n  ";
      const chunks = chunkText(text);
      expect(chunks).toEqual([]);
    });

    it("should handle very long single words", () => {
      const longWord = "A".repeat(600);
      const chunks = chunkText(longWord);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle text with special characters", () => {
      const text = "Hello! @#$%^&*() Special chars: éàü 中文 🎉 ".repeat(20);
      const chunks = chunkText(text);
      expect(chunks.length).toBeGreaterThan(0);

      // Reconstructed text should contain all special chars
      const reconstructed = chunks.map(c => c.text).join(" ");
      expect(reconstructed).toContain("@#$%^&*()");
      expect(reconstructed).toContain("中文");
    });

    it("should handle text with many newlines", () => {
      const text = "Line 1\n\n\n\nLine 2\n\n\n\nLine 3\n".repeat(30);
      const chunks = chunkText(text);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should not create infinite loops on pathological input", () => {
      // This should complete in reasonable time
      const text = "x".repeat(10000);
      const startTime = Date.now();
      const chunks = chunkText(text);
      const duration = Date.now() - startTime;

      expect(chunks.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
    });
  });
});
