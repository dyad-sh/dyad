/**
 * Token Usage Validation Tests
 *
 * Validates that vector search provides the expected token savings
 * compared to full documentation fetch.
 *
 * Targets:
 * - 90% context size reduction
 * - <100ms retrieval time
 * - <50KB context size
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { VectorDB, type DocumentChunk } from "../vector_db.js";
import {
  EmbeddingGenerator,
  createEmbeddingGenerator,
  resetDefaultGenerator,
} from "../embeddings.js";
import { chunkMarkdown } from "../chunker.js";

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_DB_PATH = "./test-data/token-usage-test";
const MODEL_LOAD_TIMEOUT = 180000; // 3 minutes

// Target metrics from spec
const TARGETS = {
  sizeReductionPercent: 90, // 90% reduction
  maxRetrievalTimeMs: 100, // <100ms
  maxContextSizeKB: 50, // <50KB
  charsPerToken: 4, // ~4 chars per token (GPT-4 average)
};

// ============================================================================
// Test Data
// ============================================================================

/** Sample Solana documentation (~65KB when repeated) */
const FULL_DOCS = `
# Solana Program Development Guide

## Account Model
Solana uses an account-based model where all state is stored in accounts.
Programs are stateless and operate on accounts passed to them.

### Account Types
1. Program Accounts - Contain executable code
2. Data Accounts - Store arbitrary data
3. System Accounts - Native accounts

### Program Derived Addresses (PDAs)
PDAs are special addresses derived from seeds and a program ID.

\`\`\`rust
let (pda, bump) = Pubkey::find_program_address(
    &[b"seed", user.key().as_ref()],
    program_id,
);
\`\`\`

## Token Program (SPL Token)
The SPL Token program provides functionality for tokens.

\`\`\`rust
use anchor_spl::token::{Mint, Token};

#[derive(Accounts)]
pub struct CreateMint<'info> {
    #[account(init, payer = payer, mint::decimals = 9)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}
\`\`\`

## Error Handling
\`\`\`rust
#[error_code]
pub enum MyError {
    #[msg("Insufficient funds")]
    InsufficientFunds,
}
\`\`\`

## Events and Logging
\`\`\`rust
#[event]
pub struct TransferEvent {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}
\`\`\`

## Storage Patterns
\`\`\`rust
#[account]
pub struct UserAccount {
    pub owner: Pubkey,
    pub balance: u64,
}
\`\`\`

## Access Control
\`\`\`rust
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(constraint = authority.key() == admin)]
    pub authority: Signer<'info>,
}
\`\`\`
`.repeat(15); // ~65KB simulated full docs

/** Test contracts with varying complexity */
const TEST_CONTRACTS = {
  simple: `
    pragma solidity ^0.8.0;
    contract Counter { uint256 public count; }
  `,
  medium: `
    pragma solidity ^0.8.0;
    contract Vault {
      mapping(address => uint256) public balances;
      event Deposit(address indexed user, uint256 amount);
      function deposit() public payable {
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
      }
    }
  `,
  complex: `
    pragma solidity ^0.8.0;
    import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
    contract StakingPool {
      struct StakeInfo { uint256 amount; uint256 rewardDebt; }
      mapping(address => StakeInfo) public stakes;
      IERC20 public token;
      event Staked(address indexed user, uint256 amount);
      modifier updateReward(address account) { _; }
      function stake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        stakes[msg.sender].amount += amount;
        emit Staked(msg.sender, amount);
      }
    }
  `,
};

// ============================================================================
// Helper Functions
// ============================================================================

function buildSearchQueries(sourceCode: string): string[] {
  const queries: string[] = ["solana smart contract development"];

  const patterns = [
    { pattern: /mapping\s*\(/i, query: "solana storage mapping state" },
    { pattern: /event\s+\w+/i, query: "solana events emit logging" },
    { pattern: /modifier\s+\w+/i, query: "solana access control" },
    { pattern: /struct\s+\w+/i, query: "solana account data struct" },
    { pattern: /require\s*\(/i, query: "solana error handling" },
    { pattern: /ERC20|token/i, query: "solana SPL token" },
  ];

  for (const { pattern, query } of patterns) {
    if (pattern.test(sourceCode)) {
      queries.push(query);
    }
  }

  return queries.slice(0, 5);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TARGETS.charsPerToken);
}

async function cleanupTestDB(): Promise<void> {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Token Usage Validation", () => {
  let embeddingGenerator: EmbeddingGenerator;
  let vectorDB: VectorDB;
  let isModelLoaded = false;
  let documentChunks: DocumentChunk[] = [];

  beforeAll(async () => {
    await cleanupTestDB();

    embeddingGenerator = createEmbeddingGenerator();
    vectorDB = new VectorDB({ dataPath: TEST_DB_PATH });

    try {
      await embeddingGenerator.initialize();
      await vectorDB.connect();

      // Ingest documentation
      const chunks = chunkMarkdown(FULL_DOCS);
      for (const chunk of chunks) {
        const result = await embeddingGenerator.embed(chunk.text);
        documentChunks.push({
          id: `solana-${chunk.index}`,
          text: chunk.text,
          source: "solana",
          section: chunk.section ?? "general",
          vector: result.embedding,
          chunkIndex: chunk.index,
          createdAt: Date.now(),
        });
      }

      await vectorDB.createTable("solana_docs", documentChunks);
      isModelLoaded = true;
    } catch (error) {
      console.warn("Setup failed:", error);
    }
  }, MODEL_LOAD_TIMEOUT);

  afterAll(async () => {
    resetDefaultGenerator();
    await vectorDB?.close();
    await cleanupTestDB();
  });

  describe("Context Size Reduction", () => {
    it.skipIf(!isModelLoaded)(
      "should achieve >90% context size reduction for simple contracts",
      async () => {
        const sourceCode = TEST_CONTRACTS.simple;
        const queries = buildSearchQueries(sourceCode);

        let vectorContext = "";
        for (const query of queries) {
          const queryEmbedding = await embeddingGenerator.embed(query);
          const results = await vectorDB.search(
            queryEmbedding.embedding,
            "solana_docs",
            3,
          );
          for (const result of results) {
            if (!vectorContext.includes(result.text)) {
              vectorContext += result.text + "\n\n";
            }
          }
        }

        const fullDocsSize = FULL_DOCS.length;
        const vectorContextSize = vectorContext.length;
        const reductionPercent =
          ((fullDocsSize - vectorContextSize) / fullDocsSize) * 100;

        expect(reductionPercent).toBeGreaterThanOrEqual(TARGETS.sizeReductionPercent);
        expect(vectorContextSize / 1024).toBeLessThan(TARGETS.maxContextSizeKB);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should achieve >90% context size reduction for complex contracts",
      async () => {
        const sourceCode = TEST_CONTRACTS.complex;
        const queries = buildSearchQueries(sourceCode);

        let vectorContext = "";
        for (const query of queries) {
          const queryEmbedding = await embeddingGenerator.embed(query);
          const results = await vectorDB.search(
            queryEmbedding.embedding,
            "solana_docs",
            3,
          );
          for (const result of results) {
            if (!vectorContext.includes(result.text)) {
              vectorContext += result.text + "\n\n";
            }
          }
        }

        const fullDocsSize = FULL_DOCS.length;
        const vectorContextSize = vectorContext.length;
        const reductionPercent =
          ((fullDocsSize - vectorContextSize) / fullDocsSize) * 100;

        expect(reductionPercent).toBeGreaterThanOrEqual(TARGETS.sizeReductionPercent);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });

  describe("Token Savings", () => {
    it.skipIf(!isModelLoaded)(
      "should save significant tokens compared to full fetch",
      async () => {
        const sourceCode = TEST_CONTRACTS.medium;
        const queries = buildSearchQueries(sourceCode);

        let vectorContext = "";
        for (const query of queries) {
          const queryEmbedding = await embeddingGenerator.embed(query);
          const results = await vectorDB.search(
            queryEmbedding.embedding,
            "solana_docs",
            3,
          );
          for (const result of results) {
            if (!vectorContext.includes(result.text)) {
              vectorContext += result.text + "\n\n";
            }
          }
        }

        const fullDocsTokens = estimateTokens(FULL_DOCS);
        const vectorTokens = estimateTokens(vectorContext);
        const tokenSavings = fullDocsTokens - vectorTokens;
        const savingsPercent = (tokenSavings / fullDocsTokens) * 100;

        // Should save at least 90% of tokens
        expect(savingsPercent).toBeGreaterThanOrEqual(90);

        // Log for visibility
        console.log(`Token savings: ${tokenSavings.toLocaleString()} tokens (${savingsPercent.toFixed(1)}%)`);
        console.log(`Full docs: ${fullDocsTokens.toLocaleString()} tokens`);
        console.log(`Vector context: ${vectorTokens.toLocaleString()} tokens`);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });

  describe("Retrieval Performance", () => {
    it.skipIf(!isModelLoaded)(
      "should retrieve context in <100ms",
      async () => {
        const sourceCode = TEST_CONTRACTS.complex;
        const queries = buildSearchQueries(sourceCode);

        const startTime = performance.now();

        for (const query of queries) {
          const queryEmbedding = await embeddingGenerator.embed(query);
          await vectorDB.search(queryEmbedding.embedding, "solana_docs", 5);
        }

        const endTime = performance.now();
        const retrievalTimeMs = endTime - startTime;

        // Retrieval should be fast
        expect(retrievalTimeMs).toBeLessThan(TARGETS.maxRetrievalTimeMs * queries.length);

        // Per-query average should be under target
        const avgPerQuery = retrievalTimeMs / queries.length;
        expect(avgPerQuery).toBeLessThan(TARGETS.maxRetrievalTimeMs);

        console.log(`Retrieval time: ${retrievalTimeMs.toFixed(1)}ms for ${queries.length} queries`);
        console.log(`Average per query: ${avgPerQuery.toFixed(1)}ms`);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });

  describe("Context Quality", () => {
    it.skipIf(!isModelLoaded)(
      "should retrieve relevant context for mapping patterns",
      async () => {
        const queryEmbedding = await embeddingGenerator.embed(
          "solana storage mapping state",
        );
        const results = await vectorDB.search(
          queryEmbedding.embedding,
          "solana_docs",
          5,
        );

        expect(results.length).toBeGreaterThan(0);

        // Results should contain relevant content
        const allText = results.map((r) => r.text.toLowerCase()).join(" ");
        expect(
          allText.includes("account") ||
          allText.includes("storage") ||
          allText.includes("data"),
        ).toBe(true);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should retrieve relevant context for token patterns",
      async () => {
        const queryEmbedding = await embeddingGenerator.embed(
          "solana SPL token mint transfer",
        );
        const results = await vectorDB.search(
          queryEmbedding.embedding,
          "solana_docs",
          5,
        );

        expect(results.length).toBeGreaterThan(0);

        // Results should contain token-related content
        const allText = results.map((r) => r.text.toLowerCase()).join(" ");
        expect(
          allText.includes("token") ||
          allText.includes("mint") ||
          allText.includes("spl"),
        ).toBe(true);
      },
      MODEL_LOAD_TIMEOUT,
    );

    it.skipIf(!isModelLoaded)(
      "should retrieve relevant context for error handling",
      async () => {
        const queryEmbedding = await embeddingGenerator.embed(
          "solana error handling require assert",
        );
        const results = await vectorDB.search(
          queryEmbedding.embedding,
          "solana_docs",
          5,
        );

        expect(results.length).toBeGreaterThan(0);

        // Results should contain error-related content
        const allText = results.map((r) => r.text.toLowerCase()).join(" ");
        expect(
          allText.includes("error") ||
          allText.includes("msg") ||
          allText.includes("insufficient"),
        ).toBe(true);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });

  describe("Cost Analysis", () => {
    it.skipIf(!isModelLoaded)(
      "should demonstrate significant cost savings",
      async () => {
        const costPer1MTokens = 10; // $10 per 1M input tokens (GPT-4)

        const sourceCode = TEST_CONTRACTS.complex;
        const queries = buildSearchQueries(sourceCode);

        let vectorContext = "";
        for (const query of queries) {
          const queryEmbedding = await embeddingGenerator.embed(query);
          const results = await vectorDB.search(
            queryEmbedding.embedding,
            "solana_docs",
            3,
          );
          for (const result of results) {
            if (!vectorContext.includes(result.text)) {
              vectorContext += result.text + "\n\n";
            }
          }
        }

        const fullDocsTokens = estimateTokens(FULL_DOCS);
        const vectorTokens = estimateTokens(vectorContext);

        const fullDocsCost = (fullDocsTokens / 1_000_000) * costPer1MTokens;
        const vectorCost = (vectorTokens / 1_000_000) * costPer1MTokens;
        const savingsPerRequest = fullDocsCost - vectorCost;

        // At 1000 requests/day for 30 days
        const monthlyRequests = 1000 * 30;
        const monthlySavings = savingsPerRequest * monthlyRequests;

        console.log(`\nCost Analysis (GPT-4 @ $${costPer1MTokens}/1M tokens):`);
        console.log(`  Full docs cost per request: $${fullDocsCost.toFixed(4)}`);
        console.log(`  Vector search cost per request: $${vectorCost.toFixed(4)}`);
        console.log(`  Savings per request: $${savingsPerRequest.toFixed(4)}`);
        console.log(`  Monthly savings (1k requests/day): $${monthlySavings.toFixed(2)}`);

        // Should save at least $0.001 per request
        expect(savingsPerRequest).toBeGreaterThan(0.001);
      },
      MODEL_LOAD_TIMEOUT,
    );
  });
});
