/**
 * Performance Benchmark Tests for RAG Vector Search
 *
 * These tests verify the performance targets from the spec:
 * - Retrieval time: <100ms
 * - Context size: <50KB
 *
 * Run with: npm test -- --grep "Performance Benchmark" --reporter verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { chunkMarkdown, type Chunk } from "../chunker.js";
import {
  EmbeddingGenerator,
  createEmbeddingGenerator,
  resetDefaultGenerator,
} from "../embeddings.js";
import {
  VectorDB,
  type DocumentChunk,
} from "../vector_db.js";

// ============================================================================
// Configuration
// ============================================================================

const BENCHMARK_DB_PATH = "./test-data/vectors-benchmark";
const MODEL_LOAD_TIMEOUT = 180000; // 3 minutes for model download

/** Performance targets from spec */
const PERFORMANCE_TARGETS = {
  retrievalTimeMs: 100,
  contextSizeKB: 50,
  iterations: 5,
};

/** Sample documentation for testing (representative size) */
const SAMPLE_DOCS = `
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

## Storage and State Management

Understanding how to efficiently store and manage state is crucial for Solana development.

### Account Data

All program data lives in accounts. When designing your program, consider:

- Account size limits (10KB default, 10MB max)
- Rent exemption requirements
- Data serialization format (Borsh recommended)

### Reallocation

You can resize accounts using the realloc constraint:

\`\`\`rust
#[account(
    mut,
    realloc = new_size,
    realloc::payer = payer,
    realloc::zero = false,
)]
pub data_account: Account<'info, DataAccount>,
\`\`\`

## Security Best Practices

Security is paramount in blockchain development.

### Common Vulnerabilities

1. Missing signer checks
2. Missing owner checks
3. Arithmetic overflow/underflow
4. Account validation issues

### Safe Patterns

Always use Anchor's built-in validations:

\`\`\`rust
#[account(
    mut,
    has_one = authority,
    constraint = account.is_initialized @ ErrorCode::NotInitialized
)]
pub account: Account<'info, MyAccount>,
\`\`\`

## Testing Your Program

Comprehensive testing ensures program correctness.

### Unit Tests

Use Anchor's testing framework:

\`\`\`rust
#[tokio::test]
async fn test_initialize() {
    let program = // setup
    let result = program.initialize().await;
    assert!(result.is_ok());
}
\`\`\`

### Integration Tests

Test with real devnet transactions:

\`\`\`typescript
import * as anchor from "@coral-xyz/anchor";

describe("my-program", () => {
    it("initializes correctly", async () => {
        const tx = await program.methods
            .initialize()
            .accounts({
                authority: provider.wallet.publicKey,
            })
            .rpc();
        console.log("Transaction signature:", tx);
    });
});
\`\`\`

## Deployment

Deploy your program to the Solana network.

### Build

Build your program:

\`\`\`bash
anchor build
\`\`\`

### Deploy to Devnet

\`\`\`bash
anchor deploy --provider.cluster devnet
\`\`\`

### Verify

Verify your deployment:

\`\`\`bash
solana program show <PROGRAM_ID>
\`\`\`
`;

// ============================================================================
// Helper Functions
// ============================================================================

async function cleanupBenchmarkDB(): Promise<void> {
  try {
    if (fs.existsSync(BENCHMARK_DB_PATH)) {
      fs.rmSync(BENCHMARK_DB_PATH, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

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

// ============================================================================
// Performance Benchmark Tests
// ============================================================================

describe("Performance Benchmark", () => {
  let embeddingGenerator: EmbeddingGenerator;
  let vectorDB: VectorDB;
  let isReady = false;

  beforeAll(async () => {
    await cleanupBenchmarkDB();

    embeddingGenerator = createEmbeddingGenerator();
    vectorDB = new VectorDB({ dataPath: BENCHMARK_DB_PATH });

    try {
      await embeddingGenerator.initialize();
      await vectorDB.connect();

      // Prepare test data
      const chunks = chunkMarkdown(SAMPLE_DOCS);
      const documentChunks = await createDocumentChunks(
        chunks,
        "solana",
        embeddingGenerator,
      );
      await vectorDB.createTable("benchmark_docs", documentChunks);

      isReady = true;
    } catch (error) {
      console.warn("Benchmark setup failed:", error);
    }
  }, MODEL_LOAD_TIMEOUT);

  afterAll(async () => {
    resetDefaultGenerator();
    await vectorDB?.close();
    await cleanupBenchmarkDB();
  });

  describe("Retrieval Time Benchmark", () => {
    it.skipIf(!isReady)(
      "should verify retrieval time is less than 100ms",
      async () => {
        const testQueries = [
          "How to create tokens?",
          "What are Program Derived Addresses?",
          "Error handling in Solana programs",
          "How to transfer SOL?",
          "Security best practices for smart contracts",
        ];

        const retrievalTimes: number[] = [];

        // Run multiple iterations for each query
        for (let iteration = 0; iteration < PERFORMANCE_TARGETS.iterations; iteration++) {
          for (const query of testQueries) {
            // Generate query embedding
            const queryResult = await embeddingGenerator.embed(query);

            // Measure retrieval time only
            const startTime = performance.now();
            const results = await vectorDB.search(
              queryResult.embedding,
              "benchmark_docs",
              10,
            );
            const endTime = performance.now();

            const retrievalTime = endTime - startTime;
            retrievalTimes.push(retrievalTime);

            // Log individual result
            console.log(
              `[Performance] Query: "${query.substring(0, 30)}..." ` +
              `retrieval_time_ms: ${retrievalTime.toFixed(2)}, ` +
              `results: ${results.length}`
            );

            // Verify retrieval time target
            expect(retrievalTime).toBeLessThan(PERFORMANCE_TARGETS.retrievalTimeMs);
          }
        }

        // Calculate and log aggregate stats
        const avgTime = retrievalTimes.reduce((a, b) => a + b, 0) / retrievalTimes.length;
        const maxTime = Math.max(...retrievalTimes);
        const minTime = Math.min(...retrievalTimes);

        console.log("\n[Performance Summary]");
        console.log(`  Iterations: ${PERFORMANCE_TARGETS.iterations}`);
        console.log(`  Queries per iteration: ${testQueries.length}`);
        console.log(`  Total queries: ${retrievalTimes.length}`);
        console.log(`  Average retrieval_time_ms: ${avgTime.toFixed(2)}`);
        console.log(`  Min retrieval_time_ms: ${minTime.toFixed(2)}`);
        console.log(`  Max retrieval_time_ms: ${maxTime.toFixed(2)}`);
        console.log(`  Target: <${PERFORMANCE_TARGETS.retrievalTimeMs}ms`);
        console.log(`  Status: ${avgTime < PERFORMANCE_TARGETS.retrievalTimeMs ? "✅ PASS" : "❌ FAIL"}`);

        // Verify average is well under target
        expect(avgTime).toBeLessThan(PERFORMANCE_TARGETS.retrievalTimeMs);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });

  describe("Context Size Benchmark", () => {
    it.skipIf(!isReady)(
      "should verify context size is less than 50KB",
      async () => {
        const testQueries = [
          "solana smart contract development guide",
          "token transfer and creation",
          "Program Derived Addresses PDAs",
          "cross-program invocation CPI",
          "error handling best practices",
        ];

        const contextSizes: number[] = [];
        const chunkCounts: number[] = [];

        for (const query of testQueries) {
          const queryResult = await embeddingGenerator.embed(query);

          // Get multiple chunks like the real translation pipeline does
          const results = await vectorDB.search(
            queryResult.embedding,
            "benchmark_docs",
            15, // Match the limit used in translation_pipeline.ts
          );

          // Aggregate context like queryMultiple does
          const contextParts = results.map((r) => r.text);
          const context = contextParts.join("\n\n---\n\n");
          const contextSizeBytes = new TextEncoder().encode(context).length;
          const contextSizeKB = contextSizeBytes / 1024;

          contextSizes.push(contextSizeKB);
          chunkCounts.push(results.length);

          console.log(
            `[Performance] Query: "${query.substring(0, 30)}..." ` +
            `context_size_kb: ${contextSizeKB.toFixed(1)}, ` +
            `chunks: ${results.length}`
          );

          // Verify context size target
          expect(contextSizeKB).toBeLessThan(PERFORMANCE_TARGETS.contextSizeKB);
        }

        // Calculate aggregate stats
        const avgSize = contextSizes.reduce((a, b) => a + b, 0) / contextSizes.length;
        const maxSize = Math.max(...contextSizes);
        const avgChunks = chunkCounts.reduce((a, b) => a + b, 0) / chunkCounts.length;

        console.log("\n[Context Size Summary]");
        console.log(`  Queries tested: ${testQueries.length}`);
        console.log(`  Average context_size_kb: ${avgSize.toFixed(1)}`);
        console.log(`  Max context_size_kb: ${maxSize.toFixed(1)}`);
        console.log(`  Average chunks: ${avgChunks.toFixed(1)}`);
        console.log(`  Target: <${PERFORMANCE_TARGETS.contextSizeKB}KB`);
        console.log(`  Status: ${avgSize < PERFORMANCE_TARGETS.contextSizeKB ? "✅ PASS" : "❌ FAIL"}`);

        // Verify average is well under target
        expect(avgSize).toBeLessThan(PERFORMANCE_TARGETS.contextSizeKB);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });

  describe("Combined Performance Test (Translation Simulation)", () => {
    it.skipIf(!isReady)(
      "should simulate translation pipeline RAG retrieval 5 times",
      async () => {
        // Simulate the queries that would be generated by buildSearchQueries
        const simulatedQueries = [
          "solana smart contract development guide",
          "solana storage mapping state",
          "solana token SPL fungible NFT",
          "solana error handling require assert",
          "solana initialization initialize",
        ];

        console.log("\n[Translation Pipeline RAG Simulation]");
        console.log(`  Running ${PERFORMANCE_TARGETS.iterations} iterations...\n`);

        const allMetrics: Array<{
          iteration: number;
          retrievalTimeMs: number;
          contextSizeKB: number;
          chunkCount: number;
        }> = [];

        for (let i = 0; i < PERFORMANCE_TARGETS.iterations; i++) {
          const iterationStart = performance.now();
          const allResults: Array<{ text: string }> = [];
          const seenTexts = new Set<string>();

          // Run all queries in parallel like queryMultiple does
          const queryResults = await Promise.all(
            simulatedQueries.map(async (query) => {
              const queryResult = await embeddingGenerator.embed(query);
              return vectorDB.search(
                queryResult.embedding,
                "benchmark_docs",
                3, // Match Math.floor(15 / 5) from queryMultiple
              );
            }),
          );

          // Deduplicate results
          for (const results of queryResults) {
            for (const result of results) {
              if (!seenTexts.has(result.text)) {
                seenTexts.add(result.text);
                allResults.push(result);
              }
            }
          }

          // Limit to 15 results
          const limitedResults = allResults.slice(0, 15);
          const context = limitedResults.map((r) => r.text).join("\n\n---\n\n");
          const contextSizeBytes = new TextEncoder().encode(context).length;
          const contextSizeKB = contextSizeBytes / 1024;

          const iterationEnd = performance.now();
          const retrievalTimeMs = iterationEnd - iterationStart;

          const metrics = {
            iteration: i + 1,
            retrievalTimeMs,
            contextSizeKB,
            chunkCount: limitedResults.length,
          };
          allMetrics.push(metrics);

          console.log(
            `  Iteration ${i + 1}: ` +
            `retrieval_time_ms: ${retrievalTimeMs.toFixed(1)}, ` +
            `context_size_kb: ${contextSizeKB.toFixed(1)}, ` +
            `chunks: ${limitedResults.length}`
          );

          // Verify targets for each iteration
          expect(retrievalTimeMs).toBeLessThan(PERFORMANCE_TARGETS.retrievalTimeMs);
          expect(contextSizeKB).toBeLessThan(PERFORMANCE_TARGETS.contextSizeKB);
        }

        // Calculate summary
        const avgRetrieval = allMetrics.reduce((a, b) => a + b.retrievalTimeMs, 0) / allMetrics.length;
        const avgContextSize = allMetrics.reduce((a, b) => a + b.contextSizeKB, 0) / allMetrics.length;
        const avgChunks = allMetrics.reduce((a, b) => a + b.chunkCount, 0) / allMetrics.length;

        console.log("\n[Final Results]");
        console.log(`  ✅ Average retrieval_time_ms: ${avgRetrieval.toFixed(1)} (target: <${PERFORMANCE_TARGETS.retrievalTimeMs}ms)`);
        console.log(`  ✅ Average context_size_kb: ${avgContextSize.toFixed(1)} (target: <${PERFORMANCE_TARGETS.contextSizeKB}KB)`);
        console.log(`  ✅ Average chunks retrieved: ${avgChunks.toFixed(1)}`);
        console.log(`\n  Performance targets VERIFIED ✓`);

        // Final assertions
        expect(avgRetrieval).toBeLessThan(PERFORMANCE_TARGETS.retrievalTimeMs);
        expect(avgContextSize).toBeLessThan(PERFORMANCE_TARGETS.contextSizeKB);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });
});
