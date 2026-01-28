/* eslint-disable no-irregular-whitespace */

import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";
import { normalizeString } from "@/utils/text_normalization";
import log from "electron-log";

const logger = log.scope("search_replace_processor");

// ============================================================================
// Options Interface
// ============================================================================

export interface SearchReplaceOptions {
  /**
   * If true, only exact string matching is used (Pass 1 only).
   * All cascading fuzzy matching passes are skipped.
   */
  exactMatchOnly?: boolean;
  /**
   * If true, returns an error when search and replace content are identical.
   * By default, identical content is allowed (treated as a no-op with warning).
   */
  rejectIdentical?: boolean;
}

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
 * Cascading fuzzy matching: try each pass in order until we find a match
 * Returns the match index or -1 if no match found, along with any error
 */
function cascadingMatch(
  resultLines: string[],
  searchLines: string[],
  exactMatchOnly: boolean,
): { matchIndex: number; error?: string; passName?: string } {
  const passesToTry = exactMatchOnly ? [MATCHING_PASSES[0]] : MATCHING_PASSES;

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

  // No match found in any pass
  if (exactMatchOnly) {
    return {
      matchIndex: -1,
      error:
        "Search content did not match exactly. Ensure the content matches the file exactly, including all whitespace and indentation.",
    };
  }

  return {
    matchIndex: -1,
    error:
      "Search block did not match any content in the target file after trying all matching passes (exact, trailing-whitespace-ignored, all-edge-whitespace-ignored, unicode-normalized)",
  };
}

export function applySearchReplace(
  originalContent: string,
  diffContent: string,
  options: SearchReplaceOptions = {},
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
      if (options.rejectIdentical) {
        return {
          success: false,
          error: "Search and replace content are identical",
        };
      }
      logger.warn("Search and replace blocks are identical");
    }

    // Use cascading fuzzy matching to find the match
    let matchResult = cascadingMatch(
      resultLines,
      searchLines,
      options.exactMatchOnly ?? false,
    );

    // If no match found, try with trimmed leading/trailing empty lines as a fallback
    if (matchResult.error && !matchResult.error.includes("ambiguous")) {
      const trimmedSearchLines = trimEmptyLines(searchLines);
      if (trimmedSearchLines.length !== searchLines.length) {
        const trimmedResult = cascadingMatch(
          resultLines,
          trimmedSearchLines,
          options.exactMatchOnly ?? false,
        );
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
