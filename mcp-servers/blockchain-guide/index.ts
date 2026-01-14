#!/usr/bin/env node
/**
 * Blockchain Translation Guide MCP Server
 *
 * Universal blockchain documentation and translation guide server.
 * Provides LLM-optimized documentation, version information, and translation patterns
 * for all supported blockchain ecosystems.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "path";
import { homedir } from "os";

// Import vector database modules
import { VectorDB, type DocumentChunk } from "./src/vector_db.js";
import { chunkMarkdown, type Chunk } from "./src/chunker.js";
import { getEmbeddingGenerator, type EmbeddingProgress } from "./src/embeddings.js";

// ============================================================================
// Configuration
// ============================================================================

// LLM-optimized documentation sources
const DOCS_SOURCES = {
  solana: "https://solana.com/llms.txt",
  // Add more as they become available:
  // sui: 'https://docs.sui.io/llms.txt',
  // anchor: 'https://www.anchor-lang.com/llms.txt',
};

// GitHub repositories for release tracking
const GITHUB_REPOS = {
  solana: "solana-labs/solana",
  anchor: "coral-xyz/anchor",
  sui: "MystenLabs/sui",
};

// Optional GitHub token for higher rate limits
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

// Cache configuration
interface CacheEntry {
  data: string;
  timestamp: number;
}

const docsCache = new Map<string, CacheEntry>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// ============================================================================
// Vector Database Configuration
// ============================================================================

/** Path to store vector database files */
const VECTOR_DB_PATH = join(homedir(), ".dyad", "vectors");

/** Ingestion batch size for embeddings */
const EMBEDDING_BATCH_SIZE = 50;

/** Table name prefix for ecosystem docs */
const DOCS_TABLE_PREFIX = "docs_";

/** Singleton VectorDB instance */
let vectorDB: VectorDB | null = null;

/**
 * Get or create the VectorDB instance
 */
async function getVectorDB(): Promise<VectorDB> {
  if (!vectorDB) {
    vectorDB = new VectorDB({ dataPath: VECTOR_DB_PATH });
    await vectorDB.connect();
  }
  return vectorDB;
}

/**
 * Ingestion metadata for tracking versions
 */
interface IngestionMetadata {
  ecosystem: string;
  source: string;
  version: string;
  chunkCount: number;
  embeddingModel: string;
  ingestedAt: number;
}

/** In-memory metadata cache (would be stored in SQLite in production) */
const ingestionMetadataCache = new Map<string, IngestionMetadata>();

/**
 * Version information for remote documentation
 */
interface VersionInfo {
  ecosystem: string;
  remoteVersion: string;
  storedVersion: string | null;
  needsUpdate: boolean;
  lastChecked: number;
}

/** Cache for version checks to avoid excessive network requests */
const versionCheckCache = new Map<string, { version: string; timestamp: number }>();
const VERSION_CHECK_TTL = 1000 * 60 * 5; // 5 minutes

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fetch and cache documentation/URLs with TTL
 */
async function fetchDocs(url: string): Promise<string> {
  const cached = docsCache.get(url);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "blockchain-guide-mcp-server",
    };

    if (GITHUB_TOKEN && url.includes("github.com")) {
      headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.text();
    docsCache.set(url, { data, timestamp: now });
    return data;
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error);
    return cached?.data || `Failed to fetch from ${url}. Error: ${error}`;
  }
}

/**
 * Parse sitemap XML and extract URLs
 */
function parseSitemap(xml: string): string[] {
  const urls: string[] = [];
  // Simple regex to extract URLs from sitemap XML
  const urlMatches = xml.matchAll(/<loc>(.*?)<\/loc>/g);
  for (const match of urlMatches) {
    urls.push(match[1]);
  }
  return urls;
}

/**
 * Fetch and aggregate Sui documentation from sitemap
 */
async function fetchSuiDocs(): Promise<string> {
  const cacheKey = "sui-docs-aggregated";
  const cached = docsCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // Fetch sitemap
    const sitemapUrl = "https://docs.sui.io/sitemap.xml";
    const sitemap = await fetchDocs(sitemapUrl);
    const allUrls = parseSitemap(sitemap);

    // Filter for relevant documentation (guides, tutorials, concepts)
    const relevantUrls = allUrls
      .filter(
        (url) =>
          url.includes("/guides/developer/") ||
          url.includes("/concepts/") ||
          url.includes("/references/move/"),
      )
      .slice(0, 20); // Limit to first 20 pages to avoid overwhelming

    console.log(
      `Found ${relevantUrls.length} relevant Sui documentation pages`,
    );

    // Fetch key pages in parallel
    const pagePromises = relevantUrls.slice(0, 10).map(async (url) => {
      try {
        const html = await fetchDocs(url);
        // Extract main content (strip HTML tags, keep structure)
        const content = stripHtmlToText(html);
        return `\n\n## ${url}\n\n${content.slice(0, 5000)}`; // Limit each page to 5KB
      } catch (error) {
        console.error(`Failed to fetch ${url}:`, error);
        return "";
      }
    });

    const pages = await Promise.all(pagePromises);
    const aggregatedDocs = `# Sui Documentation (Aggregated from docs.sui.io)\n\n${pages.filter((p) => p).join("\n\n---\n\n")}`;

    docsCache.set(cacheKey, { data: aggregatedDocs, timestamp: now });
    return aggregatedDocs;
  } catch (error) {
    console.error("Failed to fetch Sui documentation:", error);
    return `# Sui Documentation\n\nFailed to fetch documentation. Visit https://docs.sui.io\n\nError: ${error}`;
  }
}

/**
 * Strip HTML tags and extract readable text
 */
function stripHtmlToText(html: string): string {
  // Remove script and style tags
  let text = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    "",
  );
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // Replace common HTML entities
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');

  // Remove HTML tags but keep line breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<[^>]+>/g, "");

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

/**
 * Extract specific sections from markdown text
 */
function extractSection(text: string, keywords: string[]): string | null {
  const lines = text.split("\n");
  let inSection = false;
  const sectionContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    const isHeader =
      line.startsWith("#") || line.startsWith("##") || line.startsWith("###");
    const matchesKeyword = keywords.some((kw) =>
      lower.includes(kw.toLowerCase()),
    );

    if (isHeader && matchesKeyword) {
      inSection = true;
      sectionContent.push(line);
      continue;
    }

    if (inSection && isHeader && !matchesKeyword) {
      break;
    }

    if (inSection) {
      sectionContent.push(line);
      if (sectionContent.length > 100) break;
    }
  }

  return sectionContent.length > 1 ? sectionContent.join("\n").trim() : null;
}

/**
 * Extract URLs from text
 */
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s)]+/g;
  return text.match(urlRegex) || [];
}

// ============================================================================
// Version Checking Functions
// ============================================================================

/**
 * Compute a content hash for version tracking.
 * Uses a simple hash based on content length and sampling for efficiency.
 */
function computeContentHash(content: string): string {
  // Sample content at multiple positions to detect changes
  const sampleSize = 1000;
  const contentLength = content.length;
  const samples: string[] = [];

  // Take samples from start, middle, and end
  samples.push(content.slice(0, sampleSize));
  samples.push(content.slice(Math.floor(contentLength / 2), Math.floor(contentLength / 2) + sampleSize));
  samples.push(content.slice(-sampleSize));

  // Create a simple hash from length + sample characters
  let hash = contentLength.toString(36);
  const combined = samples.join("");
  let charSum = 0;
  for (let i = 0; i < combined.length; i++) {
    charSum = (charSum + combined.charCodeAt(i)) % 0xFFFFFFFF;
  }
  hash += "-" + charSum.toString(36);

  return hash;
}

/**
 * Fetch the current version of remote documentation.
 * Uses content hashing to detect changes.
 */
async function fetchRemoteVersion(ecosystem: string): Promise<string> {
  // Check cache first
  const cached = versionCheckCache.get(ecosystem);
  const now = Date.now();
  if (cached && now - cached.timestamp < VERSION_CHECK_TTL) {
    return cached.version;
  }

  let content: string;
  if (ecosystem === "solana" && DOCS_SOURCES.solana) {
    content = await fetchDocs(DOCS_SOURCES.solana);
  } else if (ecosystem === "sui") {
    content = await fetchSuiDocs();
  } else {
    throw new Error(`Unknown ecosystem: ${ecosystem}`);
  }

  const version = computeContentHash(content);
  versionCheckCache.set(ecosystem, { version, timestamp: now });
  return version;
}

/**
 * Check if the stored documentation needs to be updated.
 * Compares the stored version hash with the remote version hash.
 *
 * @param ecosystem - The ecosystem to check (solana, sui)
 * @returns VersionInfo with needsUpdate flag
 */
async function needsUpdate(ecosystem: string): Promise<VersionInfo> {
  const storedMetadata = ingestionMetadataCache.get(ecosystem);
  const storedVersion = storedMetadata?.version || null;

  // Fetch remote version
  const remoteVersion = await fetchRemoteVersion(ecosystem);

  // Compare versions
  const updateNeeded = storedVersion !== remoteVersion;

  return {
    ecosystem,
    remoteVersion,
    storedVersion,
    needsUpdate: updateNeeded,
    lastChecked: Date.now(),
  };
}

/**
 * Check version staleness based on age.
 * Documentation older than the threshold is considered stale.
 */
function isVersionStale(ecosystem: string, maxAgeHours: number = 24): boolean {
  const storedMetadata = ingestionMetadataCache.get(ecosystem);
  if (!storedMetadata) {
    return true; // No stored version means we need to ingest
  }

  const ageMs = Date.now() - storedMetadata.ingestedAt;
  const ageHours = ageMs / (1000 * 60 * 60);
  return ageHours > maxAgeHours;
}

// ============================================================================
// Automatic Re-Ingestion Functions
// ============================================================================

/**
 * Result of an auto-ingest operation
 */
interface AutoIngestResult {
  /** Whether ingestion was performed */
  ingested: boolean;
  /** Reason for the action taken */
  reason: "up_to_date" | "version_changed" | "not_indexed" | "stale" | "forced" | "error";
  /** Ecosystem that was checked/ingested */
  ecosystem: string;
  /** Error message if ingestion failed */
  error?: string;
  /** Number of chunks if ingestion was performed */
  chunkCount?: number;
  /** Duration in seconds if ingestion was performed */
  durationSeconds?: number;
  /** Version hash after operation */
  version?: string;
}

/**
 * Automatically ingest documentation if the version has changed or if not indexed.
 * This is the main entry point for automatic re-ingestion.
 *
 * @param ecosystem - The ecosystem to check and potentially ingest
 * @param options - Configuration options
 * @returns Result indicating what action was taken
 */
async function autoIngestIfNeeded(
  ecosystem: string,
  options: {
    /** Force re-ingestion regardless of version */
    force?: boolean;
    /** Consider docs stale if older than this (hours) */
    maxAgeHours?: number;
    /** Check for remote version changes */
    checkRemote?: boolean;
  } = {}
): Promise<AutoIngestResult> {
  const { force = false, maxAgeHours = 24, checkRemote = true } = options;
  const tableName = `${DOCS_TABLE_PREFIX}${ecosystem}`;
  const startTime = Date.now();

  try {
    // Check if forced
    if (force) {
      return await performIngestion(ecosystem, tableName, startTime, "forced");
    }

    // Check if not indexed at all
    const db = await getVectorDB();
    const tableExists = await db.tableExists(tableName);
    const storedMetadata = ingestionMetadataCache.get(ecosystem);

    if (!tableExists || !storedMetadata) {
      return await performIngestion(ecosystem, tableName, startTime, "not_indexed");
    }

    // Check staleness by age
    if (isVersionStale(ecosystem, maxAgeHours)) {
      return await performIngestion(ecosystem, tableName, startTime, "stale");
    }

    // Check for remote version changes if enabled
    if (checkRemote) {
      const versionInfo = await needsUpdate(ecosystem);
      if (versionInfo.needsUpdate) {
        return await performIngestion(ecosystem, tableName, startTime, "version_changed");
      }
    }

    // No update needed
    return {
      ingested: false,
      reason: "up_to_date",
      ecosystem,
      version: storedMetadata.version,
      chunkCount: storedMetadata.chunkCount,
    };
  } catch (error) {
    return {
      ingested: false,
      reason: "error",
      ecosystem,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Helper function to perform the actual ingestion
 */
async function performIngestion(
  ecosystem: string,
  tableName: string,
  startTime: number,
  reason: AutoIngestResult["reason"]
): Promise<AutoIngestResult> {
  try {
    // Fetch documentation
    let docsContent: string;
    let sourceUrl: string;

    if (ecosystem === "solana" && DOCS_SOURCES.solana) {
      docsContent = await fetchDocs(DOCS_SOURCES.solana);
      sourceUrl = DOCS_SOURCES.solana;
    } else if (ecosystem === "sui") {
      docsContent = await fetchSuiDocs();
      sourceUrl = "https://docs.sui.io";
    } else {
      return {
        ingested: false,
        reason: "error",
        ecosystem,
        error: `Documentation source not configured for ${ecosystem}`,
      };
    }

    // Chunk the documentation
    const chunks = chunkMarkdown(docsContent);

    if (chunks.length === 0) {
      return {
        ingested: false,
        reason: "error",
        ecosystem,
        error: "No content to ingest - documentation may be empty",
      };
    }

    // Generate embeddings in batches
    const embeddingGenerator = getEmbeddingGenerator();
    const documentChunks: DocumentChunk[] = [];
    const batchCount = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
      const batchStart = batchIdx * EMBEDDING_BATCH_SIZE;
      const batchEnd = Math.min(batchStart + EMBEDDING_BATCH_SIZE, chunks.length);
      const batchChunks = chunks.slice(batchStart, batchEnd);

      const texts = batchChunks.map((c: Chunk) => c.text);
      const embedResult = await embeddingGenerator.embedBatch(texts);

      for (let i = 0; i < batchChunks.length; i++) {
        const chunk = batchChunks[i];
        documentChunks.push({
          id: `${ecosystem}-${chunk.index}`,
          text: chunk.text,
          source: ecosystem,
          section: chunk.section || "general",
          vector: embedResult.embeddings[i],
          chunkIndex: chunk.index,
          createdAt: Date.now(),
        });
      }
    }

    // Store in vector database (overwrite existing)
    const db = await getVectorDB();
    await db.createTable(tableName, documentChunks, true);

    // Create index if we have enough rows
    if (documentChunks.length > 1000) {
      await db.createIndex(tableName);
    }

    // Update metadata cache
    const contentVersion = computeContentHash(docsContent);
    const metadata: IngestionMetadata = {
      ecosystem,
      source: sourceUrl,
      version: contentVersion,
      chunkCount: documentChunks.length,
      embeddingModel: embeddingGenerator.getModelId(),
      ingestedAt: Date.now(),
    };
    ingestionMetadataCache.set(ecosystem, metadata);
    versionCheckCache.set(ecosystem, { version: contentVersion, timestamp: Date.now() });

    const durationSeconds = (Date.now() - startTime) / 1000;

    return {
      ingested: true,
      reason,
      ecosystem,
      chunkCount: documentChunks.length,
      durationSeconds,
      version: contentVersion,
    };
  } catch (error) {
    return {
      ingested: false,
      reason: "error",
      ecosystem,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Convenience function to check and update documentation if needed.
 * Alias for autoIngestIfNeeded for semantic clarity.
 */
async function updateIfNeeded(
  ecosystem: string,
  options?: {
    force?: boolean;
    maxAgeHours?: number;
    checkRemote?: boolean;
  }
): Promise<AutoIngestResult> {
  return autoIngestIfNeeded(ecosystem, options);
}

// ============================================================================
// Translation Guides (Static, Well-Tested Patterns)
// ============================================================================

const TRANSLATION_GUIDES = {
  "solidity-to-sui": `# Solidity → Sui Move Translation Guide

## Core Differences

### 1. Object-Centric Model
**Solidity:** Contract storage with mappings
**Sui Move:** Objects with UIDs, owned or shared

\`\`\`move
// Instead of: mapping(address => uint256) balances;
public struct Balance has key {
    id: UID,
    value: u64,
    owner: address
}
\`\`\`

### 2. Capability Pattern for Access Control
**Solidity:** \`onlyOwner\` modifier
**Sui Move:** Capability objects

\`\`\`move
public struct AdminCap has key, store { id: UID }

public fun admin_action(_: &AdminCap, ctx: &mut TxContext) {
    // Only holders of AdminCap can call
}
\`\`\`

### 3. Transfer Objects, Not Values
**Solidity:** \`transfer(address, uint256)\`
**Sui Move:** \`transfer::public_transfer()\`

\`\`\`move
public fun transfer_balance(balance: Balance, recipient: address) {
    transfer::public_transfer(balance, recipient);
}
\`\`\`

### 4. Resource Safety
- All objects must be explicitly handled
- No implicit storage or deletion
- Use \`sui::coin::Coin<T>\` for fungible tokens

### 5. Testing Pattern
\`\`\`move
#[test_only]
module my_package::my_module_tests {
    use sui::test_scenario;

    #[test]
    fun test_transfer() {
        let mut scenario = test_scenario::begin(@0xA);
        // Test code
        test_scenario::end(scenario);
    }
}
\`\`\`

## Common Pitfalls
1. Don't try to store mutable references
2. Always handle object ownership explicitly
3. Use shared objects for multi-user access
4. Implement proper capability patterns for admin functions
`,

  "solidity-to-solana": `# Solidity → Solana/Anchor Translation Guide

## Core Differences

### 1. Account Model vs Contract Storage
**Solidity:** Contract stores all data
**Solana:** Data stored in separate PDA accounts

\`\`\`rust
#[account]
pub struct UserData {
    pub owner: Pubkey,
    pub balance: u64,
    pub bump: u8,
}
\`\`\`

### 2. Program Derived Addresses (PDAs)
\`\`\`rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + UserData::LEN,
        seeds = [b"user-data", user.key().as_ref()],
        bump
    )]
    pub user_data: Account<'info, UserData>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}
\`\`\`

### 3. Instructions vs Functions
**Solidity:** public functions
**Anchor:** instruction handlers

\`\`\`rust
pub fn transfer(ctx: Context<Transfer>, amount: u64) -> Result<()> {
    let from = &mut ctx.accounts.from;
    let to = &mut ctx.accounts.to;

    require!(from.balance >= amount, ErrorCode::InsufficientFunds);

    from.balance = from.balance.checked_sub(amount).unwrap();
    to.balance = to.balance.checked_add(amount).unwrap();

    Ok(())
}
\`\`\`

### 4. Security Constraints
\`\`\`rust
#[account(
    mut,
    has_one = authority,  // Verify authority matches
    constraint = account.balance >= amount @ ErrorCode::InsufficientFunds
)]
pub account: Account<'info, TokenAccount>,
\`\`\`

## Best Practices
1. Always use checked arithmetic
2. Implement proper PDA validation
3. Use anchor constraints for security
4. Close accounts when done to reclaim SOL
`,
};

// ============================================================================
// Feature Compatibility Matrix
// ============================================================================

const FEATURE_COMPATIBILITY = {
  mapping: {
    sui: "Use Table<K, V> or ObjectTable<K, V> for key-value storage, or create individual objects",
    solana:
      "Use PDA accounts with seeds based on keys. Each entry is a separate account.",
  },
  modifier: {
    sui: "Use capability objects (e.g., AdminCap) passed as function parameters",
    solana:
      "Use Anchor constraints like has_one, constraint, or custom validation in instruction",
  },
  event: {
    sui: "Use sui::event::emit() with custom event structs",
    solana: "Use anchor_lang::emit! macro with event structs",
  },
  inheritance: {
    sui: "No direct inheritance. Use composition and generic types instead",
    solana: "No inheritance. Use traits and composition patterns",
  },
  payable: {
    sui: "Accept Coin<SUI> objects as parameters. Amount is coin.value()",
    solana: "Transfer SOL using system_program instructions or use SPL tokens",
  },
  constructor: {
    sui: "Use init() function that runs once on publish",
    solana: "Use initialize instruction with PDA account creation",
  },
  "require/assert": {
    sui: "Use assert!() macro",
    solana: "Use require!() macro or custom error codes",
  },
};

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new McpServer({
  name: "blockchain-translation-guide",
  version: "2.0.0",
});

// ============================================================================
// Tool 1: Fetch Ecosystem Documentation
// ============================================================================

server.registerTool(
  "fetch-ecosystem-docs",
  {
    description:
      "Fetch comprehensive LLM-optimized documentation for a blockchain ecosystem. Returns full documentation (e.g., 645KB for Solana) with current APIs, patterns, and examples.",
    inputSchema: z.object({
      ecosystem: z
        .enum(["solana", "sui", "anchor"])
        .describe("Which blockchain ecosystem"),
    }),
  },
  async (args) => {
    const { ecosystem } = args;

    // For Solana, fetch the LLM-optimized docs
    if (ecosystem === "solana" && DOCS_SOURCES.solana) {
      try {
        const docs = await fetchDocs(DOCS_SOURCES.solana);
        return {
          content: [
            {
              type: "text",
              text: `# Solana LLM-Optimized Documentation\n\n${docs}\n\n---\nSource: ${DOCS_SOURCES.solana}\nFetched: ${new Date().toISOString()}\nSize: ${(docs.length / 1024).toFixed(0)}KB`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch Solana documentation: ${error}\n\nVisit https://solana.com/docs for official documentation.`,
            },
          ],
        };
      }
    }

    // For Anchor, refer to Solana docs (Anchor is part of Solana ecosystem)
    if (ecosystem === "anchor") {
      return {
        content: [
          {
            type: "text",
            text: `# Anchor Documentation\n\nAnchor is the Solana framework for building programs.\n\n**Resources:**\n- Use fetch-ecosystem-docs({ ecosystem: 'solana' }) for Solana documentation\n- Official Anchor examples: https://github.com/coral-xyz/anchor/tree/master/tests\n- Anchor book: https://www.anchor-lang.com/docs\n\nFor version information, use fetch-latest-releases({ ecosystem: 'anchor' })`,
          },
        ],
      };
    }

    // For Sui, fetch and aggregate documentation from sitemap
    if (ecosystem === "sui") {
      try {
        const docs = await fetchSuiDocs();
        return {
          content: [
            {
              type: "text",
              text: `${docs}\n\n---\nSource: https://docs.sui.io (aggregated from sitemap)\nFetched: ${new Date().toISOString()}\nSize: ${(docs.length / 1024).toFixed(0)}KB`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch Sui documentation: ${error}\n\nVisit https://docs.sui.io for official documentation.`,
            },
          ],
        };
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Documentation not available for ${ecosystem}`,
        },
      ],
    };
  },
);

// ============================================================================
// Tool 2: Fetch Latest Releases
// ============================================================================

server.registerTool(
  "fetch-latest-releases",
  {
    description:
      "Fetch the latest release version and full release notes from GitHub. Returns current version, breaking changes, new features, and documentation links.",
    inputSchema: z.object({
      ecosystem: z
        .enum(["solana", "anchor", "sui", "all"])
        .describe("Which ecosystem to get version info for"),
    }),
  },
  async (args) => {
    const { ecosystem } = args;
    const results: string[] = [];
    const ecosystems =
      ecosystem === "all" ? ["solana", "anchor", "sui"] : [ecosystem];

    for (const eco of ecosystems) {
      try {
        const repo = GITHUB_REPOS[eco as keyof typeof GITHUB_REPOS];
        const url = `https://api.github.com/repos/${repo}/releases/latest`;

        const response = await fetch(url, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "blockchain-guide-mcp-server",
          },
        });

        if (!response.ok) {
          results.push(
            `## ${eco.toUpperCase()}\nFailed to fetch (HTTP ${response.status})`,
          );
          continue;
        }

        const data = (await response.json()) as {
          tag_name: string;
          name: string;
          published_at: string;
          html_url: string;
          body?: string;
        };

        const releaseBody = data.body || "No release notes available";

        // Extract key sections
        const breaking = extractSection(releaseBody, [
          "breaking",
          "breaking changes",
          "migration",
        ]);
        const features = extractSection(releaseBody, [
          "features",
          "new features",
          "additions",
          "added",
        ]);
        const fixes = extractSection(releaseBody, [
          "fixes",
          "bug fixes",
          "fixed",
        ]);

        // Extract documentation URLs
        const docUrls = extractUrls(releaseBody).filter(
          (url) =>
            url.includes("docs.") ||
            url.includes("/docs") ||
            url.includes("changelog") ||
            url.includes("migration"),
        );

        let releaseInfo = `## ${eco.toUpperCase()} - ${data.tag_name}\n\n`;
        releaseInfo += `**Published:** ${new Date(data.published_at).toLocaleDateString()}\n`;
        releaseInfo += `**Release URL:** ${data.html_url}\n\n`;

        if (breaking) {
          releaseInfo += `### Breaking Changes\n${breaking}\n\n`;
        }

        if (features) {
          releaseInfo += `### New Features\n${features}\n\n`;
        }

        if (fixes) {
          releaseInfo += `### Bug Fixes\n${fixes}\n\n`;
        }

        releaseInfo += `### Full Release Notes\n${releaseBody.substring(0, 3000)}`;
        if (releaseBody.length > 3000) {
          releaseInfo += `...\n\n📖 [Read Complete Notes](${data.html_url})`;
        }

        if (docUrls.length > 0) {
          releaseInfo += `\n\n### Documentation\n`;
          docUrls.slice(0, 3).forEach((url) => {
            releaseInfo += `- ${url}\n`;
          });
        }

        results.push(releaseInfo);
      } catch (error) {
        results.push(`## ${eco.toUpperCase()}\nError: ${error}`);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `# Latest Releases\n\n${results.join("\n\n---\n\n")}\n\n---\nFetched: ${new Date().toISOString()}`,
        },
      ],
    };
  },
);

// ============================================================================
// Tool 3: Get Translation Guide
// ============================================================================

server.registerTool(
  "get-translation-guide",
  {
    description:
      "Get translation patterns and guidelines for converting between blockchain languages. Provides key differences, code examples, and best practices.",
    inputSchema: z.object({
      from: z.enum(["solidity"]).describe("Source language"),
      to: z.enum(["solana", "sui"]).describe("Target blockchain"),
    }),
  },
  async (args) => {
    const { from, to } = args;
    const guideKey = `${from}-to-${to}` as keyof typeof TRANSLATION_GUIDES;
    const guide = TRANSLATION_GUIDES[guideKey];

    if (!guide) {
      return {
        content: [
          {
            type: "text",
            text: `Translation guide from ${from} to ${to} not available.\n\nSupported translations:\n${Object.keys(TRANSLATION_GUIDES).join("\n")}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: guide,
        },
      ],
    };
  },
);

// ============================================================================
// Tool 4: Check Feature Compatibility
// ============================================================================

server.registerTool(
  "check-feature-compatibility",
  {
    description:
      "Check how a specific Solidity feature translates to the target blockchain. Provides quick lookup for common patterns.",
    inputSchema: z.object({
      feature: z
        .string()
        .describe(
          'Solidity feature (e.g., "mapping", "modifier", "event", "inheritance")',
        ),
      target: z.enum(["solana", "sui"]).describe("Target blockchain"),
    }),
  },
  async (args) => {
    const { feature, target } = args;
    const featureLower = feature.toLowerCase();

    const compatibility =
      FEATURE_COMPATIBILITY[featureLower as keyof typeof FEATURE_COMPATIBILITY];

    if (!compatibility) {
      return {
        content: [
          {
            type: "text",
            text: `# Feature: ${feature} → ${target.toUpperCase()}\n\nNo specific compatibility info available.\n\n**Available features:**\n${Object.keys(FEATURE_COMPATIBILITY).join(", ")}\n\nUse get-translation-guide for comprehensive patterns.`,
          },
        ],
      };
    }

    const advice = compatibility[target];

    return {
      content: [
        {
          type: "text",
          text: `# ${feature} → ${target.toUpperCase()}\n\n${advice}\n\n💡 Use get-translation-guide({ from: 'solidity', to: '${target}' }) for complete examples.`,
        },
      ],
    };
  },
);

// ============================================================================
// Tool 5: Ingest Documentation into Vector Database
// ============================================================================

server.registerTool(
  "ingest-docs",
  {
    description:
      "Ingest documentation for a blockchain ecosystem into the vector database. Fetches docs, chunks them semantically, generates embeddings, and stores in LanceDB for fast retrieval. Use this to prepare docs for vector search.",
    inputSchema: z.object({
      ecosystem: z
        .enum(["solana", "sui"])
        .describe("Which blockchain ecosystem to ingest docs for"),
      force: z
        .boolean()
        .optional()
        .describe("Force re-ingestion even if docs are already indexed (default: false)"),
    }),
  },
  async (args) => {
    const { ecosystem, force = false } = args;
    const tableName = `${DOCS_TABLE_PREFIX}${ecosystem}`;
    const startTime = Date.now();

    try {
      // Check if already ingested and not forcing refresh
      const existingMetadata = ingestionMetadataCache.get(ecosystem);
      if (existingMetadata && !force) {
        const ageMs = Date.now() - existingMetadata.ingestedAt;
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        return {
          content: [
            {
              type: "text",
              text: `# Already Ingested\n\nEcosystem: ${ecosystem}\nChunks: ${existingMetadata.chunkCount}\nIngested: ${ageHours}h ago\n\nUse force=true to re-ingest.`,
            },
          ],
        };
      }

      // Step 1: Fetch documentation
      let docsContent: string;
      let sourceUrl: string;

      if (ecosystem === "solana" && DOCS_SOURCES.solana) {
        docsContent = await fetchDocs(DOCS_SOURCES.solana);
        sourceUrl = DOCS_SOURCES.solana;
      } else if (ecosystem === "sui") {
        docsContent = await fetchSuiDocs();
        sourceUrl = "https://docs.sui.io";
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Documentation source not configured for ${ecosystem}`,
            },
          ],
        };
      }

      // Step 2: Chunk the documentation
      const chunks = chunkMarkdown(docsContent);

      if (chunks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No content to ingest for ${ecosystem}. Documentation may be empty.`,
            },
          ],
        };
      }

      // Step 3: Generate embeddings in batches
      const embeddingGenerator = getEmbeddingGenerator({
        onProgress: (progress: EmbeddingProgress) => {
          // Progress is logged to stderr for debugging
          if (progress.status === "downloading" && progress.progress) {
            console.error(`Model download: ${progress.progress.toFixed(1)}%`);
          }
        },
      });

      // Prepare document chunks with embeddings
      const documentChunks: DocumentChunk[] = [];
      const batchCount = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);

      for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
        const batchStart = batchIdx * EMBEDDING_BATCH_SIZE;
        const batchEnd = Math.min(batchStart + EMBEDDING_BATCH_SIZE, chunks.length);
        const batchChunks = chunks.slice(batchStart, batchEnd);

        // Extract texts for embedding
        const texts = batchChunks.map((c: Chunk) => c.text);

        // Generate embeddings for this batch
        const embedResult = await embeddingGenerator.embedBatch(texts);

        // Create document chunks with embeddings
        for (let i = 0; i < batchChunks.length; i++) {
          const chunk = batchChunks[i];
          documentChunks.push({
            id: `${ecosystem}-${chunk.index}`,
            text: chunk.text,
            source: ecosystem,
            section: chunk.section || "general",
            vector: embedResult.embeddings[i],
            chunkIndex: chunk.index,
            createdAt: Date.now(),
          });
        }
      }

      // Step 4: Store in vector database
      const db = await getVectorDB();
      await db.createTable(tableName, documentChunks, true);

      // Step 5: Create index if we have enough rows (>1000)
      if (documentChunks.length > 1000) {
        await db.createIndex(tableName);
      }

      // Step 6: Update metadata cache with content hash for version tracking
      const contentVersion = computeContentHash(docsContent);
      const metadata: IngestionMetadata = {
        ecosystem,
        source: sourceUrl,
        version: contentVersion, // Use content hash for version comparison
        chunkCount: documentChunks.length,
        embeddingModel: embeddingGenerator.getModelId(),
        ingestedAt: Date.now(),
      };
      ingestionMetadataCache.set(ecosystem, metadata);

      // Also update version check cache to avoid redundant fetches
      versionCheckCache.set(ecosystem, { version: contentVersion, timestamp: Date.now() });

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const docsKB = (docsContent.length / 1024).toFixed(0);

      return {
        content: [
          {
            type: "text",
            text: `# Ingestion Complete\n\n` +
              `**Ecosystem:** ${ecosystem}\n` +
              `**Source:** ${sourceUrl}\n` +
              `**Original Size:** ${docsKB}KB\n` +
              `**Chunks Created:** ${documentChunks.length}\n` +
              `**Index Created:** ${documentChunks.length > 1000 ? "Yes" : "No (brute force faster for <1000 rows)"}\n` +
              `**Duration:** ${durationSec}s\n` +
              `**Model:** ${embeddingGenerator.getModelId()}\n\n` +
              `Ready for vector search with search-docs tool.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `# Ingestion Failed\n\n` +
              `**Ecosystem:** ${ecosystem}\n` +
              `**Error:** ${error instanceof Error ? error.message : String(error)}\n\n` +
              `Please check that all dependencies are installed and try again.`,
          },
        ],
      };
    }
  },
);

// ============================================================================
// Tool 6: Search Documentation with Vector Similarity
// ============================================================================

server.registerTool(
  "search-docs",
  {
    description:
      "Search documentation using semantic vector similarity. Find relevant documentation chunks based on natural language queries. Requires docs to be ingested first via ingest-docs.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Natural language search query (e.g., 'how to create a token', 'PDA account validation')"),
      ecosystem: z
        .enum(["solana", "sui"])
        .describe("Which ecosystem's documentation to search"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum number of results to return (default: 5, max: 20)"),
    }),
  },
  async (args) => {
    const { query, ecosystem, limit = 5 } = args;
    const tableName = `${DOCS_TABLE_PREFIX}${ecosystem}`;

    try {
      // Check if docs have been ingested
      const db = await getVectorDB();
      const tableExists = await db.tableExists(tableName);

      if (!tableExists) {
        return {
          content: [
            {
              type: "text",
              text: `# No Documentation Indexed\n\n` +
                `The ${ecosystem} documentation has not been ingested yet.\n\n` +
                `**To index documentation, run:**\n` +
                `\`\`\`\ningest-docs({ ecosystem: '${ecosystem}' })\n\`\`\`\n\n` +
                `This will fetch, chunk, and embed the documentation for vector search.`,
            },
          ],
        };
      }

      // Generate embedding for the query
      const embeddingGenerator = getEmbeddingGenerator();
      const queryResult = await embeddingGenerator.embed(query);

      // Search for similar documents
      const results = await db.search(
        queryResult.embedding,
        tableName,
        limit,
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `# No Results Found\n\n` +
                `No matching documentation found for: "${query}"\n\n` +
                `**Suggestions:**\n` +
                `- Try different keywords or phrasing\n` +
                `- Use more specific technical terms\n` +
                `- Check if the documentation covers this topic`,
            },
          ],
        };
      }

      // Format results
      const formattedResults = results.map((result, index) => {
        const distance = result._distance !== undefined
          ? ` (similarity: ${(1 - result._distance).toFixed(3)})`
          : "";
        return `## Result ${index + 1}${distance}\n\n` +
          `**Section:** ${result.section}\n` +
          `**Source:** ${result.source}\n\n` +
          `${result.text}\n`;
      });

      const metadata = ingestionMetadataCache.get(ecosystem);
      const metadataInfo = metadata
        ? `\n---\n*Index: ${metadata.chunkCount} chunks, model: ${metadata.embeddingModel}*`
        : "";

      return {
        content: [
          {
            type: "text",
            text: `# Search Results for "${query}"\n\n` +
              `**Ecosystem:** ${ecosystem}\n` +
              `**Results:** ${results.length}\n\n` +
              formattedResults.join("\n---\n\n") +
              metadataInfo,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `# Search Failed\n\n` +
              `**Query:** ${query}\n` +
              `**Ecosystem:** ${ecosystem}\n` +
              `**Error:** ${error instanceof Error ? error.message : String(error)}\n\n` +
              `Please ensure the documentation has been ingested and try again.`,
          },
        ],
      };
    }
  },
);

// ============================================================================
// Tool 7: Check Documentation Version
// ============================================================================

server.registerTool(
  "check-version",
  {
    description:
      "Check if the indexed documentation is up-to-date with the remote source. Returns version information and whether re-ingestion is needed. Use this before search-docs to ensure you have the latest documentation.",
    inputSchema: z.object({
      ecosystem: z
        .enum(["solana", "sui"])
        .describe("Which ecosystem's documentation to check"),
      maxAgeHours: z
        .number()
        .min(1)
        .max(168) // max 1 week
        .optional()
        .describe("Consider docs stale if older than this (default: 24 hours)"),
    }),
  },
  async (args) => {
    const { ecosystem, maxAgeHours = 24 } = args;

    try {
      // Get stored metadata
      const storedMetadata = ingestionMetadataCache.get(ecosystem);

      // Check if we have any stored version
      if (!storedMetadata) {
        return {
          content: [
            {
              type: "text",
              text: `# Version Check: ${ecosystem.toUpperCase()}\n\n` +
                `**Status:** Not Indexed\n` +
                `**Recommendation:** Run ingest-docs first\n\n` +
                `The ${ecosystem} documentation has not been ingested yet.\n` +
                `Use \`ingest-docs({ ecosystem: '${ecosystem}' })\` to index the documentation.`,
            },
          ],
        };
      }

      // Check version against remote
      const versionInfo = await needsUpdate(ecosystem);

      // Check staleness by age
      const isStale = isVersionStale(ecosystem, maxAgeHours);
      const ageMs = Date.now() - storedMetadata.ingestedAt;
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      const ageDays = Math.floor(ageHours / 24);

      // Format age string
      let ageStr: string;
      if (ageDays > 0) {
        ageStr = `${ageDays} day${ageDays > 1 ? "s" : ""} ${ageHours % 24} hour${(ageHours % 24) !== 1 ? "s" : ""}`;
      } else {
        ageStr = `${ageHours} hour${ageHours !== 1 ? "s" : ""}`;
      }

      // Determine status and recommendation
      let status: string;
      let recommendation: string;

      if (versionInfo.needsUpdate) {
        status = "Outdated - Remote content has changed";
        recommendation = `Run \`ingest-docs({ ecosystem: '${ecosystem}', force: true })\` to update`;
      } else if (isStale) {
        status = `Stale - Last indexed ${ageStr} ago (exceeds ${maxAgeHours}h threshold)`;
        recommendation = `Consider running \`ingest-docs({ ecosystem: '${ecosystem}', force: true })\` to refresh`;
      } else {
        status = "Up-to-date";
        recommendation = "No action needed";
      }

      return {
        content: [
          {
            type: "text",
            text: `# Version Check: ${ecosystem.toUpperCase()}\n\n` +
              `**Status:** ${status}\n` +
              `**Needs Update:** ${versionInfo.needsUpdate || isStale ? "Yes" : "No"}\n\n` +
              `## Stored Version\n` +
              `- **Version Hash:** ${storedMetadata.version}\n` +
              `- **Chunks:** ${storedMetadata.chunkCount}\n` +
              `- **Model:** ${storedMetadata.embeddingModel}\n` +
              `- **Indexed:** ${ageStr} ago\n` +
              `- **Source:** ${storedMetadata.source}\n\n` +
              `## Remote Version\n` +
              `- **Version Hash:** ${versionInfo.remoteVersion}\n` +
              `- **Changed:** ${versionInfo.needsUpdate ? "Yes - content differs" : "No - content matches"}\n\n` +
              `## Recommendation\n` +
              `${recommendation}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `# Version Check Failed\n\n` +
              `**Ecosystem:** ${ecosystem}\n` +
              `**Error:** ${error instanceof Error ? error.message : String(error)}\n\n` +
              `Could not complete version check. This may be due to:\n` +
              `- Network connectivity issues\n` +
              `- Remote documentation unavailable\n` +
              `- Invalid ecosystem specified`,
          },
        ],
      };
    }
  },
);

// ============================================================================
// Tool 8: Auto-Ingest Documentation (Automatic Re-Ingestion)
// ============================================================================

server.registerTool(
  "auto-ingest",
  {
    description:
      "Automatically check and re-ingest documentation if the version has changed. This combines version checking with automatic re-ingestion - use this before search-docs to ensure documentation is up-to-date. More efficient than manually checking version and then running ingest-docs.",
    inputSchema: z.object({
      ecosystem: z
        .enum(["solana", "sui"])
        .describe("Which ecosystem's documentation to auto-update"),
      force: z
        .boolean()
        .optional()
        .describe("Force re-ingestion regardless of version (default: false)"),
      maxAgeHours: z
        .number()
        .min(1)
        .max(168)
        .optional()
        .describe("Consider docs stale if older than this (default: 24 hours)"),
      checkRemote: z
        .boolean()
        .optional()
        .describe("Check for remote version changes (default: true, set to false for offline mode)"),
    }),
  },
  async (args) => {
    const { ecosystem, force = false, maxAgeHours = 24, checkRemote = true } = args;

    const result = await autoIngestIfNeeded(ecosystem, {
      force,
      maxAgeHours,
      checkRemote,
    });

    // Format result based on what action was taken
    if (result.ingested) {
      const reasonText = {
        version_changed: "Remote documentation content changed",
        not_indexed: "Documentation was not previously indexed",
        stale: `Documentation was stale (older than ${maxAgeHours} hours)`,
        forced: "Forced re-ingestion requested",
        up_to_date: "Documentation is up-to-date",
        error: "Error during ingestion",
      };

      return {
        content: [
          {
            type: "text",
            text: `# Auto-Ingest Complete\n\n` +
              `**Ecosystem:** ${ecosystem}\n` +
              `**Action:** Re-ingested\n` +
              `**Reason:** ${reasonText[result.reason]}\n\n` +
              `## Results\n` +
              `- **Chunks Created:** ${result.chunkCount}\n` +
              `- **Duration:** ${result.durationSeconds?.toFixed(1)}s\n` +
              `- **Version Hash:** ${result.version}\n\n` +
              `Documentation is now ready for vector search.`,
          },
        ],
      };
    } else if (result.reason === "up_to_date") {
      return {
        content: [
          {
            type: "text",
            text: `# Auto-Ingest: No Update Needed\n\n` +
              `**Ecosystem:** ${ecosystem}\n` +
              `**Status:** Up-to-date\n\n` +
              `## Current Index\n` +
              `- **Chunks:** ${result.chunkCount}\n` +
              `- **Version Hash:** ${result.version}\n\n` +
              `Documentation is current and ready for vector search.`,
          },
        ],
      };
    } else {
      // Error case
      return {
        content: [
          {
            type: "text",
            text: `# Auto-Ingest Failed\n\n` +
              `**Ecosystem:** ${ecosystem}\n` +
              `**Error:** ${result.error}\n\n` +
              `Please check the error and try again. You may need to:\n` +
              `- Verify network connectivity\n` +
              `- Check if the documentation source is available\n` +
              `- Ensure all dependencies are installed`,
          },
        ],
      };
    }
  },
);

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Blockchain Translation Guide MCP Server v2.0 running");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
