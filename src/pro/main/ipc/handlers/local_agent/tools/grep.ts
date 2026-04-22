import { z } from "zod";
import { spawn } from "node:child_process";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  getRgExecutablePath,
  MAX_FILE_SEARCH_SIZE,
  RIPGREP_EXCLUDED_GLOBS,
} from "@/ipc/utils/ripgrep_utils";
import log from "electron-log";

const logger = log.scope("grep");

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const MAX_LINE_LENGTH = 500;

const grepSchema = z.object({
  query: z.string().describe("The regex pattern to search for"),
  include_pattern: z
    .string()
    .optional()
    .describe(
      "Glob pattern for files to include (e.g. '*.ts' for TypeScript files)",
    ),
  exclude_pattern: z
    .string()
    .optional()
    .describe("Glob pattern for files to exclude"),
  include_ignored: z
    .boolean()
    .optional()
    .describe(
      "Whether to include git-ignored and hidden files/directories such as node_modules (default: false). Use include_pattern to keep this scoped.",
    ),
  case_sensitive: z
    .boolean()
    .optional()
    .describe("Whether the search should be case sensitive (default: false)"),
  limit: z
    .number()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `Maximum number of matches to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT}). Use include_pattern to narrow results if limit is reached.`,
    ),
});

interface RipgrepMatch {
  path: string;
  lineNumber: number;
  lineText: string;
}

function buildGrepAttributes(
  args: Partial<z.infer<typeof grepSchema>>,
  count?: number,
  totalCount?: number,
): string {
  const attrs: string[] = [];
  if (args.query) {
    attrs.push(`query="${escapeXmlAttr(args.query)}"`);
  }
  if (args.include_pattern) {
    attrs.push(`include="${escapeXmlAttr(args.include_pattern)}"`);
  }
  if (args.exclude_pattern) {
    attrs.push(`exclude="${escapeXmlAttr(args.exclude_pattern)}"`);
  }
  if (args.include_ignored) {
    attrs.push(`include_ignored="true"`);
  }
  if (args.case_sensitive) {
    attrs.push(`case-sensitive="true"`);
  }
  if (count !== undefined) {
    attrs.push(`count="${count}"`);
  }
  if (totalCount !== undefined && totalCount > (count ?? 0)) {
    attrs.push(`total="${totalCount}"`);
    attrs.push(`truncated="true"`);
  }
  return attrs.join(" ");
}

function truncateLineText(text: string): string {
  if (text.length <= MAX_LINE_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_LINE_LENGTH) + "...";
}

async function runRipgrep({
  appPath,
  query,
  includePat,
  excludePat,
  includeIgnored,
  caseSensitive,
  maxMatches,
}: {
  appPath: string;
  query: string;
  includePat?: string;
  excludePat?: string;
  includeIgnored?: boolean;
  caseSensitive?: boolean;
  maxMatches?: number;
}): Promise<{ matches: RipgrepMatch[]; stoppedEarly: boolean }> {
  return new Promise((resolve, reject) => {
    const results: RipgrepMatch[] = [];
    let stoppedEarly = false;
    const args: string[] = [
      "--json",
      "--no-config",
      "--max-filesize",
      `${MAX_FILE_SEARCH_SIZE}`,
    ];

    if (includeIgnored) {
      args.push("--no-ignore", "--hidden");
    }

    // Case sensitivity: default is case-insensitive
    if (!caseSensitive) {
      args.push("--ignore-case");
    }

    // Include pattern (skip no-op "*" which would override exclusion globs
    // and .gitignore rules since --glob always takes precedence over ignore logic)
    if (includePat && includePat !== "*") {
      args.push("--glob", includePat);
    }

    // Exclude pattern
    if (excludePat) {
      args.push("--glob", `!${excludePat}`);
    }

    // Exclusion globs come LAST so they always take precedence over any
    // include pattern (later --glob flags override earlier ones in ripgrep)
    const exclusionGlobs = includeIgnored
      ? RIPGREP_EXCLUDED_GLOBS.filter((glob) => glob === "!.git/**")
      : RIPGREP_EXCLUDED_GLOBS;
    args.push(...exclusionGlobs.flatMap((glob) => ["--glob", glob]));

    args.push("--", query, ".");

    const rg = spawn(getRgExecutablePath(), args, { cwd: appPath });
    let buffer = "";

    rg.stdout.on("data", (data) => {
      if (stoppedEarly) {
        return;
      }

      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type !== "match" || !event.data) {
            continue;
          }

          const matchPath = event.data.path?.text as string;
          if (!matchPath) continue;

          const lineText = event.data.lines?.text as string;
          const lineNumber = event.data.line_number as number;

          if (typeof lineText !== "string" || typeof lineNumber !== "number") {
            continue;
          }

          // Normalize path (remove leading ./)
          const normalizedPath = matchPath.replace(/^\.\//, "");

          if (maxMatches !== undefined && results.length >= maxMatches) {
            stoppedEarly = true;
            rg.kill();
            break;
          }

          results.push({
            path: normalizedPath,
            lineNumber,
            lineText: lineText.replace(/\r?\n$/, ""),
          });

          if (maxMatches !== undefined && results.length >= maxMatches) {
            stoppedEarly = true;
            rg.kill();
            break;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    });

    rg.stderr.on("data", (data) => {
      logger.warn("ripgrep stderr", data.toString());
    });

    rg.on("close", (code) => {
      if (stoppedEarly) {
        resolve({ matches: results, stoppedEarly });
        return;
      }

      // rg exits with code 1 when no matches are found; treat as success
      if (code !== 0 && code !== 1) {
        reject(new Error(`ripgrep exited with code ${code}`));
        return;
      }
      resolve({ matches: results, stoppedEarly });
    });

    rg.on("error", (error) => {
      reject(error);
    });
  });
}

export const grepTool: ToolDefinition<z.infer<typeof grepSchema>> = {
  name: "grep",
  description: `Search for a regex pattern in the codebase using ripgrep.

- Returns matching lines with file paths and line numbers
- By default, the search is case-insensitive
- Use include_pattern to filter by file type (e.g. '*.tsx')
- Use exclude_pattern to skip certain files (e.g. '*.test.ts')
- Use include_ignored=true to search git-ignored and hidden files/directories such as node_modules. Pair it with include_pattern to keep searches scoped.
- Results are limited to ${DEFAULT_LIMIT} matches by default (max ${MAX_LIMIT}). If results are truncated, narrow your search with include_pattern or a more specific query.`,
  inputSchema: grepSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    let preview = `Search for "${args.query}"`;
    if (args.include_pattern) {
      preview += ` in ${args.include_pattern}`;
    }
    if (args.include_ignored) {
      preview += " including ignored files";
    }
    return preview;
  },

  buildXml: (args, isComplete) => {
    // When complete, return undefined so execute's onXmlComplete provides the final XML
    if (isComplete) {
      return undefined;
    }

    if (!args.query) return undefined;
    const attrs = buildGrepAttributes(args);
    return `<dyad-grep ${attrs}>Searching...</dyad-grep>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const includePatWasWildcard = args.include_pattern === "*";
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const { matches: allMatches, stoppedEarly } = await runRipgrep({
      appPath: ctx.appPath,
      query: args.query,
      includePat: args.include_pattern,
      excludePat: args.exclude_pattern,
      includeIgnored: args.include_ignored,
      caseSensitive: args.case_sensitive,
      maxMatches: args.include_ignored ? limit + 1 : undefined,
    });

    const totalCount = allMatches.length;
    // Sort for deterministic output (ripgrep's parallel execution can produce varying order)
    const sortedMatches = [...allMatches].sort(
      (a, b) => a.path.localeCompare(b.path) || a.lineNumber - b.lineNumber,
    );
    const matches = sortedMatches.slice(0, limit);
    const wasTruncated = stoppedEarly || totalCount > limit;

    const attrs = buildGrepAttributes(args, matches.length, totalCount);

    if (matches.length === 0) {
      ctx.onXmlComplete(`<dyad-grep ${attrs}>No matches found.</dyad-grep>`);
      return "No matches found.";
    }

    // Format output: path:line: content (with truncated line text)
    const lines = matches.map(
      (m) => `${m.path}:${m.lineNumber}: ${truncateLineText(m.lineText)}`,
    );
    let resultText = lines.join("\n");

    // Add truncation notice for the AI
    if (wasTruncated) {
      const totalText = stoppedEarly ? `at least ${totalCount}` : totalCount;
      resultText += `\n\n[TRUNCATED: Showing ${matches.length} of ${totalText} matches. Use include_pattern to narrow your search (e.g., include_pattern="*.tsx") or use a more specific query.]`;
    }

    // Warn the LLM that "*" was ignored so it doesn't retry with the same pattern
    if (includePatWasWildcard) {
      resultText += `\n\n[NOTE: include_pattern="*" was ignored because it matches all files including git-ignored files! Omit include_pattern to search all files, or use a specific glob like "*.ts".]`;
    }

    ctx.onXmlComplete(
      `<dyad-grep ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-grep>`,
    );

    return resultText;
  },
};
