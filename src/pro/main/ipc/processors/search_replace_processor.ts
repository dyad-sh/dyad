/* eslint-disable no-irregular-whitespace */

import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";
import { distance } from "fastest-levenshtein";
import { normalizeString } from "@/utils/text_normalization";

// Minimum similarity threshold for fuzzy matching (0 to 1, where 1 is exact match)
const FUZZY_MATCH_THRESHOLD = 0.8;

function unescapeMarkers(content: string): string {
  return content
    .replace(/^\\<<<<<<</gm, "<<<<<<<")
    .replace(/^\\=======/gm, "=======")
    .replace(/^\\>>>>>>>/gm, ">>>>>>>");
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns a value between 0 and 1, where 1 is an exact match
 */
function getSimilarity(original: string, search: string): number {
  // Empty searches are no longer supported
  if (search === "") {
    return 0;
  }

  // Use the normalizeString utility to handle smart quotes and other special characters
  const normalizedOriginal = normalizeString(original);
  const normalizedSearch = normalizeString(search);

  if (normalizedOriginal === normalizedSearch) {
    return 1;
  }

  // Calculate Levenshtein distance using fastest-levenshtein's distance function
  const dist = distance(normalizedOriginal, normalizedSearch);

  // Calculate similarity ratio (0 to 1, where 1 is an exact match)
  const maxLength = Math.max(
    normalizedOriginal.length,
    normalizedSearch.length,
  );
  return 1 - dist / maxLength;
}

/**
 * Performs a "middle-out" search of `lines` (between [startIndex, endIndex]) to find
 * the slice that is most similar to `searchChunk`. Returns the best score, index, and matched text.
 */
function fuzzySearch(
  lines: string[],
  searchChunk: string,
  startIndex: number,
  endIndex: number,
) {
  let bestScore = 0;
  let bestMatchIndex = -1;
  let bestMatchContent = "";
  const searchLen = searchChunk.split(/\r?\n/).length;

  // Middle-out from the midpoint
  const midPoint = Math.floor((startIndex + endIndex) / 2);
  let leftIndex = midPoint;
  let rightIndex = midPoint + 1;

  while (leftIndex >= startIndex || rightIndex <= endIndex - searchLen) {
    if (leftIndex >= startIndex) {
      const originalChunk = lines
        .slice(leftIndex, leftIndex + searchLen)
        .join("\n");
      const similarity = getSimilarity(originalChunk, searchChunk);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatchIndex = leftIndex;
        bestMatchContent = originalChunk;
      }
      leftIndex--;
    }

    if (rightIndex <= endIndex - searchLen) {
      const originalChunk = lines
        .slice(rightIndex, rightIndex + searchLen)
        .join("\n");
      const similarity = getSimilarity(originalChunk, searchChunk);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatchIndex = rightIndex;
        bestMatchContent = originalChunk;
      }
      rightIndex++;
    }
  }

  return { bestScore, bestMatchIndex, bestMatchContent };
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

    // If search and replace are identical, it's a no-op and should be treated as an error
    if (searchLines.join("\n") === replaceLines.join("\n")) {
      return {
        success: false,
        error: "Search and replace blocks are identical",
      };
    }

    let matchIndex = -1;

    const target = searchLines.join("\n");
    const hay = resultLines.join("\n");

    // Try exact string matching first and detect ambiguity
    const exactPositions: number[] = [];
    let fromIndex = 0;
    while (true) {
      const found = hay.indexOf(target, fromIndex);
      if (found === -1) break;
      exactPositions.push(found);
      fromIndex = found + 1;
    }

    if (exactPositions.length > 1) {
      return {
        success: false,
        error:
          "Search block matched multiple locations in the target file (ambiguous)",
      };
    }
    if (exactPositions.length === 1) {
      const pos = exactPositions[0];
      matchIndex = hay.substring(0, pos).split("\n").length - 1;
    }

    if (matchIndex === -1) {
      // Lenient fallback: ignore leading indentation and trailing whitespace
      const normalizeForMatch = (line: string) =>
        line.replace(/^[\t ]*/, "").replace(/[\t ]+$/, "");

      const normalizedSearch = searchLines.map(normalizeForMatch);

      const candidates: number[] = [];
      for (let i = 0; i <= resultLines.length - searchLines.length; i++) {
        let allMatch = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (normalizeForMatch(resultLines[i + j]) !== normalizedSearch[j]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          candidates.push(i);
          if (candidates.length > 1) break; // we only care if >1 for ambiguity
        }
      }

      if (candidates.length > 1) {
        return {
          success: false,
          error:
            "Search block fuzzy matched multiple locations in the target file (ambiguous)",
        };
      }

      if (candidates.length === 1) {
        matchIndex = candidates[0];
      }
    }

    // If still no match, try fuzzy matching with Levenshtein distance
    if (matchIndex === -1) {
      const searchChunk = searchLines.join("\n");
      const { bestScore, bestMatchIndex } = fuzzySearch(
        resultLines,
        searchChunk,
        0,
        resultLines.length,
      );

      if (bestScore >= FUZZY_MATCH_THRESHOLD) {
        matchIndex = bestMatchIndex;
      } else {
        return {
          success: false,
          error: `Search block did not match any content in the target file. Best fuzzy match had similarity of ${(bestScore * 100).toFixed(1)}% (threshold: ${(FUZZY_MATCH_THRESHOLD * 100).toFixed(1)}%)`,
        };
      }
    }

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
