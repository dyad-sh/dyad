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
