#!/usr/bin/env npx tsx
/**
 * Performance Benchmark Runner
 *
 * Standalone script to verify performance targets:
 * - Retrieval time: <100ms
 * - Context size: <50KB
 *
 * Run with: npx tsx scripts/run-benchmark.ts
 */

import * as fs from "node:fs";
import { chunkMarkdown } from "../src/chunker.js";
import { EmbeddingGenerator, createEmbeddingGenerator } from "../src/embeddings.js";
import { VectorDB, type DocumentChunk } from "../src/vector_db.js";

// ============================================================================
// Configuration
// ============================================================================

const BENCHMARK_DB_PATH = "./benchmark-data";
const PERFORMANCE_TARGETS = {
  retrievalTimeMs: 100,
  contextSizeKB: 50,
  iterations: 5,
};

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

## Security Best Practices

Security is paramount in blockchain development.

### Common Vulnerabilities

1. Missing signer checks
2. Missing owner checks
3. Arithmetic overflow/underflow
4. Account validation issues

### Safe Patterns

Always use Anchor's built-in validations.

## Testing Your Program

Comprehensive testing ensures program correctness.

## Deployment

Deploy your program to the Solana network.
`;

// ============================================================================
// Main Benchmark Function
// ============================================================================

async function runBenchmark(): Promise<void> {
  console.log("=".repeat(60));
  console.log("PERFORMANCE BENCHMARK");
  console.log("=".repeat(60));
  console.log(`\nTargets:`);
  console.log(`  - retrieval_time_ms: <${PERFORMANCE_TARGETS.retrievalTimeMs}ms`);
  console.log(`  - context_size_kb: <${PERFORMANCE_TARGETS.contextSizeKB}KB`);
  console.log(`  - iterations: ${PERFORMANCE_TARGETS.iterations}`);
  console.log();

  // Cleanup any existing benchmark data
  if (fs.existsSync(BENCHMARK_DB_PATH)) {
    fs.rmSync(BENCHMARK_DB_PATH, { recursive: true, force: true });
  }

  // Initialize embedding generator
  console.log("Loading embedding model...");
  const embeddingGenerator = createEmbeddingGenerator();
  await embeddingGenerator.initialize();
  console.log("Model loaded successfully.\n");

  // Initialize vector database
  console.log("Initializing vector database...");
  const vectorDB = new VectorDB({ dataPath: BENCHMARK_DB_PATH });
  await vectorDB.connect();

  // Prepare test data
  console.log("Chunking sample documentation...");
  const chunks = chunkMarkdown(SAMPLE_DOCS);
  console.log(`Created ${chunks.length} chunks.\n`);

  // Generate embeddings and create documents
  console.log("Generating embeddings...");
  const documentChunks: DocumentChunk[] = [];
  for (const chunk of chunks) {
    const result = await embeddingGenerator.embed(chunk.text);
    documentChunks.push({
      id: `solana-${chunk.index}`,
      text: chunk.text,
      source: "solana",
      section: chunk.section ?? "unknown",
      vector: result.embedding,
      chunkIndex: chunk.index,
      createdAt: Date.now(),
    });
  }
  console.log(`Generated ${documentChunks.length} embeddings.\n`);

  // Store in vector database
  console.log("Storing in vector database...");
  await vectorDB.createTable("benchmark_docs", documentChunks);
  console.log("Data stored successfully.\n");

  // Run benchmark
  console.log("=".repeat(60));
  console.log("RUNNING BENCHMARK");
  console.log("=".repeat(60));

  const testQueries = [
    "solana smart contract development guide",
    "solana storage mapping state",
    "solana token SPL fungible NFT",
    "solana error handling require assert",
    "solana initialization initialize",
  ];

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
      testQueries.map(async (query) => {
        const queryResult = await embeddingGenerator.embed(query);
        return vectorDB.search(queryResult.embedding, "benchmark_docs", 3);
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

    const retrievalStatus = retrievalTimeMs < PERFORMANCE_TARGETS.retrievalTimeMs ? "✅" : "❌";
    const contextStatus = contextSizeKB < PERFORMANCE_TARGETS.contextSizeKB ? "✅" : "❌";

    console.log(`\nIteration ${i + 1}:`);
    console.log(`  ${retrievalStatus} retrieval_time_ms: ${retrievalTimeMs.toFixed(2)}ms`);
    console.log(`  ${contextStatus} context_size_kb: ${contextSizeKB.toFixed(1)}KB`);
    console.log(`  chunks: ${limitedResults.length}`);
  }

  // Calculate summary
  const avgRetrieval = allMetrics.reduce((a, b) => a + b.retrievalTimeMs, 0) / allMetrics.length;
  const maxRetrieval = Math.max(...allMetrics.map((m) => m.retrievalTimeMs));
  const minRetrieval = Math.min(...allMetrics.map((m) => m.retrievalTimeMs));
  const avgContextSize = allMetrics.reduce((a, b) => a + b.contextSizeKB, 0) / allMetrics.length;
  const avgChunks = allMetrics.reduce((a, b) => a + b.chunkCount, 0) / allMetrics.length;

  console.log("\n" + "=".repeat(60));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(60));

  const retrievalPass = avgRetrieval < PERFORMANCE_TARGETS.retrievalTimeMs;
  const contextPass = avgContextSize < PERFORMANCE_TARGETS.contextSizeKB;

  console.log(`\nRetrieval Time:`);
  console.log(`  Average: ${avgRetrieval.toFixed(2)}ms (target: <${PERFORMANCE_TARGETS.retrievalTimeMs}ms)`);
  console.log(`  Min: ${minRetrieval.toFixed(2)}ms`);
  console.log(`  Max: ${maxRetrieval.toFixed(2)}ms`);
  console.log(`  Status: ${retrievalPass ? "✅ PASS" : "❌ FAIL"}`);

  console.log(`\nContext Size:`);
  console.log(`  Average: ${avgContextSize.toFixed(1)}KB (target: <${PERFORMANCE_TARGETS.contextSizeKB}KB)`);
  console.log(`  Status: ${contextPass ? "✅ PASS" : "❌ FAIL"}`);

  console.log(`\nChunks Retrieved:`);
  console.log(`  Average: ${avgChunks.toFixed(1)}`);

  console.log("\n" + "=".repeat(60));
  if (retrievalPass && contextPass) {
    console.log("✅ ALL PERFORMANCE TARGETS MET");
  } else {
    console.log("❌ SOME PERFORMANCE TARGETS NOT MET");
    if (!retrievalPass) console.log("   - Retrieval time exceeds 100ms target");
    if (!contextPass) console.log("   - Context size exceeds 50KB target");
  }
  console.log("=".repeat(60));

  // Cleanup
  await vectorDB.close();
  if (fs.existsSync(BENCHMARK_DB_PATH)) {
    fs.rmSync(BENCHMARK_DB_PATH, { recursive: true, force: true });
  }

  // Exit with appropriate code
  process.exit(retrievalPass && contextPass ? 0 : 1);
}

// Run the benchmark
runBenchmark().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
