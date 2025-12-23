/**
 * Translation Pipeline - Document Phase
 * Implements context gathering via MCP before translation
 */

import { IpcClient } from "@/ipc/ipc_client";

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
  return versionMatch ? versionMatch[1] : 'unknown';
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
function getEcosystemName(targetLanguage: string): 'solana' | 'sui' | 'anchor' {
  if (targetLanguage === 'solana_rust') return 'anchor'; // Anchor for Solana programs
  if (targetLanguage === 'sui_move') return 'sui';
  return 'solana'; // fallback
}

/**
 * PHASE 1: DOCUMENT - Gather all context via MCP
 *
 * This phase fetches:
 * - Full ecosystem documentation (645KB for Solana)
 * - Latest version + release notes
 * - Translation patterns
 * - Feature compatibility matrix
 */
export async function documentPhase(
  targetLanguage: string,
  onProgress?: (message: string) => void
): Promise<DocumentPhaseResult> {
  const ipc = IpcClient.getInstance();
  const ecosystem = getEcosystemName(targetLanguage);

  onProgress?.('Fetching ecosystem documentation...');

  try {
    // Parallel fetch for speed
    const [docsResult, releasesResult, guideResult] = await Promise.all([
      // 1. Get ecosystem documentation (full llms.txt)
      ipc.callMcpTool(
        'blockchain-guide',
        'fetch-ecosystem-docs',
        { ecosystem }
      ),

      // 2. Get latest releases with notes
      ipc.callMcpTool(
        'blockchain-guide',
        'fetch-latest-releases',
        { ecosystem }
      ),

      // 3. Get translation guide
      ipc.callMcpTool(
        'blockchain-guide',
        'get-translation-guide',
        { from: 'solidity', to: ecosystem === 'anchor' ? 'solana' : ecosystem }
      ),
    ]);

    onProgress?.('Fetching feature compatibility patterns...');

    // 4. Fetch common feature patterns
    const patterns = await fetchFeaturePatterns(ecosystem, ipc);

    // Parse the results
    const docsText = docsResult.content[0].text;
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

    onProgress?.(`Context gathered: ${(result.ecosystem.size / 1024).toFixed(0)}KB docs, version ${result.version.current}`);

    return result;

  } catch (error) {
    console.error('Document phase failed:', error);
    throw new Error(`Failed to gather translation context: ${error}`);
  }
}

/**
 * Fetch compatibility patterns for common Solidity features
 */
async function fetchFeaturePatterns(
  target: 'solana' | 'sui' | 'anchor',
  ipc: IpcClient
): Promise<Record<string, string>> {
  const features = ['mapping', 'modifier', 'event', 'inheritance', 'payable', 'constructor'];
  const targetEcosystem = target === 'anchor' ? 'solana' : target;

  const patterns: Record<string, string> = {};

  // Fetch all patterns in parallel
  const results = await Promise.all(
    features.map(feature =>
      ipc.callMcpTool('blockchain-guide', 'check-feature-compatibility', {
        feature,
        target: targetEcosystem,
      })
    )
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
    docsPreviewSize?: number;  // Size of docs preview if not including full
  } = {}
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

${context.version.docLinks.length > 0 ? `
## 📖 Official Documentation Links
${context.version.docLinks.map(url => `- ${url}`).join('\n')}
` : ''}

## 📘 Ecosystem Documentation (${(context.ecosystem.size / 1024).toFixed(0)}KB)

${docs}

## 🔄 Translation Guide

${context.translation.guide}

## 🗺️ Feature Mapping Reference

${Object.entries(context.translation.patterns)
  .map(([feature, pattern]) => `### ${feature}\n${pattern}`)
  .join('\n\n')}

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
- Translation patterns: ${Object.keys(context.translation.patterns).join(', ')}
- Documentation links: ${context.version.docLinks.length} found
`.trim();
}
