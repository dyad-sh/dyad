/* eslint-disable no-irregular-whitespace */

import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";
import { normalizeString } from "@/utils/text_normalization";
import log from "electron-log";

const logger = log.scope("search_replace_processor");

// ============================================================================
// Options Interface
// ============================================================================

function unescapeMarkers(content: string): string {
  return content
    .replace(/^\\<<<<<<</gm, "<<<<<<<")
    .replace(/^\\=======/gm, "=======")
    .replace(/^\\>>>>>>>/gm, ">>>>>>>");
}

// ============================================================================
// Cascading Fuzzy Matching
// ============================================================================
// The tool locates where to apply changes by matching context lines against the file.
// Implements cascading fuzzy matching with decreasing strictness:
//
// Pass 1: Exact Match
// Pass 2: Trailing Whitespace Ignored
// Pass 3: All Edge Whitespace Ignored
// Pass 4: Unicode Normalization
// ============================================================================

type LineComparator = (fileLine: string, patternLine: string) => boolean;

/**
 * Pass 1: Exact Match
 * file_line == pattern_line
 */
const exactMatch: LineComparator = (fileLine, patternLine) =>
  fileLine === patternLine;

/**
 * Pass 2: Trailing Whitespace Ignored
 * file_line.trimEnd() == pattern_line.trimEnd()
 */
const trailingWhitespaceIgnored: LineComparator = (fileLine, patternLine) =>
  fileLine.trimEnd() === patternLine.trimEnd();

/**
 * Pass 3: All Edge Whitespace Ignored
 * file_line.trim() == pattern_line.trim()
 */
const allEdgeWhitespaceIgnored: LineComparator = (fileLine, patternLine) =>
  fileLine.trim() === patternLine.trim();

/**
 * Pass 4: Unicode Normalization
 * Normalize common Unicode variants to ASCII before comparing:
 * - En-dash, em-dash, etc. → -
 * - Smart quotes → " '
 * - Non-breaking space → regular space
 */
const unicodeNormalized: LineComparator = (fileLine, patternLine) =>
  normalizeString(fileLine.trim()) === normalizeString(patternLine.trim());

/**
 * All matching passes in order of decreasing strictness
 */
const MATCHING_PASSES: Array<{ name: string; comparator: LineComparator }> = [
  { name: "exact", comparator: exactMatch },
  {
    name: "trailing-whitespace-ignored",
    comparator: trailingWhitespaceIgnored,
  },
  { name: "all-edge-whitespace-ignored", comparator: allEdgeWhitespaceIgnored },
  { name: "unicode-normalized", comparator: unicodeNormalized },
];

/**
 * Trim leading and trailing empty lines from an array of lines
 */
function trimEmptyLines(lines: string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && result[0] === "") {
    result.shift();
  }
  while (result.length > 0 && result[result.length - 1] === "") {
    result.pop();
  }
  return result;
}

/**
 * Find all positions where searchLines match against resultLines using the given comparator
 */
function findMatchPositions(
  resultLines: string[],
  searchLines: string[],
  comparator: LineComparator,
): number[] {
  const positions: number[] = [];

  for (let i = 0; i <= resultLines.length - searchLines.length; i++) {
    let allMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (!comparator(resultLines[i + j], searchLines[j])) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      positions.push(i);
      // For ambiguity detection, we only need to know if there's more than one
      if (positions.length > 1) break;
    }
  }

  return positions;
}

/**
 * Find the best partial match - the position in resultLines where the most
 * consecutive lines from searchLines match (using unicode-normalized comparison)
 */
function findBestPartialMatch(
  resultLines: string[],
  searchLines: string[],
): { startIndex: number; matchingLines: number; firstMismatchIndex: number } {
  let bestStartIndex = 0;
  let bestMatchingLines = 0;
  let bestFirstMismatchIndex = 0;

  for (let i = 0; i < resultLines.length; i++) {
    let matchingLines = 0;
    let firstMismatchIndex = -1;

    for (let j = 0; j < searchLines.length && i + j < resultLines.length; j++) {
      if (unicodeNormalized(resultLines[i + j], searchLines[j])) {
        matchingLines++;
      } else {
        if (firstMismatchIndex === -1) {
          firstMismatchIndex = j;
        }
        // Continue counting to find total matching lines, not just consecutive
      }
    }

    if (matchingLines > bestMatchingLines) {
      bestMatchingLines = matchingLines;
      bestStartIndex = i;
      bestFirstMismatchIndex =
        firstMismatchIndex === -1 ? searchLines.length : firstMismatchIndex;
    }
  }

  return {
    startIndex: bestStartIndex,
    matchingLines: bestMatchingLines,
    firstMismatchIndex: bestFirstMismatchIndex,
  };
}

/**
 * Log detailed information about a failed match to help diagnose issues
 */
function logMatchFailure(
  resultLines: string[],
  searchLines: string[],
  blockIndex: number,
): void {
  logger.error(
    `=== SEARCH/REPLACE MATCH FAILURE (Block ${blockIndex + 1}) ===`,
  );

  // Log search content
  logger.error(`\n--- SEARCH CONTENT (${searchLines.length} lines) ---`);
  searchLines.forEach((line, i) => {
    logger.error(`  ${String(i + 1).padStart(3)}: ${JSON.stringify(line)}`);
  });

  // Find best partial match
  const bestMatch = findBestPartialMatch(resultLines, searchLines);

  logger.error(
    `\n--- BEST PARTIAL MATCH: ${bestMatch.matchingLines}/${searchLines.length} lines match ---`,
  );
  logger.error(
    `    Location: lines ${bestMatch.startIndex + 1}-${bestMatch.startIndex + searchLines.length} of original file`,
  );
  logger.error(
    `    First mismatch at search line: ${bestMatch.firstMismatchIndex + 1}`,
  );

  // Show the relevant section of the original file with context
  const contextLines = 5;
  const startLine = Math.max(0, bestMatch.startIndex - contextLines);
  const endLine = Math.min(
    resultLines.length,
    bestMatch.startIndex + searchLines.length + contextLines,
  );

  logger.error(
    `\n--- ORIGINAL FILE (lines ${startLine + 1}-${endLine}, match region marked with >) ---`,
  );
  for (let i = startLine; i < endLine; i++) {
    const isInMatchRegion =
      i >= bestMatch.startIndex &&
      i < bestMatch.startIndex + searchLines.length;
    const searchLineIndex = i - bestMatch.startIndex;
    const matchesSearch =
      isInMatchRegion &&
      searchLineIndex < searchLines.length &&
      unicodeNormalized(resultLines[i], searchLines[searchLineIndex]);

    const marker = isInMatchRegion ? (matchesSearch ? ">" : "X") : " ";
    logger.error(
      `  ${marker} ${String(i + 1).padStart(4)}: ${JSON.stringify(resultLines[i])}`,
    );
  }

  // If there's a mismatch, show the specific comparison
  if (bestMatch.firstMismatchIndex < searchLines.length) {
    const mismatchFileIndex =
      bestMatch.startIndex + bestMatch.firstMismatchIndex;
    if (mismatchFileIndex < resultLines.length) {
      logger.error(`\n--- FIRST MISMATCH DETAILS ---`);
      logger.error(
        `  Search line ${bestMatch.firstMismatchIndex + 1}: ${JSON.stringify(searchLines[bestMatch.firstMismatchIndex])}`,
      );
      logger.error(
        `  File line ${mismatchFileIndex + 1}:   ${JSON.stringify(resultLines[mismatchFileIndex])}`,
      );
    }
  }

  logger.error(`\n=== END MATCH FAILURE ===\n`);
}

/**
 * Cascading fuzzy matching: try each pass in order until we find a match
 * Returns the match index or -1 if no match found, along with any error
 */
function cascadingMatch(
  resultLines: string[],
  searchLines: string[],
): { matchIndex: number; error?: string; passName?: string } {
  const passesToTry = MATCHING_PASSES;

  for (const pass of passesToTry) {
    const positions = findMatchPositions(
      resultLines,
      searchLines,
      pass.comparator,
    );

    if (positions.length > 1) {
      return {
        matchIndex: -1,
        error: `Search block matched multiple locations in the target file (ambiguous, detected in ${pass.name} pass)`,
      };
    }

    if (positions.length === 1) {
      return { matchIndex: positions[0], passName: pass.name };
    }
  }

  return {
    matchIndex: -1,
    error: "Search block did not match any content in the target file.",
  };
}

export function applySearchReplace(
  originalContent: string,
  diffContent: string,
): {
  success: boolean;
  content?: string;
  error?: string;
} {
  const blocks = parseSearchReplaceBlocks(diffContent);
  if (blocks.length === 0) {
    return {
      success: false,
      error:
        "Invalid diff format - missing required sections. Expected <<<<<<< SEARCH / ======= / >>>>>>> REPLACE",
    };
  }

  const lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n";
  let resultLines = originalContent.split(/\r?\n/);
  let appliedCount = 0;

  for (const block of blocks) {
    let { searchContent, replaceContent } = block;

    // Normalize markers and strip line numbers if present on all lines
    searchContent = unescapeMarkers(searchContent);
    replaceContent = unescapeMarkers(replaceContent);

    let searchLines = searchContent === "" ? [] : searchContent.split(/\r?\n/);
    let replaceLines =
      replaceContent === "" ? [] : replaceContent.split(/\r?\n/);

    if (searchLines.length === 0) {
      return {
        success: false,
        error: "Invalid diff format - empty SEARCH block is not allowed",
      };
    }

    // If search and replace are identical, it's either an error or a no-op warning
    if (searchLines.join("\n") === replaceLines.join("\n")) {
      logger.warn("Search and replace blocks are identical");
    }

    // Use cascading fuzzy matching to find the match
    let matchResult = cascadingMatch(resultLines, searchLines);

    // If no match found, try with trimmed leading/trailing empty lines as a fallback
    if (matchResult.error && !matchResult.error.includes("ambiguous")) {
      const trimmedSearchLines = trimEmptyLines(searchLines);
      if (trimmedSearchLines.length !== searchLines.length) {
        const trimmedResult = cascadingMatch(resultLines, trimmedSearchLines);
        if (!trimmedResult.error) {
          matchResult = trimmedResult;
          searchLines = trimmedSearchLines;
          logger.debug(
            "Matched after trimming leading/trailing empty lines from search content",
          );
        }
      }
    }

    if (matchResult.error) {
      // Log detailed diagnostic information for debugging
      logMatchFailure(resultLines, searchLines, appliedCount);
      return {
        success: false,
        error: matchResult.error,
      };
    }

    const matchIndex = matchResult.matchIndex;

    const matchedLines = resultLines.slice(
      matchIndex,
      matchIndex + searchLines.length,
    );

    // Preserve indentation relative to first matched line
    const originalIndents = matchedLines.map((line) => {
      const m = line.match(/^[\t ]*/);
      return m ? m[0] : "";
    });
    const searchIndents = searchLines.map((line) => {
      const m = line.match(/^[\t ]*/);
      return m ? m[0] : "";
    });

    const indentedReplaceLines = replaceLines.map((line) => {
      const matchedIndent = originalIndents[0] || "";
      const currentIndentMatch = line.match(/^[\t ]*/);
      const currentIndent = currentIndentMatch ? currentIndentMatch[0] : "";
      const searchBaseIndent = searchIndents[0] || "";

      const searchBaseLevel = searchBaseIndent.length;
      const currentLevel = currentIndent.length;
      const relativeLevel = currentLevel - searchBaseLevel;

      const finalIndent =
        relativeLevel < 0
          ? matchedIndent.slice(
              0,
              Math.max(0, matchedIndent.length + relativeLevel),
            )
          : matchedIndent + currentIndent.slice(searchBaseLevel);

      return finalIndent + line.trim();
    });

    const beforeMatch = resultLines.slice(0, matchIndex);
    const afterMatch = resultLines.slice(matchIndex + searchLines.length);
    resultLines = [...beforeMatch, ...indentedReplaceLines, ...afterMatch];
    appliedCount++;
  }

  if (appliedCount === 0) {
    return {
      success: false,
      error: "No search/replace blocks could be applied",
    };
  }
  return { success: true, content: resultLines.join(lineEnding) };
}
