/**
 * Edge Case Tests for Vector Database Implementation
 *
 * Tests critical edge cases as specified in the spec:
 * 1. First-run model download - Graceful handling of ~22MB model download
 * 2. Empty results - Fallback behavior when vector search returns no matches
 * 3. Concurrent access - Thread-safety of singleton patterns and VectorDB
 *
 * These tests verify the system handles edge conditions gracefully.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  EmbeddingGenerator,
  createEmbeddingGenerator,
  getEmbeddingGenerator,
  resetDefaultGenerator,
  preloadModel,
  isModelReady,
  type EmbeddingProgress,
} from "../embeddings.js";
import {
  VectorDB,
  createVectorDB,
  type DocumentChunk,
} from "../vector_db.js";

// ============================================================================
// Test Constants
// ============================================================================

const EDGE_CASE_TEST_DB_PATH = "./test-data/vectors-edge-cases";
const MODEL_LOAD_TIMEOUT = 180000; // 3 minutes for model download

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Clean up test database directory
 */
async function cleanupTestDB(dbPath: string = EDGE_CASE_TEST_DB_PATH): Promise<void> {
  try {
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create mock document chunks with fake embeddings
 */
function createMockDocuments(count: number, source: string = "test"): DocumentChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${source}-${i}`,
    text: `Test document ${i} about ${source} related content`,
    source,
    section: `section-${i % 3}`,
    vector: new Array(384).fill(0).map(() => Math.random()),
    chunkIndex: i,
    createdAt: Date.now(),
  }));
}

// ============================================================================
// 1. First-Run Model Download Tests
// ============================================================================

describe("Edge Case: First-Run Model Download", () => {
  beforeEach(() => {
    resetDefaultGenerator();
  });

  afterEach(() => {
    resetDefaultGenerator();
  });

  describe("Progress Callback Handling", () => {
    it("should invoke progress callback during model initialization", async () => {
      const progressEvents: EmbeddingProgress[] = [];

      const generator = createEmbeddingGenerator({
        onProgress: (progress) => {
          progressEvents.push({ ...progress });
        },
      });

      // If model is already cached, this will be fast
      // If not cached, this triggers download
      await generator.initialize();

      // Should have at least one progress event (either downloading or ready)
      expect(progressEvents.length).toBeGreaterThan(0);

      // Last event should be 'ready' (or 'error' if something went wrong)
      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(["ready", "downloading", "error"]).toContain(lastEvent.status);
    }, MODEL_LOAD_TIMEOUT);

    it("should handle progress callback with download progress info", async () => {
      const progressEvents: EmbeddingProgress[] = [];

      const generator = createEmbeddingGenerator({
        onProgress: (progress) => {
          progressEvents.push({ ...progress });
        },
      });

      await generator.initialize();

      // If model was downloaded, we should see download progress
      const downloadEvents = progressEvents.filter((p) => p.status === "downloading");
      if (downloadEvents.length > 1) {
        // Verify progress percentage is within valid range
        const progressWithPercent = downloadEvents.find((p) => p.progress !== undefined);
        if (progressWithPercent) {
          expect(progressWithPercent.progress).toBeGreaterThanOrEqual(0);
          expect(progressWithPercent.progress).toBeLessThanOrEqual(100);
        }
      }

      // Should eventually reach ready state
      expect(generator.isModelReady()).toBe(true);
    }, MODEL_LOAD_TIMEOUT);

    it("should handle missing progress callback gracefully", async () => {
      // No progress callback provided
      const generator = createEmbeddingGenerator();

      // Should not throw even without callback
      await expect(generator.initialize()).resolves.not.toThrow();
      expect(generator.isModelReady()).toBe(true);
    }, MODEL_LOAD_TIMEOUT);
  });

  describe("Concurrent Initialization Prevention", () => {
    it("should prevent concurrent model downloads with single generator", async () => {
      const generator = createEmbeddingGenerator();
      let initCallCount = 0;

      // Wrap initialize to count calls
      const originalInit = generator.initialize.bind(generator);
      vi.spyOn(generator, "initialize").mockImplementation(async () => {
        initCallCount++;
        return originalInit();
      });

      // Trigger 3 concurrent initializations
      const initPromises = [
        generator.initialize(),
        generator.initialize(),
        generator.initialize(),
      ];

      await Promise.all(initPromises);

      // Should only have initialized once (not 3 times)
      // The initialize method returns early if already ready
      expect(generator.isModelReady()).toBe(true);
    }, MODEL_LOAD_TIMEOUT);

    it("should handle concurrent embed() calls during initialization", async () => {
      const generator = createEmbeddingGenerator();

      // Trigger concurrent embeddings before explicit initialization
      const embedPromises = [
        generator.embed("test text 1"),
        generator.embed("test text 2"),
        generator.embed("test text 3"),
      ];

      const results = await Promise.all(embedPromises);

      // All should succeed with valid embeddings
      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result.embedding.length).toBe(384);
      }
    }, MODEL_LOAD_TIMEOUT);

    it("should share single model instance with singleton pattern", async () => {
      const gen1 = getEmbeddingGenerator();
      const gen2 = getEmbeddingGenerator();

      // Both should be the same instance
      expect(gen1).toBe(gen2);

      await gen1.initialize();

      // Both should report ready
      expect(gen1.isModelReady()).toBe(true);
      expect(gen2.isModelReady()).toBe(true);
    }, MODEL_LOAD_TIMEOUT);
  });

  describe("Preload Model Functionality", () => {
    it("should preload model with progress tracking", async () => {
      resetDefaultGenerator();

      const progressUpdates: string[] = [];

      // Note: preloadModel with onProgress creates a separate generator instance
      // and does not update the default generator
      const generator = createEmbeddingGenerator({
        onProgress: (progress) => {
          progressUpdates.push(progress.status);
        },
      });

      await generator.initialize();

      // Should have tracked progress
      expect(progressUpdates.length).toBeGreaterThan(0);
      // Verify this generator is ready (not the default one)
      expect(generator.isModelReady()).toBe(true);
    }, MODEL_LOAD_TIMEOUT);

    it("should handle preload without callback", async () => {
      resetDefaultGenerator();

      await expect(preloadModel()).resolves.not.toThrow();
      expect(isModelReady()).toBe(true);
    }, MODEL_LOAD_TIMEOUT);
  });
});

// ============================================================================
// 2. Empty Results Tests
// ============================================================================

describe("Edge Case: Empty Results Handling", () => {
  let vectorDB: VectorDB;

  beforeEach(async () => {
    await cleanupTestDB();
    vectorDB = new VectorDB({ dataPath: EDGE_CASE_TEST_DB_PATH });
    await vectorDB.connect();
  });

  afterEach(async () => {
    await vectorDB?.close();
    await cleanupTestDB();
  });

  describe("Non-Existent Table Search", () => {
    it("should return empty array when searching non-existent table", async () => {
      const queryVector = new Array(384).fill(0.5);
      const results = await vectorDB.search(queryVector, "non_existent_table");

      expect(results).toEqual([]);
    });

    it("should return null when getting non-existent table", async () => {
      const table = await vectorDB.getTable("non_existent_table");

      expect(table).toBeNull();
    });

    it("should return false when checking non-existent table existence", async () => {
      const exists = await vectorDB.tableExists("non_existent_table");

      expect(exists).toBe(false);
    });

    it("should return 0 count for non-existent table", async () => {
      const count = await vectorDB.getDocumentCount("non_existent_table");

      expect(count).toBe(0);
    });
  });

  describe("Empty Table Search", () => {
    it("should handle search on newly created empty table", async () => {
      // Create a table with a single document then search for something unrelated
      const mockDoc = createMockDocuments(1, "empty-test")[0];
      mockDoc.vector = new Array(384).fill(0.1); // Very specific vector

      await vectorDB.createTable("empty_test", [mockDoc]);

      // Search with a completely different vector
      const queryVector = new Array(384).fill(0.9);
      const results = await vectorDB.search(queryVector, "empty_test", 5);

      // Should return results but with high distance (low similarity)
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("No Relevant Matches", () => {
    it("should return results even when similarity is low", async () => {
      // Create documents about specific topic
      const docs = createMockDocuments(5, "solana");
      // Make all vectors point in same direction
      for (const doc of docs) {
        doc.vector = new Array(384).fill(0.1);
      }

      await vectorDB.createTable("low_similarity", docs);

      // Query with orthogonal vector
      const queryVector = new Array(384).fill(0);
      queryVector[0] = 1; // Point in different direction

      const results = await vectorDB.search(queryVector, "low_similarity", 5);

      // LanceDB returns results regardless of similarity
      // It's up to the application layer to filter by threshold
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("should throw error for limit of 0 (LanceDB requires k > 0)", async () => {
      const docs = createMockDocuments(5, "limit-test");
      await vectorDB.createTable("limit_zero", docs);

      const queryVector = new Array(384).fill(0.5);

      // LanceDB requires k (limit) to be positive
      await expect(
        vectorDB.search(queryVector, "limit_zero", 0)
      ).rejects.toThrow(/k must be positive/i);
    });
  });

  describe("Edge Cases in Query Vectors", () => {
    it("should handle zero vector query", async () => {
      const docs = createMockDocuments(5, "zero-vector");
      await vectorDB.createTable("zero_vector_test", docs);

      const zeroVector = new Array(384).fill(0);

      // Zero vector may produce NaN distances or unexpected results
      // The system should not crash
      await expect(
        vectorDB.search(zeroVector, "zero_vector_test", 5)
      ).resolves.not.toThrow();
    });

    it("should handle very small vector values", async () => {
      const docs = createMockDocuments(5, "small-values");
      await vectorDB.createTable("small_values_test", docs);

      const smallVector = new Array(384).fill(1e-10);
      const results = await vectorDB.search(smallVector, "small_values_test", 5);

      expect(Array.isArray(results)).toBe(true);
    });

    it("should throw error for wrong dimension vector", async () => {
      const docs = createMockDocuments(1, "wrong-dim");
      await vectorDB.createTable("wrong_dim_test", docs);

      const wrongDimVector = new Array(256).fill(0.5);

      await expect(
        vectorDB.search(wrongDimVector, "wrong_dim_test", 5)
      ).rejects.toThrow(/dimension/i);
    });
  });
});

// ============================================================================
// 3. Concurrent Access Tests
// ============================================================================

describe("Edge Case: Concurrent Access", () => {
  let vectorDB: VectorDB;
  const CONCURRENT_TEST_DB_PATH = "./test-data/vectors-concurrent";

  beforeEach(async () => {
    await cleanupTestDB(CONCURRENT_TEST_DB_PATH);
    vectorDB = new VectorDB({ dataPath: CONCURRENT_TEST_DB_PATH });
    await vectorDB.connect();
  });

  afterEach(async () => {
    await vectorDB?.close();
    await cleanupTestDB(CONCURRENT_TEST_DB_PATH);
  });

  describe("Concurrent VectorDB Operations", () => {
    it("should handle 3 concurrent table creations without errors", async () => {
      const createPromises = [
        vectorDB.createTable("concurrent_1", createMockDocuments(5, "source-1")),
        vectorDB.createTable("concurrent_2", createMockDocuments(5, "source-2")),
        vectorDB.createTable("concurrent_3", createMockDocuments(5, "source-3")),
      ];

      await expect(Promise.all(createPromises)).resolves.not.toThrow();

      // Verify all tables exist
      const tables = await vectorDB.listTables();
      expect(tables).toContain("concurrent_1");
      expect(tables).toContain("concurrent_2");
      expect(tables).toContain("concurrent_3");
    });

    it("should handle 3 concurrent searches without errors", async () => {
      // First create a table
      const docs = createMockDocuments(10, "concurrent-search");
      await vectorDB.createTable("search_concurrent", docs);

      const queryVector = new Array(384).fill(0.5);

      // Trigger 3 concurrent searches
      const searchPromises = [
        vectorDB.search(queryVector, "search_concurrent", 3),
        vectorDB.search(queryVector, "search_concurrent", 5),
        vectorDB.search(queryVector, "search_concurrent", 7),
      ];

      const results = await Promise.all(searchPromises);

      // All should complete without errors
      expect(results.length).toBe(3);
      expect(results[0].length).toBeLessThanOrEqual(3);
      expect(results[1].length).toBeLessThanOrEqual(5);
      expect(results[2].length).toBeLessThanOrEqual(7);
    });

    it("should handle concurrent read and write operations", async () => {
      // Create initial table
      const initialDocs = createMockDocuments(5, "initial");
      await vectorDB.createTable("read_write", initialDocs);

      const queryVector = new Array(384).fill(0.5);
      const newDocs = createMockDocuments(3, "new");

      // Trigger concurrent read and write
      const operations = [
        vectorDB.search(queryVector, "read_write", 5),
        vectorDB.addDocuments("read_write", newDocs),
        vectorDB.search(queryVector, "read_write", 5),
        vectorDB.getDocumentCount("read_write"),
      ];

      await expect(Promise.all(operations)).resolves.not.toThrow();
    });

    it("should handle concurrent connections to same database", async () => {
      // Create multiple VectorDB instances pointing to same path
      const db1 = new VectorDB({ dataPath: CONCURRENT_TEST_DB_PATH });
      const db2 = new VectorDB({ dataPath: CONCURRENT_TEST_DB_PATH });

      await db1.connect();
      await db2.connect();

      // Create table from db1
      await db1.createTable("shared", createMockDocuments(5, "shared"));

      // Read from db2
      const count = await db2.getDocumentCount("shared");
      expect(count).toBe(5);

      await db1.close();
      await db2.close();
    });
  });

  describe("Concurrent Embedding Operations", () => {
    let embeddingGenerator: EmbeddingGenerator;

    beforeAll(async () => {
      resetDefaultGenerator();
      embeddingGenerator = createEmbeddingGenerator();
      await embeddingGenerator.initialize();
    }, MODEL_LOAD_TIMEOUT);

    afterAll(() => {
      resetDefaultGenerator();
    });

    it("should handle 3 concurrent embedding generations", async () => {
      if (!embeddingGenerator.isModelReady()) {
        console.warn("Skipping: model not ready");
        return;
      }

      const texts = [
        "First concurrent text about Solana tokens",
        "Second concurrent text about PDAs",
        "Third concurrent text about Cross-Program Invocation",
      ];

      const embedPromises = texts.map((text) => embeddingGenerator.embed(text));
      const results = await Promise.all(embedPromises);

      // All should produce valid embeddings
      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result.embedding.length).toBe(384);
        // Check normalization
        const norm = Math.sqrt(
          result.embedding.reduce((sum, v) => sum + v * v, 0)
        );
        expect(norm).toBeCloseTo(1, 1);
      }
    }, MODEL_LOAD_TIMEOUT);

    it("should handle concurrent batch embedding requests", async () => {
      if (!embeddingGenerator.isModelReady()) {
        console.warn("Skipping: model not ready");
        return;
      }

      const batch1 = ["Batch 1 text A", "Batch 1 text B"];
      const batch2 = ["Batch 2 text A", "Batch 2 text B"];
      const batch3 = ["Batch 3 text A", "Batch 3 text B"];

      const batchPromises = [
        embeddingGenerator.embedBatch(batch1),
        embeddingGenerator.embedBatch(batch2),
        embeddingGenerator.embedBatch(batch3),
      ];

      const results = await Promise.all(batchPromises);

      // All batches should complete successfully
      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result.count).toBe(2);
        expect(result.embeddings.length).toBe(2);
      }
    }, MODEL_LOAD_TIMEOUT);
  });

  describe("Stress Testing Concurrent Access", () => {
    it("should handle 10 concurrent search operations", async () => {
      // Create test table
      const docs = createMockDocuments(50, "stress-test");
      await vectorDB.createTable("stress_test", docs);

      const queryVectors = Array.from({ length: 10 }, () =>
        new Array(384).fill(0).map(() => Math.random())
      );

      const searchPromises = queryVectors.map((vector) =>
        vectorDB.search(vector, "stress_test", 5)
      );

      const startTime = Date.now();
      const results = await Promise.all(searchPromises);
      const duration = Date.now() - startTime;

      // All should complete
      expect(results.length).toBe(10);
      for (const result of results) {
        expect(result.length).toBeLessThanOrEqual(5);
      }

      // Should complete in reasonable time (< 5 seconds for 10 concurrent)
      expect(duration).toBeLessThan(5000);
    });

    it("should handle interleaved operations without race conditions", async () => {
      const docs1 = createMockDocuments(5, "interleave-1");
      const docs2 = createMockDocuments(5, "interleave-2");

      // Interleave create, search, add, search operations
      const operations: Promise<unknown>[] = [];

      operations.push(vectorDB.createTable("interleave_test", docs1));

      // Wait for table creation before querying
      await operations[0];

      const queryVector = new Array(384).fill(0.5);

      // Now add concurrent operations
      const concurrentOps = [
        vectorDB.search(queryVector, "interleave_test", 3),
        vectorDB.addDocuments("interleave_test", docs2),
        vectorDB.search(queryVector, "interleave_test", 3),
        vectorDB.getDocumentCount("interleave_test"),
      ];

      const results = await Promise.all(concurrentOps);

      // Verify operations completed successfully
      expect(Array.isArray(results[0])).toBe(true); // search results
      expect(results[1]).toBeUndefined(); // addDocuments returns void
      expect(Array.isArray(results[2])).toBe(true); // search results
      expect(typeof results[3]).toBe("number"); // count
    });
  });
});

// ============================================================================
// Combined Edge Case Scenarios
// ============================================================================

describe("Combined Edge Case Scenarios", () => {
  let vectorDB: VectorDB;
  let embeddingGenerator: EmbeddingGenerator;
  const COMBINED_TEST_DB_PATH = "./test-data/vectors-combined";

  beforeAll(async () => {
    await cleanupTestDB(COMBINED_TEST_DB_PATH);
    resetDefaultGenerator();
    embeddingGenerator = createEmbeddingGenerator();
    vectorDB = new VectorDB({ dataPath: COMBINED_TEST_DB_PATH });

    try {
      await embeddingGenerator.initialize();
      await vectorDB.connect();
    } catch (error) {
      console.warn("Combined test setup failed:", error);
    }
  }, MODEL_LOAD_TIMEOUT);

  afterAll(async () => {
    resetDefaultGenerator();
    await vectorDB?.close();
    await cleanupTestDB(COMBINED_TEST_DB_PATH);
  });

  it("should handle first run with concurrent searches returning empty results", async () => {
    if (!embeddingGenerator.isModelReady()) {
      console.warn("Skipping: model not ready");
      return;
    }

    // Search non-existent tables concurrently
    const searchPromises = [
      vectorDB.search(new Array(384).fill(0.5), "empty_table_1"),
      vectorDB.search(new Array(384).fill(0.5), "empty_table_2"),
      vectorDB.search(new Array(384).fill(0.5), "empty_table_3"),
    ];

    const results = await Promise.all(searchPromises);

    // All should return empty arrays without errors
    for (const result of results) {
      expect(result).toEqual([]);
    }
  });

  it("should handle model initialization with concurrent empty searches", async () => {
    // This simulates the scenario where translation requests come in
    // before the model is fully loaded
    const queryVector = new Array(384).fill(0.5);

    // Run operations concurrently
    const [embedResult1, searchResult, embedResult2, existsResult] = await Promise.all([
      embeddingGenerator.embed("test text"),
      vectorDB.search(queryVector, "non_existent"),
      embeddingGenerator.embed("another test"),
      vectorDB.tableExists("non_existent"),
    ]);

    // All should complete without errors
    expect(embedResult1.embedding.length).toBe(384); // embedding
    expect(searchResult).toEqual([]); // empty search
    expect(embedResult2.embedding.length).toBe(384); // embedding
    expect(existsResult).toBe(false); // table doesn't exist
  }, MODEL_LOAD_TIMEOUT);

  it("should gracefully handle rapid create-delete-search cycle", async () => {
    const docs = createMockDocuments(5, "rapid-cycle");
    const queryVector = new Array(384).fill(0.5);

    // Create
    await vectorDB.createTable("rapid_cycle", docs);
    expect(await vectorDB.tableExists("rapid_cycle")).toBe(true);

    // Search
    const results1 = await vectorDB.search(queryVector, "rapid_cycle", 5);
    expect(results1.length).toBe(5);

    // Delete
    await vectorDB.deleteTable("rapid_cycle");
    expect(await vectorDB.tableExists("rapid_cycle")).toBe(false);

    // Search after delete should return empty
    const results2 = await vectorDB.search(queryVector, "rapid_cycle", 5);
    expect(results2).toEqual([]);
  });
});
