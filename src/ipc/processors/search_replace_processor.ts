/* eslint-disable no-irregular-whitespace */

import { everyLineHasLineNumbers, stripLineNumbers } from "./line_number_utils";

// addLineNumbers intentionally omitted here (only needed for verbose diagnostics)

type SearchReplaceBlock = {
  startLine: number; // 1-based; 0 if unknown
  searchContent: string;
  replaceContent: string;
};

const BLOCK_REGEX =
  /(?:^|\n)<<<<<<<\s+SEARCH>?\s*\n((?:\:start_line:\s*(\d+)\s*\n))?((?:\:end_line:\s*(\d+)\s*\n))?((?<!\\)-------\s*\n)?([\s\S]*?)(?:\n)?(?:(?<=\n)(?<!\\)=======\s*\n)([\s\S]*?)(?:\n)?(?:(?<=\n)(?<!\\)>>>>>>>\s+REPLACE)(?=\n|$)/g;

export function parseSearchReplaceBlocks(
  diffContent: string,
): SearchReplaceBlock[] {
  const matches = [...diffContent.matchAll(BLOCK_REGEX)];
  return matches
    .map((m) => ({
      startLine: Number(m[2] ?? 0),
      searchContent: m[6] ?? "",
      replaceContent: m[7] ?? "",
    }))
    .sort((a, b) => a.startLine - b.startLine);
}

function unescapeMarkers(content: string): string {
  return content
    .replace(/^\\<<<<<<</gm, "<<<<<<<")
    .replace(/^\\=======/gm, "=======")
    .replace(/^\\>>>>>>>/gm, ">>>>>>>")
    .replace(/^\\-------/gm, "-------")
    .replace(/^\\:end_line:/gm, ":end_line:")
    .replace(/^\\:start_line:/gm, ":start_line:");
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
        "Invalid diff format - missing required sections. Expected <<<<<<< SEARCH / :start_line: / ------- / ======= / >>>>>>> REPLACE",
    };
  }

  const lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n";
  let resultLines = originalContent.split(/\r?\n/);
  let delta = 0;
  let appliedCount = 0;

  for (const block of blocks) {
    let { searchContent, replaceContent } = block;
    let startLine = block.startLine + (block.startLine === 0 ? 0 : delta);

    // Normalize markers and strip line numbers if present on all lines
    searchContent = unescapeMarkers(searchContent);
    replaceContent = unescapeMarkers(replaceContent);

    let searchLines = searchContent === "" ? [] : searchContent.split(/\r?\n/);
    let replaceLines =
      replaceContent === "" ? [] : replaceContent.split(/\r?\n/);

    if (searchLines.length === 0) {
      // Empty search not allowed
      continue;
    }

    const hasAllLineNumbers =
      (everyLineHasLineNumbers(searchContent) &&
        everyLineHasLineNumbers(replaceContent)) ||
      (everyLineHasLineNumbers(searchContent) && replaceContent.trim() === "");

    if (hasAllLineNumbers && startLine === 0) {
      startLine = parseInt(searchContent.split("\n")[0].split("|")[0]);
    }
    if (hasAllLineNumbers) {
      searchContent = stripLineNumbers(searchContent);
      replaceContent = stripLineNumbers(replaceContent);
      searchLines = searchContent ? searchContent.split(/\r?\n/) : [];
      replaceLines = replaceContent ? replaceContent.split(/\r?\n/) : [];
    }

    // Try exact match at hinted start line first
    let matchIndex = -1;
    if (startLine) {
      const exactStartIdx = Math.max(0, startLine - 1);
      const exactEndIdx = exactStartIdx + searchLines.length - 1;
      const chunk = resultLines
        .slice(exactStartIdx, exactEndIdx + 1)
        .join("\n");
      if (chunk === searchLines.join("\n")) {
        matchIndex = exactStartIdx;
      }
    }

    // Fallback to global exact search if no match at hint
    if (matchIndex === -1) {
      const target = searchLines.join("\n");
      const hay = resultLines.join("\n");
      const pos = hay.indexOf(target);
      if (pos !== -1) {
        matchIndex = hay.substring(0, pos).split("\n").length - 1;
      }
    }

    if (matchIndex === -1) {
      // No match; skip this block
      continue;
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
    delta = delta - matchedLines.length + indentedReplaceLines.length;
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
