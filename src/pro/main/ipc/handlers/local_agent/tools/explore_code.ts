import { z } from "zod";

import { readSettings } from "@/main/settings";
import {
  isCodeExplorerReady,
  runCodeExplorer,
} from "@/ipc/processors/code_explorer";
import {
  AgentContext,
  ToolDefinition,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import type { CodeExplorerResult } from "../../../../../../../shared/code_explorer_types";

const DEFAULT_MAX_FILES = 5;
const MAX_FILES = 8;
const DEFAULT_MAX_DEPTH = 2;
const MAX_DEPTH = 3;

const exploreCodeSchema = z.object({
  query: z.string().min(1).describe("Natural-language code exploration query"),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to explore instead of the current app. Omit to explore the current app.",
    ),
  tsconfig_path: z
    .string()
    .optional()
    .describe(
      "Optional app-relative path to a TypeScript config file. Omit to use tsconfig.app.json or tsconfig.json.",
    ),
  max_files: z
    .number()
    .int()
    .min(1)
    .max(MAX_FILES)
    .optional()
    .describe(
      `Maximum number of relevant files to return (default: ${DEFAULT_MAX_FILES}, max: ${MAX_FILES}).`,
    ),
  max_depth: z
    .number()
    .int()
    .min(0)
    .max(MAX_DEPTH)
    .optional()
    .describe(
      `Graph expansion depth from matching symbols (default: ${DEFAULT_MAX_DEPTH}, max: ${MAX_DEPTH}).`,
    ),
});

function buildExploreCodeAttributes(
  args: Partial<z.infer<typeof exploreCodeSchema>>,
  result?: CodeExplorerResult,
): string {
  const attrs: string[] = [];
  if (args.query) attrs.push(`query="${escapeXmlAttr(args.query)}"`);
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.tsconfig_path) {
    attrs.push(`tsconfig_path="${escapeXmlAttr(args.tsconfig_path)}"`);
  }
  if (result) {
    attrs.push(`files="${result.files.length}"`);
    attrs.push(`symbols="${result.totalSymbols}"`);
    attrs.push(`index_ms="${result.indexMs}"`);
    attrs.push(`search_ms="${result.searchMs}"`);
    if (result.truncated) attrs.push(`truncated="true"`);
  }
  return attrs.join(" ");
}

function formatExploreCodeResult(result: CodeExplorerResult): string {
  const lines: string[] = [
    `## Code exploration: ${result.query}`,
    "",
    `Found ${result.totalSymbols} symbols across ${result.totalFiles} files.`,
    `Indexed ${result.indexedFileCount} files in ${result.indexMs}ms; searched in ${result.searchMs}ms.`,
  ];

  if (result.notes.length > 0) {
    lines.push("", ...result.notes.map((note) => `[${note}]`));
  }

  if (result.files.length === 0) {
    lines.push("", "No matching TypeScript symbols found.");
    return lines.join("\n");
  }

  for (const file of result.files) {
    const symbolSummary = file.symbols
      .slice(0, 6)
      .map((symbol) => `${symbol.name} (${symbol.kind}:${symbol.line})`)
      .join(", ");
    lines.push(
      "",
      `#### ${file.path}${symbolSummary ? ` - ${symbolSummary}` : ""}`,
    );

    for (const window of file.windows) {
      lines.push("", "```ts", ...window.lines, "```");
    }
  }

  return lines.join("\n");
}

export const exploreCodeTool: ToolDefinition<
  z.infer<typeof exploreCodeSchema>
> = {
  name: "explore_code",
  description: `Explore a configured TypeScript codebase with the TypeScript compiler API.

Use this when you need to understand how a feature, symbol, type, component, service, or flow is implemented across files. It returns relevant symbols and line-numbered source windows grouped by file, often replacing several grep/read_file/list_files calls.

Only use this for TypeScript projects. If the project does not have TypeScript installed and configured, use grep/list_files/read_file instead.`,
  inputSchema: exploreCodeSchema,
  defaultConsent: "always",

  isEnabled: (ctx) => {
    const settings = readSettings();
    return !!settings.enableCodeExplorer && isCodeExplorerReady(ctx.appPath);
  },

  getConsentPreview: (args) => {
    let preview = `Explore code for "${args.query}"`;
    if (args.app_name) preview += ` (app: ${args.app_name})`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete || !args.query) return undefined;
    return `<dyad-explore-code ${buildExploreCodeAttributes(args)}>Exploring...</dyad-explore-code>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const result = await runCodeExplorer({
      appPath: targetAppPath,
      query: args.query,
      tsconfigPath: args.tsconfig_path,
      maxFiles: args.max_files ?? DEFAULT_MAX_FILES,
      maxDepth: args.max_depth ?? DEFAULT_MAX_DEPTH,
    });
    const resultText = formatExploreCodeResult(result);
    ctx.onXmlComplete(
      `<dyad-explore-code ${buildExploreCodeAttributes(args, result)}>\n${escapeXmlContent(resultText)}\n</dyad-explore-code>`,
    );
    return resultText;
  },
};
