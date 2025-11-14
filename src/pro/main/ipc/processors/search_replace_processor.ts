/* eslint-disable no-irregular-whitespace */

import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";
import { distance } from "fastest-levenshtein";
import { normalizeString } from "@/utils/text_normalization";

// Minimum similarity threshold for fuzzy matching (0 to 1, where 1 is exact match)
const FUZZY_MATCH_THRESHOLD = 0.9;

// Early termination threshold - stop searching if we find a match this good
const EARLY_STOP_THRESHOLD = 0.95;

// Maximum time to spend on fuzzy matching (in milliseconds)
const MAX_FUZZY_SEARCH_TIME_MS = 10_000; // 10 seconds

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
 * Quick scoring function that counts how many lines exactly match.
 * This is much faster than Levenshtein and serves as a good pre-filter.
 */
function quickScoreByExactLines(
  targetLines: string[],
  searchLines: string[],
  startIdx: number,
): number {
  let exactMatches = 0;

  for (let i = 0; i < searchLines.length; i++) {
    if (startIdx + i >= targetLines.length) break;

    if (
      normalizeString(targetLines[startIdx + i]) ===
      normalizeString(searchLines[i])
    ) {
      exactMatches++;
    }
  }

  return exactMatches / searchLines.length;
}

/**
 * Fast fuzzy search using a two-pass approach:
 * 1. Quick pre-filter pass: Count exact line matches (fast)
 * 2. Detailed pass: Only compute Levenshtein on promising candidates (expensive)
 *
 * The key insight: If two blocks are similar enough for fuzzy matching (e.g., 90%),
 * then likely at least 60% of their lines will match exactly.
 */
function fastFuzzySearch(
  lines: string[],
  searchChunk: string,
  startIndex: number,
  endIndex: number,
) {
  const searchLines = searchChunk.split(/\r?\n/);
  const searchLen = searchLines.length;

  // Track start time for timeout
  const startTime = performance.now();

  // Quick threshold: require at least 60% exact line matches to be a candidate
  const QUICK_THRESHOLD = 0.6;

  // First pass: find candidates with high exact line match ratio (very fast)
  const candidates: Array<{ index: number; quickScore: number }> = [];

  for (let i = startIndex; i <= endIndex - searchLen; i++) {
    // Check time limit
    const elapsed = performance.now() - startTime;
    if (elapsed > MAX_FUZZY_SEARCH_TIME_MS) {
      console.warn(
        `Fast fuzzy search timed out during pre-filter after ${(elapsed / 1000).toFixed(1)}s`,
      );
      break;
    }

    const quickScore = quickScoreByExactLines(lines, searchLines, i);

    if (quickScore >= QUICK_THRESHOLD) {
      candidates.push({ index: i, quickScore });
    }
  }

  // Sort candidates by quick score (best first)
  candidates.sort((a, b) => b.quickScore - a.quickScore);

  // Second pass: only compute expensive Levenshtein on top candidates
  let bestScore = 0;
  let bestMatchIndex = -1;

  const MAX_CANDIDATES_TO_CHECK = 10; // Only check top 10 candidates

  for (
    let i = 0;
    i < Math.min(candidates.length, MAX_CANDIDATES_TO_CHECK);
    i++
  ) {
    const candidate = candidates[i];

    // Check time limit
    const elapsed = performance.now() - startTime;
    if (elapsed > MAX_FUZZY_SEARCH_TIME_MS) {
      console.warn(
        `Fast fuzzy search timed out during detailed pass after ${(elapsed / 1000).toFixed(1)}s. Best match: ${(bestScore * 100).toFixed(1)}%`,
      );
      break;
    }

    const originalChunk = lines
      .slice(candidate.index, candidate.index + searchLen)
      .join("\n");

    const similarity = getSimilarity(originalChunk, searchChunk);

    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatchIndex = candidate.index;

      // Early exit if we found a very good match
      if (bestScore >= EARLY_STOP_THRESHOLD) {
        return { bestScore, bestMatchIndex };
      }
    }
  }

  return { bestScore, bestMatchIndex };
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
      const { bestScore, bestMatchIndex } = fastFuzzySearch(
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
