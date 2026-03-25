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

  // De-duplicate: if multiple blocks target the same path, keep the last
  // occurrence (most likely the final/complete version).
  const seenPaths = new Map<string, number>();
  for (let i = 0; i < blocks.length; i++) {
    seenPaths.set(blocks[i].path, i);
  }
  const dedupedBlocks = blocks.filter((_, i) => {
    const block = blocks[i];
    return seenPaths.get(block.path) === i;
  });

  logger.info(
    `Converting ${dedupedBlocks.length} markdown code block(s) to <joy-write> tags` +
    (dedupedBlocks.length !== blocks.length ? ` (${blocks.length - dedupedBlocks.length} duplicates removed)` : ""),
  );

  let result = fullResponse;

  // Process blocks in reverse order so indices don't shift
  for (const block of dedupedBlocks.reverse()) {
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

    let filePath = detectFilePath(fullMatch, code, cleaned, match.index);

    // Ultimate fallback: for any code block with JSX-like content or
    // React imports, infer the path from the code itself. This catches
    // local models that just dump code blocks with no file indication.
    if (!filePath && code.length > 30) {
      const inferred = inferPathFromCode(code);
      if (inferred) {
        filePath = inferred;
        logger.info(`Inferred file path ${inferred} from code content`);
      }
    }

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
  if (headingMatch) {
    const candidate = headingMatch[1].trim();
    if (isFilePath(candidate)) return candidate;
    const resolved = resolveBareName(candidate, textBefore);
    if (resolved) return resolved;
  }

  // Check for bold/backtick patterns: **src/pages/Index.tsx** or `src/pages/Index.tsx`
  const boldMatch = textBefore.match(
    /(?:\*\*|`)([^\n*`]+\.\w+)(?:\*\*|`)\s*:?\s*$/,
  );
  if (boldMatch) {
    const candidate = boldMatch[1].trim();
    if (isFilePath(candidate)) return candidate;
    const resolved = resolveBareName(candidate, textBefore);
    if (resolved) return resolved;
  }

  // Check for colon patterns:  src/pages/Index.tsx:  or  File: src/pages/Index.tsx
  const colonMatch = textBefore.match(
    /(?:file|path|update|create|modify|edit)?:?\s+([^\s]+\.\w+)\s*:?\s*$/i,
  );
  if (colonMatch) {
    const candidate = colonMatch[1].trim();
    if (isFilePath(candidate)) return candidate;
    const resolved = resolveBareName(candidate, textBefore);
    if (resolved) return resolved;
  }

  // Strategy 4: Detect bare filenames in context and resolve to full paths.
  // Local models often say "Create `Button.tsx`" or "named `App.tsx`" without
  // full directory paths.
  const bareFileMatch = textBefore.match(
    /(?:\*\*|`|named\s+|file\s+)([A-Z][A-Za-z0-9_]*\.(?:tsx|jsx|ts|js|css))(?:\*\*|`|[\s:,])\s*(?::?\s*)?$/,
  );
  if (bareFileMatch) {
    const resolved = resolveBareName(bareFileMatch[1], textBefore);
    if (resolved) return resolved;
  }

  // Strategy 5: Infer path from code content for React/TS code blocks.
  const lang = fullMatch.match(/^```(\w+)/)?.[1] || "";
  if (/^(?:tsx|jsx|typescript|ts)$/i.test(lang)) {
    const inferred = inferPathFromCode(code);
    if (inferred) return inferred;
  }

  return null;
}

/**
 * Map well-known bare filenames to their conventional paths.
 */
const WELL_KNOWN_FILES: Record<string, string> = {
  "App.tsx": "src/App.tsx",
  "App.jsx": "src/App.jsx",
  "App.ts": "src/App.ts",
  "Index.tsx": "src/pages/Index.tsx",
  "Index.jsx": "src/pages/Index.jsx",
  "index.css": "src/index.css",
  "main.tsx": "src/main.tsx",
  "main.ts": "src/main.ts",
  "globals.css": "src/globals.css",
};

/**
 * Resolve a bare filename (e.g. "Button.tsx") to a full path using
 * context clues and conventions.
 */
function resolveBareName(
  bareName: string,
  textBefore: string,
): string | null {
  // Check well-known files first
  if (WELL_KNOWN_FILES[bareName]) {
    return WELL_KNOWN_FILES[bareName];
  }

  // Look for a full path mention in the surrounding text
  const ext = bareName.split(".").pop() || "";
  const fullPathMention = textBefore.match(
    new RegExp(`((?:src|app|lib|pages|components|hooks|utils|services)/[^\\s\`"*]*${escapeRegExp(bareName)})`, "i"),
  );
  if (fullPathMention) {
    return fullPathMention[1];
  }

  // Infer directory from context keywords
  if (/component/i.test(textBefore) && /^[tj]sx?$/i.test(ext)) {
    return `src/components/${bareName}`;
  }
  if (/page|route/i.test(textBefore) && /^[tj]sx?$/i.test(ext)) {
    return `src/pages/${bareName}`;
  }
  if (/hook/i.test(textBefore) && /^[tj]sx?$/i.test(ext)) {
    return `src/hooks/${bareName}`;
  }
  if (/util|helper/i.test(textBefore) && /^[tj]sx?$/i.test(ext)) {
    return `src/utils/${bareName}`;
  }
  if (/style|css/i.test(textBefore) && /css$/i.test(ext)) {
    return `src/${bareName}`;
  }

  // Default: tsx/jsx → src/components, ts/js → src/lib
  if (/^[tj]sx$/i.test(ext)) {
    return `src/components/${bareName}`;
  }
  if (/^[tj]s$/i.test(ext)) {
    return `src/lib/${bareName}`;
  }

  return null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Try to infer a file path from the code content itself.
 * Works for React/TypeScript code blocks that export a named component.
 */
function inferPathFromCode(code: string): string | null {
  // Detect exported component name:
  //   export default function MyPage()
  //   export default MyComponent
  //   const MyComponent: React.FC = ...
  const exportMatch = code.match(
    /export\s+default\s+(?:function\s+|class\s+)?([A-Z][A-Za-z0-9_]*)/,
  );
  const componentName = exportMatch?.[1]
    // Fallback: const Button: React.FC  or  const Button = () => ...  (with export default at end)
    ?? code.match(/^const\s+([A-Z][A-Za-z0-9_]*)\s*(?::\s*React\.FC|=\s*\()/m)?.[1];

  if (componentName) {
    // Well-known component names → pages
    if (/^(?:Index|Home|App|Main|Root|Layout|Dashboard|Landing|Login|Register|NotFound)$/.test(componentName)) {
      if (componentName === "App") return "src/App.tsx";
      return `src/pages/${componentName}.tsx`;
    }
    return `src/components/${componentName}.tsx`;
  }

  // If code has JSX but no named export, fall back to Index.tsx
  if (/<[A-Z]/.test(code) || /className=/.test(code) || /return\s*\(?\s*</.test(code)) {
    return "src/pages/Index.tsx";
  }

  return null;
}

function extractPathFromComment(line: string): string | null {
  // Match: // src/path/file.ext  or  // File: src/path/file.ext  or  // Button.tsx
  const singleLine = line.match(
    /^\/\/\s*(?:File:\s*)?(\S+\.\w+)/,
  );
  if (singleLine) {
    if (isFilePath(singleLine[1])) return singleLine[1];
    const resolved = resolveBareName(singleLine[1], "");
    if (resolved) return resolved;
  }

  // Match: /* src/path/file.ext */
  const blockComment = line.match(
    /^\/\*\s*(?:File:\s*)?(\S+\.\w+)\s*\*\//,
  );
  if (blockComment) {
    if (isFilePath(blockComment[1])) return blockComment[1];
    const resolved = resolveBareName(blockComment[1], "");
    if (resolved) return resolved;
  }

  // Match: # src/path/file.ext  (Python/Ruby/Shell style)
  const hashComment = line.match(
    /^#\s+(?:File:\s*)?(\S+\.\w+)/,
  );
  if (hashComment) {
    if (isFilePath(hashComment[1])) return hashComment[1];
    const resolved = resolveBareName(hashComment[1], "");
    if (resolved) return resolved;
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
