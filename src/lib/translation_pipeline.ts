/**
 * Translation Pipeline - Document Phase
 * Implements context gathering via MCP before translation
 * Uses vector-based RAG for efficient context retrieval
 */

import { IpcClient } from "@/ipc/ipc_client";
import {
  VectorStore,
  VectorEcosystem,
  type ContextResult,
} from "@/lib/vector_store";

/**
 * Performance metrics for document phase operations
 */
export interface DocumentPhasePerformance {
  totalTimeMs: number;
  retrievalTimeMs: number;
  contextSizeKB: number;
  chunkCount: number;
  method: "vector_search" | "full_fetch";
}

/**
 * Log performance metrics for the document phase
 * Used for monitoring and optimizing RAG retrieval
 */
function logPerformanceMetrics(
  metrics: DocumentPhasePerformance,
  onProgress?: (message: string) => void,
): void {
  const performanceLog = `[Performance] Document phase completed: retrieval ${metrics.retrievalTimeMs}ms, context ${metrics.contextSizeKB.toFixed(1)}KB (${metrics.chunkCount} chunks), method: ${metrics.method}, total: ${metrics.totalTimeMs}ms`;
  onProgress?.(performanceLog);

  // Target metrics from spec: retrieval <100ms, context <50KB
  if (metrics.retrievalTimeMs > 100) {
    onProgress?.(
      `[Performance Warning] Retrieval time ${metrics.retrievalTimeMs}ms exceeds 100ms target`,
    );
  }
  if (metrics.contextSizeKB > 50) {
    onProgress?.(
      `[Performance Warning] Context size ${metrics.contextSizeKB.toFixed(1)}KB exceeds 50KB target`,
    );
  }
}

export interface DocumentPhaseResult {
  ecosystem: {
    docs: string;
    size: number;
  };
  version: {
    current: string;
    releaseNotes: string;
    breakingChanges?: string;
    newFeatures?: string;
    docLinks: string[];
  };
  translation: {
    guide: string;
    patterns: Record<string, string>;
  };
}

/**
 * Extract version number from release notes text
 */
function extractVersion(text: string): string {
  const versionMatch = text.match(/v?(\d+\.\d+\.\d+)/);
  return versionMatch ? versionMatch[1] : "unknown";
}

/**
 * Extract URLs from text
 */
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s)]+/g;
  return text.match(urlRegex) || [];
}

/**
 * Map target language to ecosystem name for MCP calls
 */
function getEcosystemName(targetLanguage: string): "solana" | "sui" | "anchor" {
  if (targetLanguage === "solana_rust") return "anchor"; // Anchor for Solana programs
  if (targetLanguage === "sui_move") return "sui";
  return "solana"; // fallback
}

/**
 * PHASE 1: DOCUMENT - Gather all context via MCP
 *
 * This phase fetches:
 * - Relevant documentation via vector search (optimized RAG) OR full docs as fallback
 * - Latest version + release notes
 * - Translation patterns
 * - Feature compatibility matrix
 */
export async function documentPhase(
  targetLanguage: string,
  onProgress?: (message: string) => void,
  sourceCode?: string,
): Promise<DocumentPhaseResult> {
  const phaseStartTime = performance.now();
  const ipc = IpcClient.getInstance();
  const vectorStore = VectorStore.getInstance();
  const ecosystem = getEcosystemName(targetLanguage);

  // For documentation, use 'solana' instead of 'anchor' to get the full llms.txt
  const docsEcosystem = ecosystem === "anchor" ? "solana" : ecosystem;
  // Map ecosystem to VectorEcosystem type
  const vectorEcosystem: VectorEcosystem =
    docsEcosystem === "solana" ? "solana" : "sui";

  onProgress?.("Fetching ecosystem documentation...");

  // Performance tracking
  let retrievalStartTime = 0;
  let retrievalEndTime = 0;
  let chunkCount = 0;

  try {
    // Try vector-based retrieval first for optimized context
    let docsText = "";
    let usedVectorSearch = false;
    let vectorSearchError: string | null = null;

    // Attempt vector-based retrieval with graceful fallback on any error
    if (sourceCode) {
      try {
        // Check if vector store is ready for this ecosystem
        const vectorReady = await vectorStore.isReady(vectorEcosystem);

        if (vectorReady) {
          onProgress?.("Using vector search for relevant context...");
          retrievalStartTime = performance.now();

          // Build search queries based on source code and translation needs
          const searchQueries = buildSearchQueries(sourceCode, docsEcosystem);

          // Query vector store for relevant documentation chunks
          const vectorResult = await vectorStore.queryMultiple(
            vectorEcosystem,
            searchQueries,
            { limit: 15, minSimilarity: 0.4 },
          );

          retrievalEndTime = performance.now();

          if (vectorResult.context && vectorResult.chunkCount > 0) {
            docsText = vectorResult.context;
            usedVectorSearch = true;
            chunkCount = vectorResult.chunkCount;
            onProgress?.(
              `Vector search retrieved ${vectorResult.chunkCount} relevant chunks (${(vectorResult.size / 1024).toFixed(1)}KB) in ${vectorResult.retrievalTimeMs}ms`,
            );
          }
        }
      } catch (vectorError) {
        // Graceful fallback: log the error but continue with full docs fetch
        vectorSearchError =
          vectorError instanceof Error ? vectorError.message : String(vectorError);
        onProgress?.(
          `Vector search failed (${vectorSearchError}), falling back to full documentation...`,
        );
      }
    }

    // Fallback to full documentation fetch if:
    // - Vector search not available (no sourceCode)
    // - Vector store not ready
    // - Vector search returned empty results
    // - Vector search threw an error
    if (!docsText) {
      if (!vectorSearchError) {
        onProgress?.(
          sourceCode
            ? "Vector search returned no results, falling back to full docs..."
            : "No source code provided, fetching full documentation...",
        );
      }

      retrievalStartTime = performance.now();
      const docsResult = await ipc.callMcpTool(
        "blockchain-guide",
        "fetch-ecosystem-docs",
        {
          ecosystem: docsEcosystem,
        },
      );
      docsText = docsResult.content[0].text;
      retrievalEndTime = performance.now();
      chunkCount = 1; // Full doc is 1 "chunk"
    }

    // Parallel fetch for releases and translation guide (always needed)
    const [releasesResult, guideResult] = await Promise.all([
      // Get latest releases with notes - use 'anchor' for Anchor-specific version
      ipc.callMcpTool("blockchain-guide", "fetch-latest-releases", {
        ecosystem,
      }),

      // Get translation guide - use 'solana' for translation
      ipc.callMcpTool("blockchain-guide", "get-translation-guide", {
        from: "solidity",
        to: docsEcosystem,
      }),
    ]);

    onProgress?.("Fetching feature compatibility patterns...");

    // Fetch common feature patterns - use docsEcosystem for consistency
    const patterns = await fetchFeaturePatterns(docsEcosystem, ipc);

    // Parse the results
    const releasesText = releasesResult.content[0].text;
    const guideText = guideResult.content[0].text;

    const result: DocumentPhaseResult = {
      ecosystem: {
        docs: docsText,
        size: docsText.length,
      },
      version: {
        current: extractVersion(releasesText),
        releaseNotes: releasesText,
        docLinks: extractUrls(releasesText),
      },
      translation: {
        guide: guideText,
        patterns,
      },
    };

    // Calculate and log performance metrics
    const phaseEndTime = performance.now();
    const retrievalTimeMs = Math.round(retrievalEndTime - retrievalStartTime);
    const totalTimeMs = Math.round(phaseEndTime - phaseStartTime);
    const contextSizeKB = result.ecosystem.size / 1024;

    const performanceMetrics: DocumentPhasePerformance = {
      totalTimeMs,
      retrievalTimeMs,
      contextSizeKB,
      chunkCount,
      method: usedVectorSearch ? "vector_search" : "full_fetch",
    };

    logPerformanceMetrics(performanceMetrics, onProgress);

    const retrievalMethod = usedVectorSearch ? "vector search" : "full fetch";
    onProgress?.(
      `Context gathered via ${retrievalMethod}: ${(result.ecosystem.size / 1024).toFixed(0)}KB docs, version ${result.version.current}`,
    );

    return result;
  } catch (error) {
    console.error("Document phase failed:", error);
    throw new Error(`Failed to gather translation context: ${error}`);
  }
}

/**
 * Build search queries based on source code analysis
 * Extracts relevant topics from Solidity code to find matching documentation
 */
function buildSearchQueries(
  sourceCode: string,
  targetEcosystem: string,
): string[] {
  const queries: string[] = [];

  // Base query for the target ecosystem
  queries.push(`${targetEcosystem} smart contract development guide`);

  // Detect Solidity patterns and create relevant queries
  const patterns: Array<{ pattern: RegExp; query: string }> = [
    { pattern: /mapping\s*\(/i, query: `${targetEcosystem} storage mapping state` },
    { pattern: /modifier\s+\w+/i, query: `${targetEcosystem} access control modifier` },
    { pattern: /event\s+\w+/i, query: `${targetEcosystem} events emit logging` },
    { pattern: /payable/i, query: `${targetEcosystem} transfer tokens SOL` },
    {
      pattern: /msg\.sender/i,
      query: `${targetEcosystem} caller signer account`,
    },
    {
      pattern: /require\s*\(/i,
      query: `${targetEcosystem} error handling require assert`,
    },
    { pattern: /struct\s+\w+/i, query: `${targetEcosystem} account data struct` },
    { pattern: /import\s+/i, query: `${targetEcosystem} program imports modules` },
    {
      pattern: /constructor\s*\(/i,
      query: `${targetEcosystem} initialization initialize`,
    },
    {
      pattern: /ERC20|ERC721|token/i,
      query: `${targetEcosystem} token SPL fungible NFT`,
    },
    {
      pattern: /onlyOwner|Ownable/i,
      query: `${targetEcosystem} owner authority admin`,
    },
  ];

  for (const { pattern, query } of patterns) {
    if (pattern.test(sourceCode)) {
      queries.push(query);
    }
  }

  // Limit to reasonable number of queries
  return queries.slice(0, 5);
}

/**
 * Fetch compatibility patterns for common Solidity features
 */
async function fetchFeaturePatterns(
  target: "solana" | "sui" | "anchor",
  ipc: IpcClient,
): Promise<Record<string, string>> {
  const features = [
    "mapping",
    "modifier",
    "event",
    "inheritance",
    "payable",
    "constructor",
  ];
  const targetEcosystem = target === "anchor" ? "solana" : target;

  const patterns: Record<string, string> = {};

  // Fetch all patterns in parallel
  const results = await Promise.all(
    features.map((feature) =>
      ipc.callMcpTool("blockchain-guide", "check-feature-compatibility", {
        feature,
        target: targetEcosystem,
      }),
    ),
  );

  // Map results to patterns object
  features.forEach((feature, index) => {
    patterns[feature] = results[index].content[0].text;
  });

  return patterns;
}

/**
 * Build enriched translation prompt with MCP context
 */
export function buildEnrichedPrompt(
  basePrompt: string,
  context: DocumentPhaseResult,
  options: {
    includeFullDocs?: boolean; // Whether to include all 645KB (may exceed token limits)
    docsPreviewSize?: number; // Size of docs preview if not including full
  } = {},
): string {
  const {
    includeFullDocs = false,
    docsPreviewSize = 50000, // 50KB preview by default
  } = options;

  // Documentation - either full or preview
  const docs = includeFullDocs
    ? context.ecosystem.docs
    : context.ecosystem.docs.substring(0, docsPreviewSize) +
      `\n\n[...Documentation truncated. Full ${(context.ecosystem.size / 1024).toFixed(0)}KB available if needed...]`;

  // Build the enriched prompt
  const enrichedPrompt = `${basePrompt}

# 📚 CURRENT ECOSYSTEM CONTEXT

You have access to up-to-date blockchain documentation and patterns. USE THIS INFORMATION to ensure your translation uses current syntax and APIs.

## 🔖 Current Version: ${context.version.current}

${context.version.releaseNotes}

${
  context.version.docLinks.length > 0
    ? `
## 📖 Official Documentation Links
${context.version.docLinks.map((url) => `- ${url}`).join("\n")}
`
    : ""
}

## 📘 Ecosystem Documentation (${(context.ecosystem.size / 1024).toFixed(0)}KB)

${docs}

## 🔄 Translation Guide

${context.translation.guide}

## 🗺️ Feature Mapping Reference

${Object.entries(context.translation.patterns)
  .map(([feature, pattern]) => `### ${feature}\n${pattern}`)
  .join("\n\n")}

---

**IMPORTANT INSTRUCTIONS:**
1. Use version ${context.version.current} (from the release notes above)
2. Follow patterns from the documentation above
3. Apply the translation guide for feature mapping
4. Generate modern, idiomatic code using current best practices
5. Reference the documentation if you're unsure about syntax

`;

  return enrichedPrompt;
}

/**
 * Get a summary of the document phase results for logging/UI
 */
export function getContextSummary(context: DocumentPhaseResult): string {
  return `
Document Phase Complete:
- Ecosystem docs: ${(context.ecosystem.size / 1024).toFixed(0)}KB
- Current version: ${context.version.current}
- Translation patterns: ${Object.keys(context.translation.patterns).join(", ")}
- Documentation links: ${context.version.docLinks.length} found
`.trim();
}

/**
 * Generate AI_RULES.md content with enriched blockchain context
 * This file guides the AI during translation with current, context-aware information
 */
export function generateAIRulesContent(
  context: DocumentPhaseResult,
  targetLanguage: string,
  sourceLanguage = "solidity",
): string {
  const ecosystem = getEcosystemName(targetLanguage);
  const ecosystemName =
    ecosystem === "anchor"
      ? "Solana (Anchor)"
      : ecosystem === "sui"
        ? "Sui Move"
        : ecosystem;

  return `# AI Translation Rules and Context

## Overview
This document contains the enriched context and guidelines for translating from ${sourceLanguage.toUpperCase()} to ${ecosystemName}.
Generated on: ${new Date().toISOString().split("T")[0]}

---

## 🎯 Target Ecosystem: ${ecosystemName}

### Current Version
**${context.version.current}**

### Latest Release Notes
${context.version.releaseNotes}

${
  context.version.docLinks.length > 0
    ? `### Official Documentation
${context.version.docLinks.map((url) => `- ${url}`).join("\n")}
`
    : ""
}

---

## 📚 Ecosystem Documentation Summary

**Total Documentation Size:** ${(context.ecosystem.size / 1024).toFixed(0)}KB

### Key Documentation Highlights
${context.ecosystem.docs.substring(0, 2000)}

[... Full ${(context.ecosystem.size / 1024).toFixed(0)}KB documentation available in context ...]

---

## 🔄 Translation Guide

${context.translation.guide}

---

## 🗺️ Feature Compatibility Matrix

${Object.entries(context.translation.patterns)
  .map(
    ([
      feature,
      pattern,
    ]) => `### ${feature.charAt(0).toUpperCase() + feature.slice(1)}
${pattern}
`,
  )
  .join("\n")}

---

## ✅ Translation Checklist

When translating, ensure you:

1. **Use Current Syntax**
   - Follow version ${context.version.current} conventions
   - Reference the latest release notes for breaking changes
   - Use modern, idiomatic patterns

2. **Apply Feature Mappings**
   - Map each Solidity feature using the compatibility matrix above
   - Document any features that don't have direct equivalents
   - Provide workarounds for unsupported patterns

3. **Follow Best Practices**
   - Use ecosystem-specific naming conventions
   - Implement proper error handling
   - Add security best practices
   - Include comprehensive inline comments

4. **Test Compatibility**
   - Ensure code compiles with current toolchain
   - Verify all dependencies are available
   - Check for deprecated APIs or patterns

5. **Preserve Functionality**
   - Maintain the original contract's behavior
   - Document any behavioral differences
   - Ensure equivalent security guarantees

---

## 📝 Notes

- This context was generated dynamically from official sources
- Documentation is current as of ${new Date().toISOString().split("T")[0]}
- Review and update this file if translating to a different version
- Consult official docs for detailed API references

---

## 🔗 Resources

${context.version.docLinks.map((url) => `- ${url}`).join("\n")}

---

*Generated by Dyad Translation Pipeline v1.0*
*Context enriched with ${(context.ecosystem.size / 1024).toFixed(0)}KB of live documentation*
`;
}
