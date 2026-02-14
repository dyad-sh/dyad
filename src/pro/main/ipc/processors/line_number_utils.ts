/**
 * Line Number Utilities
 *
 * Utility functions for adding and stripping line number prefixes from file content.
 * Uses a cat -n inspired format with right-aligned line numbers and a pipe separator.
 *
 * Format:
 *      1| line content
 *      2| line content
 *     10| line content
 *    100| line content
 */

/**
 * Regex pattern for parsing line number prefixes.
 * Matches: optional whitespace, digits, pipe, optional space, and captures the rest of the line.
 * The space after the pipe is optional to handle edge cases where users omit it.
 * Examples:
 *   "     1| content" -> captures "content"
 *   "    10| content" -> captures "content"
 *   "   100| content" -> captures "content"
 *   "     2| " -> captures "" (empty line)
 *   "     2|" -> captures "" (empty line without trailing space)
 */
export const LINE_NUMBER_REGEX = /^\s*(\d+)\| ?(.*)$/;

/**
 * Add line number prefixes to content.
 * The width dynamically adjusts based on total line count.
 *
 * @param content - The content to add line numbers to
 * @param startLineNumber - The line number to start from (default 1)
 * @returns Content with line number prefixes
 */
export function addLineNumberPrefixes(
  content: string,
  startLineNumber: number = 1,
): string {
  if (content === "") {
    return "";
  }

  // Normalize CRLF to LF for consistent output (line numbers are for display to LLM, not for writing back)
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  // Calculate width based on the largest line number
  const maxLineNumber = startLineNumber + totalLines - 1;
  const width = String(maxLineNumber).length;

  return lines
    .map((line, index) => {
      const lineNum = String(startLineNumber + index).padStart(width, " ");
      return `${lineNum}| ${line}`;
    })
    .join("\n");
}

/**
 * Strip line number prefixes from content.
 * Detects if all non-empty lines have the line number format and strips them.
 * Also validates that line numbers are sequential (monotonically increasing)
 * to reduce false positives on content that coincidentally matches the pattern.
 *
 * @param content - The content that may have line number prefixes
 * @returns Object with stripped content, whether line numbers were found, and the starting line number
 */
export function stripLineNumberPrefixes(content: string): {
  content: string;
  hasLineNumbers: boolean;
  startLineNumber: number;
} {
  if (content === "") {
    return { content: "", hasLineNumbers: false, startLineNumber: 0 };
  }

  // Normalize CRLF to LF for consistent processing
  const lines = content.split(/\r?\n/);
  const extractedNumbers: number[] = [];

  // Check if all non-empty lines have line number prefixes
  const hasLineNumberFormat = lines.every((line) => {
    // Empty lines after splitting might not have prefixes (edge case)
    if (line === "") return true;
    const match = line.match(LINE_NUMBER_REGEX);
    if (match) {
      extractedNumbers.push(parseInt(match[1], 10));
      return true;
    }
    return false;
  });

  if (!hasLineNumberFormat) {
    return { content, hasLineNumbers: false, startLineNumber: 0 };
  }

  // Require at least 2 line numbers to validate sequentiality.
  // Single lines matching the pattern are too ambiguous to confidently strip
  // (e.g., "42| some data" could be actual file content, not a line number prefix).
  // Also handles the all-empty-lines edge case where extractedNumbers would be empty.
  if (extractedNumbers.length < 2) {
    return { content, hasLineNumbers: false, startLineNumber: 0 };
  }

  // Verify that extracted line numbers are sequential (monotonically increasing by 1)
  // This dramatically reduces false positives on content that coincidentally matches
  // the line number pattern (e.g., "1| Alice", "2| Bob" as data content)
  for (let i = 1; i < extractedNumbers.length; i++) {
    if (extractedNumbers[i] !== extractedNumbers[i - 1] + 1) {
      return { content, hasLineNumbers: false, startLineNumber: 0 };
    }
  }

  // Strip the line number prefixes
  const strippedLines = lines.map((line) => {
    if (line === "") return "";
    const match = line.match(LINE_NUMBER_REGEX);
    if (match) {
      return match[2]; // Return the captured content after "| "
    }
    return line;
  });

  return {
    content: strippedLines.join("\n"),
    hasLineNumbers: true,
    startLineNumber: extractedNumbers[0],
  };
}
