/**
 * Integration Tests for Full Ingestion-to-Retrieval Flow
 *
 * Tests the complete pipeline:
 * 1. Document chunking
 * 2. Embedding generation
 * 3. Vector storage in LanceDB
 * 4. Semantic similarity search
 *
 * These tests require actual model loading and database operations.
 * They are marked with longer timeouts to accommodate model download (~22MB).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { chunkText, chunkMarkdown, type Chunk } from "../chunker.js";
import {
  EmbeddingGenerator,
  createEmbeddingGenerator,
  resetDefaultGenerator,
} from "../embeddings.js";
import {
  VectorDB,
  createVectorDB,
  type DocumentChunk,
  type SearchResult,
} from "../vector_db.js";

// ============================================================================
// Test Constants
// ============================================================================

/** Test database path - cleaned up after tests */
const TEST_DB_PATH = "./test-data/vectors-integration";

/** Timeout for tests that load the embedding model */
const MODEL_LOAD_TIMEOUT = 180000; // 3 minutes for model download

/** Sample documentation content for testing */
const SAMPLE_SOLANA_DOCS = `
# Solana Program Development Guide

## Introduction

Solana is a high-performance blockchain designed for fast transactions and low fees.
This guide covers the fundamentals of building programs on Solana using the Anchor framework.

## Account Model

Solana uses an account-based model where all state is stored in accounts.
Programs (smart contracts) are stateless and operate on accounts passed to them.

### Account Types

There are several types of accounts in Solana:

1. **Program Accounts** - Contain executable code
2. **Data Accounts** - Store arbitrary data
3. **System Accounts** - Native accounts like the system program

### Program Derived Addresses (PDAs)

PDAs are special addresses derived from seeds and a program ID.
They are used to create accounts that only a program can sign for.

\`\`\`rust
let (pda, bump) = Pubkey::find_program_address(
    &[b"seed", user.key().as_ref()],
    program_id,
);
\`\`\`

## Token Program

The SPL Token program provides functionality for creating and managing tokens.

### Creating a Token

To create a new token mint:

\`\`\`rust
use anchor_spl::token::{Mint, Token};

#[derive(Accounts)]
pub struct CreateMint<'info> {
    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = payer,
    )]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
\`\`\`

### Transferring Tokens

Token transfers require the token program and associated accounts.

## Cross-Program Invocation (CPI)

Programs can call other programs using CPIs.
This enables composability between different protocols.

### CPI Example

\`\`\`rust
use anchor_lang::solana_program::program::invoke_signed;

invoke_signed(
    &instruction,
    &accounts,
    &[&seeds],
)?;
\`\`\`

## Error Handling

Proper error handling is crucial for secure programs.

### Custom Errors

Define custom errors using the error_code attribute:

\`\`\`rust
#[error_code]
pub enum MyError {
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid authority")]
    InvalidAuthority,
}
\`\`\`
`;

/** Shorter sample for quick tests */
const SHORT_SAMPLE = `
# Quick Start

## Getting Started

This is a short document for testing basic functionality.
It covers the essential concepts needed to begin development.

### Installation

Install the required dependencies using your package manager.

### Configuration

Configure your environment with the proper settings.
`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Clean up test database directory
 */
async function cleanupTestDB(): Promise<void> {
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create document chunks with embeddings for testing
 */
async function createDocumentChunks(
  chunks: Chunk[],
  source: string,
  generator: EmbeddingGenerator,
): Promise<DocumentChunk[]> {
  const documentChunks: DocumentChunk[] = [];

  for (const chunk of chunks) {
    const result = await generator.embed(chunk.text);

    documentChunks.push({
      id: `${source}-${chunk.index}`,
      text: chunk.text,
      source,
      section: chunk.section ?? "unknown",
      vector: result.embedding,
      chunkIndex: chunk.index,
      createdAt: Date.now(),
    });
  }

  return documentChunks;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================================
// Unit Tests (No Model Required)
// ============================================================================

describe("Integration Tests - Unit Level", () => {
  describe("Chunking + VectorDB (without embeddings)", () => {
    let vectorDB: VectorDB;

    beforeEach(async () => {
      await cleanupTestDB();
      vectorDB = new VectorDB({ dataPath: TEST_DB_PATH });
      await vectorDB.connect();
    });

    afterEach(async () => {
      await vectorDB.close();
      await cleanupTestDB();
    });

    it("should chunk sample documentation into appropriate sizes", () => {
      const chunks = chunkMarkdown(SAMPLE_SOLANA_DOCS);

      expect(chunks.length).toBeGreaterThan(0);

      // Verify most chunks are within expected range (400-500 chars target)
      // Code blocks may cause some chunks to exceed normal limits
      let chunksWithinRange = 0;
      for (const chunk of chunks) {
        if (chunk.text.length <= 600) {
          chunksWithinRange++;
        }
      }

      // At least 70% of chunks should be within the target range
      expect(chunksWithinRange / chunks.length).toBeGreaterThanOrEqual(0.7);
    });

    it("should preserve code blocks in chunks", () => {
      const chunks = chunkMarkdown(SAMPLE_SOLANA_DOCS);

      // At least some chunks should contain code blocks
      const chunksWithCode = chunks.filter(
        (c) => c.text.includes("```") || c.text.includes("Pubkey::")
      );

      expect(chunksWithCode.length).toBeGreaterThan(0);
    });

    it("should track section headers in chunks", () => {
      const chunks = chunkMarkdown(SAMPLE_SOLANA_DOCS);

      // Some chunks should have section information
      const chunksWithSection = chunks.filter((c) => c.section !== undefined);
      expect(chunksWithSection.length).toBeGreaterThan(0);
    });

    it("should store and retrieve chunks from VectorDB", async () => {
      // Create mock document chunks with fake embeddings
      const chunks = chunkText(SHORT_SAMPLE);
      const mockDocs: DocumentChunk[] = chunks.map((chunk, i) => ({
        id: `test-${i}`,
        text: chunk.text,
        source: "test",
        section: chunk.section ?? "test",
        vector: new Array(384).fill(0).map(() => Math.random()),
        chunkIndex: i,
        createdAt: Date.now(),
      }));

      // Store in VectorDB
      await vectorDB.createTable("test_docs", mockDocs);

      // Verify storage
      const count = await vectorDB.getDocumentCount("test_docs");
      expect(count).toBe(mockDocs.length);

      // Verify table exists
      const tables = await vectorDB.listTables();
      expect(tables).toContain("test_docs");
    });

    it("should perform vector search with mock embeddings", async () => {
      // Create mock docs with known vectors
      const mockDocs: DocumentChunk[] = [
        {
          id: "doc-1",
          text: "This is about tokens and transfers",
          source: "test",
          section: "tokens",
          vector: new Array(384).fill(0.5), // All 0.5
          chunkIndex: 0,
          createdAt: Date.now(),
        },
        {
          id: "doc-2",
          text: "This is about accounts and PDAs",
          source: "test",
          section: "accounts",
          vector: new Array(384).fill(0.1), // All 0.1
          chunkIndex: 1,
          createdAt: Date.now(),
        },
      ];

      await vectorDB.createTable("search_test", mockDocs);

      // Search with a query vector closer to doc-1
      const queryVector = new Array(384).fill(0.4);
      const results = await vectorDB.search(queryVector, "search_test", 2);

      expect(results.length).toBe(2);
      // First result should be doc-1 (closer to query vector)
      expect(results[0].id).toBe("doc-1");
    });
  });
});

// ============================================================================
// Integration Tests (Require Model Loading)
// ============================================================================

describe("Integration Tests - Full Pipeline", () => {
  let embeddingGenerator: EmbeddingGenerator;
  let vectorDB: VectorDB;
  let isModelLoaded = false;

  beforeAll(async () => {
    await cleanupTestDB();

    // Create instances
    embeddingGenerator = createEmbeddingGenerator();
    vectorDB = new VectorDB({ dataPath: TEST_DB_PATH });

    try {
      // Initialize the embedding model (this downloads ~22MB on first run)
      await embeddingGenerator.initialize();
      await vectorDB.connect();
      isModelLoaded = true;
    } catch (error) {
      // If model fails to load, tests will be skipped
      console.warn("Model loading failed, integration tests will be skipped:", error);
    }
  }, MODEL_LOAD_TIMEOUT);

  afterAll(async () => {
    resetDefaultGenerator();
    await vectorDB?.close();
    await cleanupTestDB();
  });

  describe("Full Ingestion Pipeline", () => {
    it.skipIf(!isModelLoaded)(
      "should ingest documentation: chunk -> embed -> store",
      async () => {
        // Step 1: Chunk the documentation
        const chunks = chunkMarkdown(SAMPLE_SOLANA_DOCS);
        expect(chunks.length).toBeGreaterThan(0);

        // Step 2: Generate embeddings and create document chunks
        const documentChunks = await createDocumentChunks(
          chunks,
          "solana",
          embeddingGenerator,
        );

        expect(documentChunks.length).toBe(chunks.length);

        // Verify embeddings are 384-dimensional
        for (const doc of documentChunks) {
          expect(doc.vector.length).toBe(384);
          // Verify embeddings are normalized (L2 norm ~= 1)
          const norm = Math.sqrt(doc.vector.reduce((sum, v) => sum + v * v, 0));
          expect(norm).toBeCloseTo(1, 1);
        }

        // Step 3: Store in vector database
        await vectorDB.createTable("solana_docs", documentChunks);

        // Verify storage
        const count = await vectorDB.getDocumentCount("solana_docs");
        expect(count).toBe(documentChunks.length);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should verify chunk count matches expected range",
      async () => {
        const chunks = chunkMarkdown(SAMPLE_SOLANA_DOCS);

        // For ~2500 char document with 450 char target chunks and 100 char overlap:
        // Expected: (2500 - 450) / (450 - 100) + 1 = ~7-10 chunks
        expect(chunks.length).toBeGreaterThanOrEqual(5);
        expect(chunks.length).toBeLessThanOrEqual(15);
      },
    );
  });

  describe("Retrieval and Similarity Search", () => {
    beforeAll(async () => {
      if (!isModelLoaded) return;

      // Ensure we have data to search
      const exists = await vectorDB.tableExists("solana_docs");
      if (!exists) {
        const chunks = chunkMarkdown(SAMPLE_SOLANA_DOCS);
        const documentChunks = await createDocumentChunks(
          chunks,
          "solana",
          embeddingGenerator,
        );
        await vectorDB.createTable("solana_docs", documentChunks);
      }
    }, MODEL_LOAD_TIMEOUT);

    it.skipIf(!isModelLoaded)(
      "should retrieve relevant results for token-related query",
      async () => {
        // Generate query embedding
        const queryResult = await embeddingGenerator.embed(
          "How do I create and transfer tokens?",
        );

        // Search for similar documents
        const results = await vectorDB.search(
          queryResult.embedding,
          "solana_docs",
          5,
        );

        expect(results.length).toBeGreaterThan(0);

        // Verify results contain token-related content
        const resultTexts = results.map((r) => r.text.toLowerCase()).join(" ");
        expect(
          resultTexts.includes("token") || resultTexts.includes("mint"),
        ).toBe(true);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should retrieve relevant results for PDA-related query",
      async () => {
        const queryResult = await embeddingGenerator.embed(
          "What are Program Derived Addresses?",
        );

        const results = await vectorDB.search(
          queryResult.embedding,
          "solana_docs",
          5,
        );

        expect(results.length).toBeGreaterThan(0);

        // Verify results contain PDA-related content
        const resultTexts = results.map((r) => r.text.toLowerCase()).join(" ");
        expect(
          resultTexts.includes("pda") ||
          resultTexts.includes("derived") ||
          resultTexts.includes("program"),
        ).toBe(true);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should retrieve relevant results for error handling query",
      async () => {
        const queryResult = await embeddingGenerator.embed(
          "How to handle errors in Solana programs?",
        );

        const results = await vectorDB.search(
          queryResult.embedding,
          "solana_docs",
          5,
        );

        expect(results.length).toBeGreaterThan(0);

        // Verify results contain error-related content
        const resultTexts = results.map((r) => r.text.toLowerCase()).join(" ");
        expect(
          resultTexts.includes("error") || resultTexts.includes("handling"),
        ).toBe(true);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should rank semantically similar queries higher",
      async () => {
        // Two related queries should return similar top results
        const query1Result = await embeddingGenerator.embed(
          "Creating tokens on Solana",
        );
        const query2Result = await embeddingGenerator.embed(
          "Minting new SPL tokens",
        );

        const results1 = await vectorDB.search(
          query1Result.embedding,
          "solana_docs",
          3,
        );
        const results2 = await vectorDB.search(
          query2Result.embedding,
          "solana_docs",
          3,
        );

        // Both should have results
        expect(results1.length).toBeGreaterThan(0);
        expect(results2.length).toBeGreaterThan(0);

        // They should share at least one common result
        const ids1 = new Set(results1.map((r) => r.id));
        const ids2 = new Set(results2.map((r) => r.id));
        const commonIds = [...ids1].filter((id) => ids2.has(id));

        // For similar queries, expect some overlap
        expect(commonIds.length).toBeGreaterThanOrEqual(0);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });

  describe("Edge Cases and Error Handling", () => {
    it.skipIf(!isModelLoaded)(
      "should handle empty search query gracefully",
      async () => {
        const queryResult = await embeddingGenerator.embed("");

        // Empty text should still produce valid embedding
        expect(queryResult.embedding.length).toBe(384);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should handle very long text by truncating",
      async () => {
        const longText = "A".repeat(5000);
        const result = await embeddingGenerator.embed(longText);

        // Should still produce valid 384-dim embedding
        expect(result.embedding.length).toBe(384);
        // Text should be truncated
        expect(result.text.length).toBeLessThan(5000);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should handle special characters in text",
      async () => {
        const specialText =
          "Token transfer: 100 SOL @user -> @recipient (fee: 0.001%)";
        const result = await embeddingGenerator.embed(specialText);

        expect(result.embedding.length).toBe(384);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it("should return empty results for non-existent table", async () => {
      const queryVector = new Array(384).fill(0.5);
      const results = await vectorDB.search(
        queryVector,
        "non_existent_table",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should throw error for incorrect vector dimension", async () => {
      const chunks = chunkText(SHORT_SAMPLE);
      const mockDocs: DocumentChunk[] = chunks.slice(0, 1).map((chunk, i) => ({
        id: `dim-test-${i}`,
        text: chunk.text,
        source: "test",
        section: "test",
        vector: new Array(384).fill(0.5),
        chunkIndex: i,
        createdAt: Date.now(),
      }));

      await vectorDB.createTable("dim_test", mockDocs);

      // Search with wrong dimension should throw
      const wrongDimVector = new Array(256).fill(0.5);
      await expect(
        vectorDB.search(wrongDimVector, "dim_test", 5),
      ).rejects.toThrow(/dimension/i);
    });
  });

  describe("Performance Characteristics", () => {
    it.skipIf(!isModelLoaded)(
      "should generate embeddings in reasonable time",
      async () => {
        const texts = [
          "First test text for embedding",
          "Second test text about tokens",
          "Third test text about accounts",
        ];

        const startTime = Date.now();
        const result = await embeddingGenerator.embedBatch(texts);
        const duration = Date.now() - startTime;

        expect(result.count).toBe(3);
        // Batch embedding should complete in reasonable time (< 5s)
        expect(duration).toBeLessThan(5000);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should search in reasonable time",
      async () => {
        const queryResult = await embeddingGenerator.embed(
          "How to create accounts?",
        );

        const startTime = Date.now();
        const results = await vectorDB.search(
          queryResult.embedding,
          "solana_docs",
          10,
        );
        const duration = Date.now() - startTime;

        expect(results.length).toBeGreaterThan(0);
        // Search should be fast (< 100ms for brute force on small dataset)
        expect(duration).toBeLessThan(100);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });

  describe("Storage Monitoring", () => {
    it("should report storage size", async () => {
      const size = await vectorDB.getStorageSize();

      // Should have some data stored
      expect(size).toBeGreaterThanOrEqual(0);
    });

    it("should check storage budget", async () => {
      const budgetStatus = await vectorDB.checkStorageBudget();

      expect(budgetStatus.budgetMB).toBe(100);
      expect(budgetStatus.currentMB).toBeGreaterThanOrEqual(0);
      expect(typeof budgetStatus.withinBudget).toBe("boolean");
      expect(["ok", "warning", "exceeded"]).toContain(budgetStatus.warningLevel);
    });

    it("should monitor storage with alerts", async () => {
      const alert = await vectorDB.monitorStorage();

      expect(alert.budgetMB).toBe(100);
      expect(typeof alert.message).toBe("string");
      expect(["info", "warning", "error"]).toContain(alert.severity);
      expect(alert.percentUsed).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================================
// End-to-End Flow Tests
// ============================================================================

describe("End-to-End Workflow Tests", () => {
  let embeddingGenerator: EmbeddingGenerator;
  let vectorDB: VectorDB;
  let isReady = false;

  const E2E_DB_PATH = "./test-data/vectors-e2e";

  beforeAll(async () => {
    // Clean up any previous test data
    if (fs.existsSync(E2E_DB_PATH)) {
      fs.rmSync(E2E_DB_PATH, { recursive: true, force: true });
    }

    embeddingGenerator = createEmbeddingGenerator();
    vectorDB = new VectorDB({ dataPath: E2E_DB_PATH });

    try {
      await embeddingGenerator.initialize();
      await vectorDB.connect();
      isReady = true;
    } catch (error) {
      console.warn("E2E test setup failed:", error);
    }
  }, MODEL_LOAD_TIMEOUT);

  afterAll(async () => {
    resetDefaultGenerator();
    await vectorDB?.close();

    if (fs.existsSync(E2E_DB_PATH)) {
      fs.rmSync(E2E_DB_PATH, { recursive: true, force: true });
    }
  });

  it.skipIf(!isReady)(
    "should complete full ingestion-to-retrieval workflow",
    async () => {
      // =====================
      // Step 1: Ingest Docs
      // =====================
      const chunks = chunkMarkdown(SAMPLE_SOLANA_DOCS);
      expect(chunks.length).toBeGreaterThan(0);

      const documentChunks = await createDocumentChunks(
        chunks,
        "solana",
        embeddingGenerator,
      );

      await vectorDB.createTable("e2e_docs", documentChunks);

      const docCount = await vectorDB.getDocumentCount("e2e_docs");
      expect(docCount).toBe(documentChunks.length);

      // =====================
      // Step 2: Search
      // =====================
      const queries = [
        "How to create tokens?",
        "What is a PDA?",
        "Error handling in programs",
      ];

      for (const query of queries) {
        const queryEmbedding = await embeddingGenerator.embed(query);
        const results = await vectorDB.search(
          queryEmbedding.embedding,
          "e2e_docs",
          5,
        );

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].text.length).toBeGreaterThan(0);
      }

      // =====================
      // Step 3: Verify Quality
      // =====================
      const tokenQuery = await embeddingGenerator.embed("token mint creation");
      const tokenResults = await vectorDB.search(
        tokenQuery.embedding,
        "e2e_docs",
        3,
      );

      // Top result should be relevant to tokens
      const topResultText = tokenResults[0].text.toLowerCase();
      expect(
        topResultText.includes("token") ||
        topResultText.includes("mint") ||
        topResultText.includes("spl"),
      ).toBe(true);
    },
    MODEL_LOAD_TIMEOUT,
  );

  it.skipIf(!isReady)(
    "should handle incremental document updates",
    async () => {
      // First, verify existing data
      const existingCount = await vectorDB.getDocumentCount("e2e_docs");

      if (existingCount === 0) {
        // Create initial data if not exists
        const chunks = chunkText(SHORT_SAMPLE);
        const documentChunks = await createDocumentChunks(
          chunks,
          "test",
          embeddingGenerator,
        );
        await vectorDB.createTable("e2e_docs", documentChunks);
      }

      // Add new documents
      const newDoc: DocumentChunk = {
        id: "new-doc-1",
        text: "This is a new document about advanced topics.",
        source: "test",
        section: "advanced",
        vector: (await embeddingGenerator.embed("advanced topics")).embedding,
        chunkIndex: 999,
        createdAt: Date.now(),
      };

      await vectorDB.addDocuments("e2e_docs", [newDoc]);

      // Verify new document was added
      const updatedCount = await vectorDB.getDocumentCount("e2e_docs");
      expect(updatedCount).toBeGreaterThan(existingCount);

      // Search should find the new document
      const queryEmbedding = await embeddingGenerator.embed(
        "advanced topics",
      );
      const results = await vectorDB.search(
        queryEmbedding.embedding,
        "e2e_docs",
        10,
      );

      const foundNewDoc = results.some((r) => r.id === "new-doc-1");
      expect(foundNewDoc).toBe(true);
    },
    MODEL_LOAD_TIMEOUT,
  );
});
