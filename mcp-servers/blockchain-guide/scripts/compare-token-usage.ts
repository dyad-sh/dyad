#!/usr/bin/env npx tsx
/**
 * Token Usage Comparison Test
 *
 * Compares vector search (RAG) vs full documentation fetch to validate:
 * - Context size reduction (target: 90% reduction)
 * - Token usage savings
 * - Retrieval performance
 *
 * Run: npx tsx scripts/compare-token-usage.ts
 */

import { VectorDB, type DocumentChunk } from "../src/vector_db.js";
import { EmbeddingGenerator, createEmbeddingGenerator } from "../src/embeddings.js";
import { chunkMarkdown } from "../src/chunker.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  /** Path to vector database */
  dbPath: "./comparison-data/vectors",
  /** Approximate tokens per character (GPT-4 averages ~4 chars per token) */
  charsPerToken: 4,
  /** Cost per 1M input tokens (GPT-4 pricing) */
  costPer1MTokens: 10, // $10 per 1M input tokens
  /** Number of chunks to retrieve in vector search */
  vectorSearchLimit: 15,
  /** Minimum similarity threshold */
  minSimilarity: 0.4,
};

// ============================================================================
// Sample Test Data
// ============================================================================

/** Sample Solidity contracts for testing */
const TEST_CONTRACTS = {
  simple: `
    pragma solidity ^0.8.0;
    contract Counter {
      uint256 public count;
      function increment() public { count += 1; }
    }
  `,

  medium: `
    pragma solidity ^0.8.0;
    contract TokenVault {
      mapping(address => uint256) public balances;
      event Deposit(address indexed user, uint256 amount);

      modifier onlyPositiveAmount(uint256 amount) {
        require(amount > 0, "Amount must be positive");
        _;
      }

      function deposit() public payable onlyPositiveAmount(msg.value) {
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
      }
    }
  `,

  complex: `
    pragma solidity ^0.8.0;
    import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
    import "@openzeppelin/contracts/access/Ownable.sol";

    contract StakingPool is Ownable {
      struct StakeInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lastStakeTime;
      }

      mapping(address => StakeInfo) public stakes;
      IERC20 public stakingToken;
      uint256 public rewardRate;

      event Staked(address indexed user, uint256 amount);
      event Unstaked(address indexed user, uint256 amount);
      event RewardsClaimed(address indexed user, uint256 amount);

      constructor(address _stakingToken, uint256 _rewardRate) {
        stakingToken = IERC20(_stakingToken);
        rewardRate = _rewardRate;
      }

      modifier updateReward(address account) {
        StakeInfo storage stake = stakes[account];
        if (stake.amount > 0) {
          stake.rewardDebt += calculateReward(account);
        }
        _;
      }

      function stake(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        stakingToken.transferFrom(msg.sender, address(this), amount);
        stakes[msg.sender].amount += amount;
        stakes[msg.sender].lastStakeTime = block.timestamp;
        emit Staked(msg.sender, amount);
      }

      function calculateReward(address account) public view returns (uint256) {
        StakeInfo memory stake = stakes[account];
        uint256 timeElapsed = block.timestamp - stake.lastStakeTime;
        return stake.amount * rewardRate * timeElapsed / 1e18;
      }
    }
  `,
};

/** Sample Solana documentation (simulating full docs) */
const FULL_SOLANA_DOCS = `
# Solana Program Development Guide

## Introduction
Solana is a high-performance blockchain designed for fast transactions and low fees.
This comprehensive guide covers everything you need to know about building programs on Solana.

## Account Model
Solana uses an account-based model where all state is stored in accounts.
Programs (smart contracts) are stateless and operate on accounts passed to them.

### Account Types
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

## Token Program (SPL Token)
The SPL Token program provides functionality for creating and managing tokens.

### Creating a Token Mint
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
Solana programs store state in accounts, not in contract storage like Ethereum.

### Account Data Layout
\`\`\`rust
#[account]
pub struct UserAccount {
    pub owner: Pubkey,
    pub balance: u64,
    pub is_initialized: bool,
}
\`\`\`

## Events and Logging
Solana uses program logs for events.

\`\`\`rust
use anchor_lang::prelude::*;

#[event]
pub struct TransferEvent {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}
\`\`\`

## Access Control
Implement access control using signers and constraints.

\`\`\`rust
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        constraint = authority.key() == admin_account.admin @ MyError::InvalidAuthority
    )]
    pub authority: Signer<'info>,
    pub admin_account: Account<'info, AdminConfig>,
}
\`\`\`

## Best Practices
1. Always validate all accounts
2. Use proper error handling
3. Minimize compute usage
4. Use PDAs for deterministic addresses
5. Implement proper access control

## Common Patterns

### Initialization Pattern
\`\`\`rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 8,
    )]
    pub data_account: Account<'info, DataAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
\`\`\`

### Transfer Pattern
\`\`\`rust
pub fn transfer(ctx: Context<Transfer>, amount: u64) -> Result<()> {
    let from = &mut ctx.accounts.from;
    let to = &mut ctx.accounts.to;

    require!(from.balance >= amount, MyError::InsufficientFunds);

    from.balance -= amount;
    to.balance += amount;

    emit!(TransferEvent {
        from: from.key(),
        to: to.key(),
        amount,
    });

    Ok(())
}
\`\`\`

## Security Considerations
1. Validate all signers
2. Check account ownership
3. Verify account data
4. Handle arithmetic safely
5. Use proper access control

## Testing
Use Anchor's testing framework for comprehensive tests.

\`\`\`typescript
describe("my_program", () => {
  it("should initialize", async () => {
    await program.methods
      .initialize()
      .accounts({ ... })
      .rpc();
  });
});
\`\`\`

## Deployment
Deploy using Anchor CLI:
\`\`\`bash
anchor build
anchor deploy
\`\`\`

## Additional Resources
- Solana Cookbook: https://solanacookbook.com
- Anchor Documentation: https://www.anchor-lang.com
- SPL Token Docs: https://spl.solana.com/token

---
This documentation provides comprehensive coverage of Solana development.
For more details, refer to the official documentation.
`.repeat(10); // Simulate ~65KB of docs (10x repeat to simulate larger docs)

// ============================================================================
// Utility Functions
// ============================================================================

interface ComparisonResult {
  method: "vector_search" | "full_fetch";
  contextSizeBytes: number;
  contextSizeKB: number;
  estimatedTokens: number;
  estimatedCost: number;
  retrievalTimeMs: number;
  chunkCount: number;
}

interface ComparisonReport {
  contract: string;
  vectorSearch: ComparisonResult;
  fullFetch: ComparisonResult;
  savings: {
    sizeReductionPercent: number;
    tokenSavings: number;
    costSavings: number;
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CONFIG.charsPerToken);
}

function estimateCost(tokens: number): number {
  return (tokens / 1_000_000) * CONFIG.costPer1MTokens;
}

function buildSearchQueries(sourceCode: string, ecosystem: string): string[] {
  const queries: string[] = [];
  queries.push(`${ecosystem} smart contract development guide`);

  const patterns = [
    { pattern: /mapping\s*\(/i, query: `${ecosystem} storage mapping state` },
    { pattern: /modifier\s+\w+/i, query: `${ecosystem} access control modifier` },
    { pattern: /event\s+\w+/i, query: `${ecosystem} events emit logging` },
    { pattern: /payable/i, query: `${ecosystem} transfer tokens SOL` },
    { pattern: /msg\.sender/i, query: `${ecosystem} caller signer account` },
    { pattern: /require\s*\(/i, query: `${ecosystem} error handling require assert` },
    { pattern: /struct\s+\w+/i, query: `${ecosystem} account data struct` },
    { pattern: /ERC20|ERC721|token/i, query: `${ecosystem} token SPL fungible NFT` },
    { pattern: /onlyOwner|Ownable/i, query: `${ecosystem} owner authority admin` },
  ];

  for (const { pattern, query } of patterns) {
    if (pattern.test(sourceCode)) {
      queries.push(query);
    }
  }

  return queries.slice(0, 5);
}

// ============================================================================
// Main Comparison Logic
// ============================================================================

async function runComparison(): Promise<void> {
  console.log("============================================================");
  console.log("TOKEN USAGE COMPARISON: Vector Search vs Full Fetch");
  console.log("============================================================\n");

  // Initialize components
  console.log("Initializing embedding model...");
  const embeddingGenerator = createEmbeddingGenerator();
  await embeddingGenerator.initialize();
  console.log("Model loaded successfully.\n");

  // Clean up previous test data
  if (fs.existsSync(CONFIG.dbPath)) {
    fs.rmSync(CONFIG.dbPath, { recursive: true, force: true });
  }

  // Initialize vector database
  console.log("Initializing vector database...");
  const vectorDB = new VectorDB({ dataPath: CONFIG.dbPath });
  await vectorDB.connect();

  // Ingest documentation into vector DB
  console.log("Chunking and ingesting documentation...");
  const chunks = chunkMarkdown(FULL_SOLANA_DOCS);
  console.log(`Created ${chunks.length} chunks from documentation.\n`);

  // Generate embeddings and store
  const documentChunks: DocumentChunk[] = [];
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
  console.log(`Stored ${documentChunks.length} document chunks in vector DB.\n`);

  // Run comparisons for each contract type
  const reports: ComparisonReport[] = [];

  for (const [contractType, sourceCode] of Object.entries(TEST_CONTRACTS)) {
    console.log("------------------------------------------------------------");
    console.log(`Testing: ${contractType.toUpperCase()} contract`);
    console.log("------------------------------------------------------------\n");

    // Vector search retrieval
    const vectorStartTime = performance.now();
    const searchQueries = buildSearchQueries(sourceCode, "solana");

    let vectorContext = "";
    let vectorChunkCount = 0;

    for (const query of searchQueries) {
      const queryEmbedding = await embeddingGenerator.embed(query);
      const results = await vectorDB.search(
        queryEmbedding.embedding,
        "solana_docs",
        Math.ceil(CONFIG.vectorSearchLimit / searchQueries.length),
      );

      for (const result of results) {
        if (!vectorContext.includes(result.text)) {
          vectorContext += result.text + "\n\n";
          vectorChunkCount++;
        }
      }
    }
    const vectorEndTime = performance.now();

    const vectorResult: ComparisonResult = {
      method: "vector_search",
      contextSizeBytes: vectorContext.length,
      contextSizeKB: vectorContext.length / 1024,
      estimatedTokens: estimateTokens(vectorContext),
      estimatedCost: estimateCost(estimateTokens(vectorContext)),
      retrievalTimeMs: Math.round(vectorEndTime - vectorStartTime),
      chunkCount: vectorChunkCount,
    };

    // Full fetch (simulated)
    const fullFetchStartTime = performance.now();
    const fullContext = FULL_SOLANA_DOCS;
    const fullFetchEndTime = performance.now();

    const fullFetchResult: ComparisonResult = {
      method: "full_fetch",
      contextSizeBytes: fullContext.length,
      contextSizeKB: fullContext.length / 1024,
      estimatedTokens: estimateTokens(fullContext),
      estimatedCost: estimateCost(estimateTokens(fullContext)),
      retrievalTimeMs: Math.round(fullFetchEndTime - fullFetchStartTime),
      chunkCount: 1,
    };

    // Calculate savings
    const sizeReductionPercent =
      ((fullFetchResult.contextSizeBytes - vectorResult.contextSizeBytes) /
       fullFetchResult.contextSizeBytes) * 100;

    const tokenSavings = fullFetchResult.estimatedTokens - vectorResult.estimatedTokens;
    const costSavings = fullFetchResult.estimatedCost - vectorResult.estimatedCost;

    const report: ComparisonReport = {
      contract: contractType,
      vectorSearch: vectorResult,
      fullFetch: fullFetchResult,
      savings: {
        sizeReductionPercent,
        tokenSavings,
        costSavings,
      },
    };

    reports.push(report);

    // Print results
    console.log("VECTOR SEARCH (RAG):");
    console.log(`  Context size: ${vectorResult.contextSizeKB.toFixed(1)}KB`);
    console.log(`  Estimated tokens: ${vectorResult.estimatedTokens.toLocaleString()}`);
    console.log(`  Estimated cost: $${vectorResult.estimatedCost.toFixed(4)}`);
    console.log(`  Retrieval time: ${vectorResult.retrievalTimeMs}ms`);
    console.log(`  Chunks retrieved: ${vectorResult.chunkCount}`);
    console.log();

    console.log("FULL FETCH (No RAG):");
    console.log(`  Context size: ${fullFetchResult.contextSizeKB.toFixed(1)}KB`);
    console.log(`  Estimated tokens: ${fullFetchResult.estimatedTokens.toLocaleString()}`);
    console.log(`  Estimated cost: $${fullFetchResult.estimatedCost.toFixed(4)}`);
    console.log(`  Retrieval time: ${fullFetchResult.retrievalTimeMs}ms`);
    console.log();

    console.log("SAVINGS:");
    console.log(`  Size reduction: ${sizeReductionPercent.toFixed(1)}%`);
    console.log(`  Token savings: ${tokenSavings.toLocaleString()} tokens`);
    console.log(`  Cost savings: $${costSavings.toFixed(4)} per request`);
    console.log();
  }

  // Print summary
  console.log("============================================================");
  console.log("SUMMARY");
  console.log("============================================================\n");

  const avgSizeReduction =
    reports.reduce((sum, r) => sum + r.savings.sizeReductionPercent, 0) / reports.length;
  const avgTokenSavings =
    reports.reduce((sum, r) => sum + r.savings.tokenSavings, 0) / reports.length;
  const avgCostSavings =
    reports.reduce((sum, r) => sum + r.savings.costSavings, 0) / reports.length;

  console.log("Average Results:");
  console.log(`  Size reduction: ${avgSizeReduction.toFixed(1)}%`);
  console.log(`  Token savings: ${Math.round(avgTokenSavings).toLocaleString()} tokens per request`);
  console.log(`  Cost savings: $${avgCostSavings.toFixed(4)} per request`);
  console.log();

  // Validate targets
  const TARGET_SIZE_REDUCTION = 90; // 90% reduction target
  const TARGET_RETRIEVAL_TIME = 100; // 100ms target

  console.log("Target Validation:");

  if (avgSizeReduction >= TARGET_SIZE_REDUCTION) {
    console.log(`  ✅ Size reduction: ${avgSizeReduction.toFixed(1)}% >= ${TARGET_SIZE_REDUCTION}% target`);
  } else {
    console.log(`  ❌ Size reduction: ${avgSizeReduction.toFixed(1)}% < ${TARGET_SIZE_REDUCTION}% target`);
  }

  const maxRetrievalTime = Math.max(...reports.map(r => r.vectorSearch.retrievalTimeMs));
  if (maxRetrievalTime <= TARGET_RETRIEVAL_TIME) {
    console.log(`  ✅ Retrieval time: ${maxRetrievalTime}ms <= ${TARGET_RETRIEVAL_TIME}ms target`);
  } else {
    console.log(`  ❌ Retrieval time: ${maxRetrievalTime}ms > ${TARGET_RETRIEVAL_TIME}ms target`);
  }

  console.log();

  // Cost projection
  console.log("Cost Projection (1000 requests/day):");
  const dailyRequests = 1000;
  const dailySavings = avgCostSavings * dailyRequests;
  const monthlySavings = dailySavings * 30;
  console.log(`  Daily savings: $${dailySavings.toFixed(2)}`);
  console.log(`  Monthly savings: $${monthlySavings.toFixed(2)}`);
  console.log();

  // Cleanup
  await vectorDB.close();
  if (fs.existsSync(CONFIG.dbPath)) {
    fs.rmSync(CONFIG.dbPath, { recursive: true, force: true });
  }

  console.log("============================================================");
  if (avgSizeReduction >= TARGET_SIZE_REDUCTION && maxRetrievalTime <= TARGET_RETRIEVAL_TIME) {
    console.log("✅ ALL TARGETS MET - Vector DB provides significant benefits!");
  } else {
    console.log("⚠️  Some targets not met - review implementation");
  }
  console.log("============================================================");
}

// Run the comparison
runComparison().catch(console.error);
