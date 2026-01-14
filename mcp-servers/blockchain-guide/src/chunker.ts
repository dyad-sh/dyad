/**
 * Semantic Document Chunking Utility
 *
 * Provides intelligent text chunking that:
 * - Creates chunks of 400-500 characters (~100-128 tokens)
 * - Maintains 20-30 token overlap (~80-120 characters) for context continuity
 * - Preserves semantic boundaries (code blocks, paragraphs, headers)
 * - Handles markdown structure appropriately
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a chunk of text with metadata
 */
export interface Chunk {
  /** The text content of the chunk */
  text: string;
  /** Zero-based index of this chunk in the document */
  index: number;
  /** Starting character position in the original document */
  startOffset: number;
  /** Ending character position in the original document */
  endOffset: number;
  /** Indices of chunks this overlaps with (previous chunks) */
  overlapsWith: number[];
  /** Section header this chunk belongs to (if identifiable) */
  section?: string;
}

/**
 * Configuration options for the chunker
 */
export interface ChunkerConfig {
  /** Target chunk size in characters (default: 450, range: 400-500) */
  targetChunkSize?: number;
  /** Minimum chunk size in characters (default: 400) */
  minChunkSize?: number;
  /** Maximum chunk size in characters (default: 500) */
  maxChunkSize?: number;
  /** Overlap size in characters (default: 100, ~25 tokens) */
  overlapSize?: number;
  /** Whether to preserve code blocks as single chunks (default: true) */
  preserveCodeBlocks?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Default target chunk size in characters */
const DEFAULT_TARGET_CHUNK_SIZE = 450;

/** Default minimum chunk size in characters */
const DEFAULT_MIN_CHUNK_SIZE = 400;

/** Default maximum chunk size in characters */
const DEFAULT_MAX_CHUNK_SIZE = 500;

/** Default overlap size in characters (~25 tokens) */
const DEFAULT_OVERLAP_SIZE = 100;

/** Regex pattern for markdown code blocks */
const CODE_BLOCK_REGEX = /```[\s\S]*?```/g;

/** Regex pattern for markdown headers */
const HEADER_REGEX = /^#{1,6}\s+.+$/gm;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the best break point near a target position
 * Prefers breaking at: paragraph ends, sentence ends, clause ends, word ends
 *
 * @param text - The text to search
 * @param targetPos - Target position to break near
 * @param searchRange - How far to search from target position
 * @returns Best break position
 */
function findBestBreakPoint(
  text: string,
  targetPos: number,
  searchRange: number = 50,
): number {
  const start = Math.max(0, targetPos - searchRange);
  const end = Math.min(text.length, targetPos + searchRange);
  const searchText = text.slice(start, end);

  // Priority 1: Paragraph break (double newline)
  const paragraphBreak = searchText.lastIndexOf("\n\n");
  if (paragraphBreak !== -1) {
    return start + paragraphBreak + 2;
  }

  // Priority 2: Single newline
  const lineBreak = searchText.lastIndexOf("\n");
  if (lineBreak !== -1) {
    return start + lineBreak + 1;
  }

  // Priority 3: Sentence end (. ! ?)
  const sentenceEndMatch = searchText.match(/[.!?]\s+(?=[A-Z])/g);
  if (sentenceEndMatch) {
    const lastSentenceEnd = searchText.lastIndexOf(
      sentenceEndMatch[sentenceEndMatch.length - 1],
    );
    if (lastSentenceEnd !== -1) {
      return start + lastSentenceEnd + sentenceEndMatch[0].length;
    }
  }

  // Priority 4: Clause break (comma, semicolon, colon)
  const clauseBreakMatch = searchText.match(/[,;:]\s+/g);
  if (clauseBreakMatch) {
    const lastClauseBreak = searchText.lastIndexOf(
      clauseBreakMatch[clauseBreakMatch.length - 1],
    );
    if (lastClauseBreak !== -1) {
      return start + lastClauseBreak + clauseBreakMatch[0].length;
    }
  }

  // Priority 5: Word boundary (space)
  const lastSpace = searchText.lastIndexOf(" ");
  if (lastSpace !== -1) {
    return start + lastSpace + 1;
  }

  // Fallback: use target position
  return targetPos;
}

/**
 * Extract code blocks from text and replace with placeholders
 *
 * @param text - The text containing code blocks
 * @returns Object with processed text and extracted code blocks
 */
function extractCodeBlocks(text: string): {
  processedText: string;
  codeBlocks: Map<string, string>;
} {
  const codeBlocks = new Map<string, string>();
  let processedText = text;
  let index = 0;

  processedText = processedText.replace(CODE_BLOCK_REGEX, (match) => {
    const placeholder = `__CODE_BLOCK_${index}__`;
    codeBlocks.set(placeholder, match);
    index++;
    return placeholder;
  });

  return { processedText, codeBlocks };
}

/**
 * Restore code blocks from placeholders
 *
 * @param text - Text with placeholders
 * @param codeBlocks - Map of placeholders to code blocks
 * @returns Text with restored code blocks
 */
function restoreCodeBlocks(
  text: string,
  codeBlocks: Map<string, string>,
): string {
  let result = text;
  codeBlocks.forEach((codeBlock, placeholder) => {
    result = result.replace(placeholder, codeBlock);
  });
  return result;
}

/**
 * Find the current section header for a given position
 *
 * @param text - The full document text
 * @param position - Character position to find section for
 * @returns Section header text or undefined
 */
function findCurrentSection(text: string, position: number): string | undefined {
  const textBefore = text.slice(0, position);
  const headerMatches = textBefore.match(HEADER_REGEX);
  if (headerMatches && headerMatches.length > 0) {
    return headerMatches[headerMatches.length - 1].replace(/^#+\s*/, "").trim();
  }
  return undefined;
}

// ============================================================================
// Main Chunking Functions
// ============================================================================

/**
 * Split text into semantic chunks with overlap
 *
 * This function creates chunks that:
 * 1. Are approximately 400-500 characters each
 * 2. Have ~100 character overlap with previous chunk
 * 3. Break at semantic boundaries when possible
 * 4. Preserve code blocks intact (if configured)
 *
 * @param text - The text to chunk
 * @param config - Optional configuration
 * @returns Array of chunks with metadata
 */
export function chunkText(text: string, config?: ChunkerConfig): Chunk[] {
  const targetSize = config?.targetChunkSize ?? DEFAULT_TARGET_CHUNK_SIZE;
  const minSize = config?.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;
  const maxSize = config?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  const overlapSize = config?.overlapSize ?? DEFAULT_OVERLAP_SIZE;
  const preserveCodeBlocks = config?.preserveCodeBlocks ?? true;

  // Handle empty or very short text
  if (!text || text.trim().length === 0) {
    return [];
  }

  if (text.length <= maxSize) {
    return [
      {
        text: text.trim(),
        index: 0,
        startOffset: 0,
        endOffset: text.length,
        overlapsWith: [],
        section: findCurrentSection(text, 0),
      },
    ];
  }

  // Extract code blocks if needed
  let processedText = text;
  let codeBlocks: Map<string, string> = new Map();

  if (preserveCodeBlocks) {
    const extracted = extractCodeBlocks(text);
    processedText = extracted.processedText;
    codeBlocks = extracted.codeBlocks;
  }

  const chunks: Chunk[] = [];
  let currentPos = 0;
  let chunkIndex = 0;

  while (currentPos < processedText.length) {
    // Calculate where this chunk should end
    let chunkEnd = currentPos + targetSize;

    // If we're near the end, just include everything
    if (chunkEnd >= processedText.length - minSize) {
      chunkEnd = processedText.length;
    } else {
      // Find a good break point
      chunkEnd = findBestBreakPoint(processedText, chunkEnd, maxSize - targetSize);
    }

    // Ensure we don't exceed max size
    if (chunkEnd - currentPos > maxSize) {
      chunkEnd = currentPos + maxSize;
      chunkEnd = findBestBreakPoint(processedText, chunkEnd, 20);
    }

    // Ensure minimum progress
    if (chunkEnd <= currentPos) {
      chunkEnd = Math.min(currentPos + minSize, processedText.length);
    }

    // Extract the chunk text
    let chunkText = processedText.slice(currentPos, chunkEnd);

    // Restore code blocks in this chunk
    if (preserveCodeBlocks && codeBlocks.size > 0) {
      chunkText = restoreCodeBlocks(chunkText, codeBlocks);
    }

    // Trim whitespace but track original offsets
    const trimmedChunk = chunkText.trim();

    // Calculate which previous chunks this overlaps with
    const overlapsWith: number[] = [];
    if (chunkIndex > 0) {
      overlapsWith.push(chunkIndex - 1);
    }

    chunks.push({
      text: trimmedChunk,
      index: chunkIndex,
      startOffset: currentPos,
      endOffset: chunkEnd,
      overlapsWith,
      section: findCurrentSection(text, currentPos),
    });

    // Move position forward, accounting for overlap
    // For the next chunk, start from (chunkEnd - overlapSize)
    const nextPos = chunkEnd - overlapSize;

    // Ensure forward progress
    if (nextPos <= currentPos) {
      currentPos = chunkEnd;
    } else {
      currentPos = nextPos;
    }

    chunkIndex++;

    // Safety check to prevent infinite loops
    if (chunkIndex > text.length / (minSize - overlapSize) + 10) {
      break;
    }
  }

  return chunks;
}

/**
 * Chunk a markdown document while preserving structure
 *
 * This is a higher-level function that:
 * 1. Identifies sections by headers
 * 2. Chunks each section independently
 * 3. Maintains section metadata
 *
 * @param markdown - The markdown text to chunk
 * @param config - Optional configuration
 * @returns Array of chunks with section metadata
 */
export function chunkMarkdown(markdown: string, config?: ChunkerConfig): Chunk[] {
  // Split by top-level headers first
  const sections = markdown.split(/(?=^#{1,2}\s)/m);
  const allChunks: Chunk[] = [];
  let globalOffset = 0;
  let globalIndex = 0;

  for (const section of sections) {
    if (!section.trim()) {
      globalOffset += section.length;
      continue;
    }

    const sectionChunks = chunkText(section, config);

    for (const chunk of sectionChunks) {
      // Adjust offsets to be global
      allChunks.push({
        ...chunk,
        index: globalIndex,
        startOffset: globalOffset + chunk.startOffset,
        endOffset: globalOffset + chunk.endOffset,
        overlapsWith: chunk.overlapsWith.map((i) => globalIndex - (chunk.index - i)),
      });
      globalIndex++;
    }

    globalOffset += section.length;
  }

  return allChunks;
}

/**
 * Estimate the number of tokens in a text
 * Uses a simple heuristic: ~4 characters per token for English text
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  // Simple heuristic: average 4 characters per token
  // This is a rough estimate for English text
  return Math.ceil(text.length / 4);
}

/**
 * Validate chunk configuration
 *
 * @param config - Configuration to validate
 * @returns Validation result with any warnings
 */
export function validateConfig(config: ChunkerConfig): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  const targetSize = config.targetChunkSize ?? DEFAULT_TARGET_CHUNK_SIZE;
  const minSize = config.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;
  const maxSize = config.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  const overlapSize = config.overlapSize ?? DEFAULT_OVERLAP_SIZE;

  if (minSize > targetSize) {
    warnings.push(`minChunkSize (${minSize}) is greater than targetChunkSize (${targetSize})`);
  }

  if (targetSize > maxSize) {
    warnings.push(`targetChunkSize (${targetSize}) is greater than maxChunkSize (${maxSize})`);
  }

  if (overlapSize >= minSize) {
    warnings.push(`overlapSize (${overlapSize}) should be less than minChunkSize (${minSize})`);
  }

  // Check if chunk sizes are within recommended bounds
  if (maxSize > 512 * 4) {
    // ~512 tokens
    warnings.push(`maxChunkSize (${maxSize}) may exceed embedding model token limits`);
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a pre-configured chunker function
 *
 * @param config - Configuration for the chunker
 * @returns Configured chunk function
 */
export function createChunker(
  config?: ChunkerConfig,
): (text: string) => Chunk[] {
  return (text: string) => chunkText(text, config);
}

/**
 * Default chunker instance with standard configuration
 * Creates 400-500 char chunks with ~100 char (25 token) overlap
 */
export const defaultChunker = createChunker();
