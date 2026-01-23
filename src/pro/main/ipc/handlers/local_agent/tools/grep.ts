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
  case_sensitive: z
    .boolean()
    .optional()
    .describe("Whether the search should be case sensitive (default: false)"),
});

interface RipgrepMatch {
  path: string;
  lineNumber: number;
  lineText: string;
}

function buildGrepAttributes(
  args: Partial<z.infer<typeof grepSchema>>,
  count?: number,
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
  if (args.case_sensitive) {
    attrs.push(`case-sensitive="true"`);
  }
  if (count !== undefined) {
    attrs.push(`count="${count}"`);
  }
  return attrs.join(" ");
}

async function runRipgrep({
  appPath,
  query,
  includePat,
  excludePat,
  caseSensitive,
}: {
  appPath: string;
  query: string;
  includePat?: string;
  excludePat?: string;
  caseSensitive?: boolean;
}): Promise<RipgrepMatch[]> {
  return new Promise((resolve, reject) => {
    const results: RipgrepMatch[] = [];
    const args: string[] = [
      "--json",
      "--no-config",
      "--max-filesize",
      `${MAX_FILE_SEARCH_SIZE}`,
      ...RIPGREP_EXCLUDED_GLOBS.flatMap((glob) => ["--glob", glob]),
    ];

    // Case sensitivity: default is case-insensitive
    if (!caseSensitive) {
      args.push("--ignore-case");
    }

    // Include pattern
    if (includePat) {
      args.push("--glob", includePat);
    }

    // Exclude pattern
    if (excludePat) {
      args.push("--glob", `!${excludePat}`);
    }

    args.push("--", query, ".");

    const rg = spawn(getRgExecutablePath(), args, { cwd: appPath });
    let buffer = "";

    rg.stdout.on("data", (data) => {
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

          results.push({
            path: normalizedPath,
            lineNumber,
            lineText: lineText.replace(/\r?\n$/, ""),
          });
        } catch {
          // Skip malformed JSON lines
        }
      }
    });

    rg.stderr.on("data", (data) => {
      logger.warn("ripgrep stderr", data.toString());
    });

    rg.on("close", (code) => {
      // rg exits with code 1 when no matches are found; treat as success
      if (code !== 0 && code !== 1) {
        reject(new Error(`ripgrep exited with code ${code}`));
        return;
      }
      resolve(results);
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
- Use exclude_pattern to skip certain files (e.g. '*.test.ts')`,
  inputSchema: grepSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    let preview = `Search for "${args.query}"`;
    if (args.include_pattern) {
      preview += ` in ${args.include_pattern}`;
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
    const matches = await runRipgrep({
      appPath: ctx.appPath,
      query: args.query,
      includePat: args.include_pattern,
      excludePat: args.exclude_pattern,
      caseSensitive: args.case_sensitive,
    });

    const attrs = buildGrepAttributes(args, matches.length);

    if (matches.length === 0) {
      ctx.onXmlComplete(`<dyad-grep ${attrs}>No matches found.</dyad-grep>`);
      return "No matches found.";
    }

    // Format output: path:line: content
    const lines = matches.map(
      (m) => `${m.path}:${m.lineNumber}: ${m.lineText}`,
    );
    const resultText = lines.join("\n");

    ctx.onXmlComplete(
      `<dyad-grep ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-grep>`,
    );

    return resultText;
  },
};
