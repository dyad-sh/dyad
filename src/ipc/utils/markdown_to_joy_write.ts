import log from "electron-log";

const logger = log.scope("markdown_to_joy_write");

/**
 * Patterns that local models use to specify file paths in markdown code blocks:
 *
 * 1. Comment on first line:  `// src/pages/Index.tsx`  or  `// File: src/App.tsx`
 * 2. Heading before block:   `### src/pages/Index.tsx`  or  `### \`src/pages/Index.tsx\``
 * 3. Text before block:      `**src/pages/Index.tsx**`  or  `` `src/pages/Index.tsx` ``
 * 4. Language hint:           ` ```tsx title="src/pages/Index.tsx" `
 */

interface ExtractedBlock {
  path: string;
  content: string;
}

/**
 * Detect markdown code blocks with file paths and convert them to <joy-write> tags.
 *
 * This is a fallback for local models (Ollama, LM Studio) that sometimes output
 * code in markdown fences instead of <joy-write> tags despite system prompt instructions.
 *
 * Only converts when NO <joy-write> tags are already present (to avoid double-processing).
 */
export function convertMarkdownCodeBlocksToJoyWrite(
  fullResponse: string,
): string {
  // If the response already contains joy-write (or dyad-write) tags, don't touch it.
  if (/<(?:joy|dyad)-write\s/i.test(fullResponse)) {
    return fullResponse;
  }

  const blocks = extractCodeBlocksWithPaths(fullResponse);

  if (blocks.length === 0) {
    return fullResponse;
  }

  logger.info(
    `Converting ${blocks.length} markdown code block(s) to <joy-write> tags`,
  );

  let result = fullResponse;

  // Process blocks in reverse order so indices don't shift
  for (const block of blocks.reverse()) {
    // Build the <joy-write> tag
    const joyWrite = `<joy-write path="${block.path}" description="Auto-converted from markdown code block">\n${block.content}\n</joy-write>`;

    // Replace the matched region in the response
    result = result.replace(block._raw!, joyWrite);
  }

  return result;
}

/** Pattern for fenced code blocks: ```lang ... ``` */
const CODE_BLOCK_REGEX =
  /```(\w+)?(?:[ \t]+[^\n]*)?\n([\s\S]*?)```/g;

/** Common file path pattern */
const FILE_PATH_PATTERN =
  /^(?:src|app|lib|pages|components|hooks|utils|styles|public|assets|config|types|services|api)\/.+\.\w+$/;

function extractCodeBlocksWithPaths(
  fullResponse: string,
): (ExtractedBlock & { _raw: string })[] {
  const results: (ExtractedBlock & { _raw: string })[] = [];

  // Remove <think>...</think> blocks for analysis purposes
  const cleaned = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, "");

  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop
  while ((match = CODE_BLOCK_REGEX.exec(cleaned)) !== null) {
    const fullMatch = match[0];
    const lang = match[1] || "";
    const code = match[2];

    // Skip non-code languages (like markdown or text)
    if (lang && /^(markdown|md|text|plaintext|json|bash|sh|shell|cmd|powershell|sql|csv)$/i.test(lang)) {
      continue;
    }

    const filePath = detectFilePath(fullMatch, code, cleaned, match.index);

    if (filePath) {
      // Clean the code: remove the file path comment from first line if present
      let cleanedCode = code;
      const firstLine = cleanedCode.split("\n")[0];
      if (firstLine && isFilePathComment(firstLine)) {
        cleanedCode = cleanedCode.split("\n").slice(1).join("\n");
      }

      results.push({
        path: normalizePath(filePath),
        content: cleanedCode.trim(),
        _raw: fullMatch,
      });
    }
  }

  return results;
}

function detectFilePath(
  fullMatch: string,
  code: string,
  fullText: string,
  matchIndex: number,
): string | null {
  // Strategy 1: File path comment on first line of code
  //   // src/pages/Index.tsx
  //   // File: src/App.tsx
  //   /* src/components/Button.tsx */
  const firstLine = code.split("\n")[0]?.trim();
  if (firstLine) {
    const commentPath = extractPathFromComment(firstLine);
    if (commentPath) return commentPath;
  }

  // Strategy 2: title attribute in the fence line
  //   ```tsx title="src/pages/Index.tsx"
  const titleMatch = fullMatch.match(
    /```\w+\s+title=["']([^"']+)["']/,
  );
  if (titleMatch && isFilePath(titleMatch[1])) {
    return titleMatch[1];
  }

  // Strategy 3: Look at text immediately before the code block (within ~200 chars)
  const textBefore = fullText.slice(
    Math.max(0, matchIndex - 200),
    matchIndex,
  );

  // Check for heading patterns:  ### src/pages/Index.tsx  or  ### `src/pages/Index.tsx`
  const headingMatch = textBefore.match(
    /#{1,6}\s+[`"]*([^\n`"]+\.\w+)[`"]*\s*$/,
  );
  if (headingMatch && isFilePath(headingMatch[1].trim())) {
    return headingMatch[1].trim();
  }

  // Check for bold/backtick patterns: **src/pages/Index.tsx** or `src/pages/Index.tsx`
  const boldMatch = textBefore.match(
    /(?:\*\*|`)([^\n*`]+\.\w+)(?:\*\*|`)\s*:?\s*$/,
  );
  if (boldMatch && isFilePath(boldMatch[1].trim())) {
    return boldMatch[1].trim();
  }

  // Check for colon patterns:  src/pages/Index.tsx:  or  File: src/pages/Index.tsx
  const colonMatch = textBefore.match(
    /(?:file|path|update|create|modify|edit)?:?\s+([^\s]+\.\w+)\s*:?\s*$/i,
  );
  if (colonMatch && isFilePath(colonMatch[1].trim())) {
    return colonMatch[1].trim();
  }

  return null;
}

function extractPathFromComment(line: string): string | null {
  // Match: // src/path/file.ext  or  // File: src/path/file.ext
  const singleLine = line.match(
    /^\/\/\s*(?:File:\s*)?(\S+\.\w+)/,
  );
  if (singleLine && isFilePath(singleLine[1])) {
    return singleLine[1];
  }

  // Match: /* src/path/file.ext */
  const blockComment = line.match(
    /^\/\*\s*(?:File:\s*)?(\S+\.\w+)\s*\*\//,
  );
  if (blockComment && isFilePath(blockComment[1])) {
    return blockComment[1];
  }

  // Match: # src/path/file.ext  (Python/Ruby/Shell style)
  const hashComment = line.match(
    /^#\s+(?:File:\s*)?(\S+\.\w+)/,
  );
  if (hashComment && isFilePath(hashComment[1])) {
    return hashComment[1];
  }

  return null;
}

function isFilePathComment(line: string): boolean {
  return extractPathFromComment(line.trim()) !== null;
}

function isFilePath(candidate: string): boolean {
  // Must have a directory separator and a file extension
  if (!candidate.includes("/") && !candidate.includes("\\")) {
    return false;
  }
  if (!/\.\w+$/.test(candidate)) {
    return false;
  }
  // Must start with a known directory or relative path
  return (
    FILE_PATH_PATTERN.test(candidate) ||
    candidate.startsWith("./") ||
    candidate.startsWith("../")
  );
}

function normalizePath(filePath: string): string {
  // Remove leading ./ and normalize slashes
  return filePath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}
