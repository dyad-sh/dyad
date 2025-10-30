/* eslint-disable no-irregular-whitespace */

import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";

function unescapeMarkers(content: string): string {
  return content
    .replace(/^\\<<<<<<</gm, "<<<<<<<")
    .replace(/^\\=======/gm, "=======")
    .replace(/^\\>>>>>>>/gm, ">>>>>>>");
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

      if (candidates.length === 0) {
        return {
          success: false,
          error: "Search block did not match any content in the target file",
        };
      }

      matchIndex = candidates[0];
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
