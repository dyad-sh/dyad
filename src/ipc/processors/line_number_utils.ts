export function addLineNumbers(content: string, startLine: number = 1): string {
  // If content is empty, return empty string - empty files should not have line numbers
  // If content is empty but startLine > 1, return "startLine | " because we know the file is not empty
  // but the content is empty at that line offset
  if (content === "") {
    return startLine === 1 ? "" : `${startLine} | \n`;
  }

  // Split into lines and handle trailing line feeds (\n)
  const lines = content.split("\n");
  const lastLineEmpty = lines[lines.length - 1] === "";
  if (lastLineEmpty) {
    lines.pop();
  }

  const maxLineNumberWidth = String(startLine + lines.length - 1).length;
  const numberedContent = lines
    .map((line, index) => {
      const lineNumber = String(startLine + index).padStart(
        maxLineNumberWidth,
        " ",
      );
      return `${lineNumber} | ${line}`;
    })
    .join("\n");

  return numberedContent + "\n";
}
// Checks if every line in the content has line numbers prefixed (e.g., "1 | content" or "123 | content")
// Line numbers must be followed by a single pipe character (not double pipes)
export function everyLineHasLineNumbers(content: string): boolean {
  const lines = content.split(/\r?\n/); // Handles both CRLF (carriage return (\r) + line feed (\n)) and LF (line feed (\n)) line endings
  return (
    lines.length > 0 && lines.every((line) => /^\s*\d+\s+\|(?!\|)/.test(line))
  );
}

/**
 * Strips line numbers from content while preserving the actual content.
 *
 * @param content The content to process
 * @param aggressive When false (default): Only strips lines with clear number patterns like "123 | content"
 *                   When true: Uses a more lenient pattern that also matches lines with just a pipe character,
 *                   which can be useful when LLMs don't perfectly format the line numbers in diffs
 * @returns The content with line numbers removed
 */
export function stripLineNumbers(
  content: string,
  aggressive: boolean = false,
): string {
  // Split into lines to handle each line individually
  const lines = content.split(/\r?\n/);

  // Process each line
  const processedLines = lines.map((line) => {
    // Match line number pattern and capture everything after the pipe
    const match = aggressive
      ? line.match(/^\s*(?:\d+\s)?\|\s(.*)$/)
      : line.match(/^\s*\d+\s+\|(?!\|)\s?(.*)$/);
    return match ? match[1] : line;
  });

  // Join back with original line endings (carriage return (\r) + line feed (\n) or just line feed (\n))
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  return processedLines.join(lineEnding);
}
