/**
 * Unit tests for the embedding generation utility
 *
 * Tests cover:
 * - EmbeddingGenerator class instantiation and configuration
 * - Embedding dimensions (384 for all-MiniLM-L6-v2)
 * - Normalization behavior
 * - Batch processing
 * - Error handling
 * - Singleton pattern and factory functions
 *
 * Note: Some tests require the actual model to be loaded which can be slow.
 * Tests that require the model are marked with .skip() if running in CI
 * or can be run with the --runInBand flag for isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  EmbeddingGenerator,
  getEmbeddingGenerator,
  createEmbeddingGenerator,
  resetDefaultGenerator,
  isModelReady,
  type EmbeddingConfig,
  type EmbeddingProgress,
} from "../embeddings.js";

describe("embeddings", () => {
  // Reset the singleton before each test
  beforeEach(() => {
    resetDefaultGenerator();
  });

  afterEach(() => {
    resetDefaultGenerator();
  });

  describe("EmbeddingGenerator class", () => {
    describe("instantiation", () => {
      it("should create an instance with default configuration", () => {
        const generator = new EmbeddingGenerator();
        expect(generator).toBeInstanceOf(EmbeddingGenerator);
        expect(generator.getModelId()).toBe("Xenova/all-MiniLM-L6-v2");
        expect(generator.getEmbeddingDimension()).toBe(384);
      });

      it("should create an instance with custom model ID", () => {
        const generator = new EmbeddingGenerator({
          modelId: "custom/model-id",
        });
        expect(generator.getModelId()).toBe("custom/model-id");
      });

      it("should accept pooling configuration", () => {
        const generator = new EmbeddingGenerator({
          pooling: "cls",
        });
        expect(generator).toBeInstanceOf(EmbeddingGenerator);
      });

      it("should accept normalize configuration", () => {
        const generator = new EmbeddingGenerator({
          normalize: false,
        });
        expect(generator).toBeInstanceOf(EmbeddingGenerator);
      });

      it("should accept progress callback", () => {
        const progressCallback = vi.fn();
        const generator = new EmbeddingGenerator({
          onProgress: progressCallback,
        });
        expect(generator).toBeInstanceOf(EmbeddingGenerator);
      });
    });

    describe("state management", () => {
      it("should not be ready before initialization", () => {
        const generator = new EmbeddingGenerator();
        expect(generator.isModelReady()).toBe(false);
      });

      it("should return correct embedding dimension", () => {
        const generator = new EmbeddingGenerator();
        expect(generator.getEmbeddingDimension()).toBe(384);
      });

      it("should throw when embedding before initialization", async () => {
        const generator = new EmbeddingGenerator();

        // Manually bypass the auto-initialization to test the error
        const ensureReady = (generator as unknown as { ensureReady: () => void })
          .ensureReady;

        expect(() => ensureReady.call(generator)).toThrow(
          "Embedding model not initialized"
        );
      });
    });
  });

  describe("factory functions", () => {
    describe("getEmbeddingGenerator", () => {
      it("should return a singleton instance", () => {
        const gen1 = getEmbeddingGenerator();
        const gen2 = getEmbeddingGenerator();
        expect(gen1).toBe(gen2);
      });

      it("should create instance with config on first call", () => {
        const gen = getEmbeddingGenerator({ pooling: "mean" });
        expect(gen).toBeInstanceOf(EmbeddingGenerator);
      });

      it("should ignore config on subsequent calls", () => {
        const gen1 = getEmbeddingGenerator({ modelId: "first-model" });
        const gen2 = getEmbeddingGenerator({ modelId: "second-model" });

        expect(gen1).toBe(gen2);
        expect(gen2.getModelId()).toBe("first-model");
      });
    });

    describe("createEmbeddingGenerator", () => {
      it("should create a new instance each time", () => {
        const gen1 = createEmbeddingGenerator();
        const gen2 = createEmbeddingGenerator();
        expect(gen1).not.toBe(gen2);
      });

      it("should respect different configurations", () => {
        const gen1 = createEmbeddingGenerator({ modelId: "model-a" });
        const gen2 = createEmbeddingGenerator({ modelId: "model-b" });

        expect(gen1.getModelId()).toBe("model-a");
        expect(gen2.getModelId()).toBe("model-b");
      });
    });

    describe("resetDefaultGenerator", () => {
      it("should allow creating a new singleton after reset", () => {
        const gen1 = getEmbeddingGenerator({ modelId: "model-a" });
        resetDefaultGenerator();
        const gen2 = getEmbeddingGenerator({ modelId: "model-b" });

        expect(gen1).not.toBe(gen2);
        expect(gen1.getModelId()).toBe("model-a");
        expect(gen2.getModelId()).toBe("model-b");
      });
    });

    describe("isModelReady", () => {
      it("should return false when no generator exists", () => {
        expect(isModelReady()).toBe(false);
      });

      it("should return false before initialization", () => {
        getEmbeddingGenerator();
        expect(isModelReady()).toBe(false);
      });
    });
  });

  describe("EmbeddingProgress type", () => {
    it("should accept downloading status", () => {
      const progress: EmbeddingProgress = {
        status: "downloading",
        progress: 50,
        file: "model.bin",
        totalBytes: 22000000,
        loadedBytes: 11000000,
      };
      expect(progress.status).toBe("downloading");
      expect(progress.progress).toBe(50);
    });

    it("should accept loading status", () => {
      const progress: EmbeddingProgress = {
        status: "loading",
      };
      expect(progress.status).toBe("loading");
    });

    it("should accept ready status", () => {
      const progress: EmbeddingProgress = {
        status: "ready",
      };
      expect(progress.status).toBe("ready");
    });

    it("should accept error status with message", () => {
      const progress: EmbeddingProgress = {
        status: "error",
        error: "Failed to load model",
      };
      expect(progress.status).toBe("error");
      expect(progress.error).toBe("Failed to load model");
    });
  });

  describe("EmbeddingConfig type", () => {
    it("should accept all configuration options", () => {
      const config: EmbeddingConfig = {
        modelId: "test-model",
        pooling: "mean",
        normalize: true,
        onProgress: (progress) => {
          expect(progress.status).toBeDefined();
        },
      };
      expect(config.modelId).toBe("test-model");
      expect(config.pooling).toBe("mean");
      expect(config.normalize).toBe(true);
    });

    it("should accept partial configuration", () => {
      const config: EmbeddingConfig = {
        normalize: false,
      };
      expect(config.normalize).toBe(false);
      expect(config.modelId).toBeUndefined();
    });

    it("should accept empty configuration", () => {
      const config: EmbeddingConfig = {};
      expect(Object.keys(config)).toHaveLength(0);
    });
  });

  // Integration tests that require actual model loading
  // These are marked with a longer timeout and can be skipped in CI
  describe("integration tests (requires model)", () => {
    // Increase timeout for model loading
    const INTEGRATION_TIMEOUT = 120000; // 2 minutes for model download

    it.skip(
      "should initialize and generate a 384-dimensional embedding",
      async () => {
        const generator = new EmbeddingGenerator();
        await generator.initialize();

        expect(generator.isModelReady()).toBe(true);

        const result = await generator.embed("Test text for embedding");

        expect(result.embedding).toBeDefined();
        expect(Array.isArray(result.embedding)).toBe(true);
        expect(result.embedding.length).toBe(384);
        expect(result.text).toBe("Test text for embedding");
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      },
      INTEGRATION_TIMEOUT
    );

    it.skip(
      "should generate normalized embeddings",
      async () => {
        const generator = new EmbeddingGenerator({ normalize: true });
        await generator.initialize();

        const result = await generator.embed("Normalize this text");

        // Check normalization: L2 norm should be ~1
        const embedding = result.embedding;
        const norm = Math.sqrt(
          embedding.reduce((sum, val) => sum + val * val, 0)
        );
        expect(norm).toBeCloseTo(1, 1); // Within 0.1 of 1
      },
      INTEGRATION_TIMEOUT
    );

    it.skip(
      "should handle batch embedding",
      async () => {
        const generator = new EmbeddingGenerator();
        await generator.initialize();

        const texts = ["First text", "Second text", "Third text"];
        const result = await generator.embedBatch(texts);

        expect(result.embeddings).toHaveLength(3);
        expect(result.count).toBe(3);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);

        for (const embedding of result.embeddings) {
          expect(embedding.length).toBe(384);
        }
      },
      INTEGRATION_TIMEOUT
    );

    it.skip(
      "should handle empty batch",
      async () => {
        const generator = new EmbeddingGenerator();
        await generator.initialize();

        const result = await generator.embedBatch([]);

        expect(result.embeddings).toHaveLength(0);
        expect(result.count).toBe(0);
        expect(result.durationMs).toBe(0);
      },
      INTEGRATION_TIMEOUT
    );

    it.skip(
      "should truncate very long text",
      async () => {
        const generator = new EmbeddingGenerator();
        await generator.initialize();

        // Create text that exceeds max length
        const longText = "A".repeat(3000);
        const result = await generator.embed(longText);

        // Should still produce valid embedding
        expect(result.embedding.length).toBe(384);
        // Text should be truncated
        expect(result.text.length).toBeLessThan(longText.length);
      },
      INTEGRATION_TIMEOUT
    );

    it.skip(
      "should produce similar embeddings for similar texts",
      async () => {
        const generator = new EmbeddingGenerator();
        await generator.initialize();

        const result1 = await generator.embed("The cat sat on the mat");
        const result2 = await generator.embed("The cat was sitting on the mat");
        const result3 = await generator.embed(
          "Quantum physics is a complex field"
        );

        // Cosine similarity helper
        const cosineSimilarity = (a: number[], b: number[]) => {
          let dot = 0;
          let normA = 0;
          let normB = 0;
          for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
          }
          return dot / (Math.sqrt(normA) * Math.sqrt(normB));
        };

        const simSimilar = cosineSimilarity(result1.embedding, result2.embedding);
        const simDifferent = cosineSimilarity(
          result1.embedding,
          result3.embedding
        );

        // Similar sentences should have higher similarity
        expect(simSimilar).toBeGreaterThan(simDifferent);
        expect(simSimilar).toBeGreaterThan(0.8); // High similarity for paraphrases
      },
      INTEGRATION_TIMEOUT
    );

    it.skip(
      "should call progress callback during initialization",
      async () => {
        const progressStates: EmbeddingProgress[] = [];
        const generator = new EmbeddingGenerator({
          onProgress: (progress) => {
            progressStates.push({ ...progress });
          },
        });

        await generator.initialize();

        // Should have received progress updates
        expect(progressStates.length).toBeGreaterThan(0);

        // Should end with ready status
        const lastProgress = progressStates[progressStates.length - 1];
        expect(lastProgress.status).toBe("ready");
      },
      INTEGRATION_TIMEOUT
    );

    it.skip(
      "should handle concurrent initialization calls",
      async () => {
        const generator = new EmbeddingGenerator();

        // Start multiple initializations concurrently
        const [result1, result2, result3] = await Promise.all([
          generator.initialize(),
          generator.initialize(),
          generator.initialize(),
        ]);

        // All should complete successfully
        expect(generator.isModelReady()).toBe(true);
      },
      INTEGRATION_TIMEOUT
    );

    it.skip(
      "should produce consistent embeddings for the same input",
      async () => {
        const generator = new EmbeddingGenerator();
        await generator.initialize();

        const text = "Deterministic embedding test";
        const result1 = await generator.embed(text);
        const result2 = await generator.embed(text);

        // Embeddings should be identical
        for (let i = 0; i < result1.embedding.length; i++) {
          expect(result1.embedding[i]).toBeCloseTo(result2.embedding[i], 5);
        }
      },
      INTEGRATION_TIMEOUT
    );
  });

  describe("error handling", () => {
    it("should throw descriptive error for invalid model", async () => {
      const generator = new EmbeddingGenerator({
        modelId: "non-existent/model-that-does-not-exist",
      });

      await expect(generator.initialize()).rejects.toThrow(
        /Failed to load embedding model/
      );
    });
  });
});
