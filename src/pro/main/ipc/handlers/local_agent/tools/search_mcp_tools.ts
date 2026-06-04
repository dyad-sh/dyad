import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { buildMcpTypeDefsBlock, type McpToolDef } from "./mcp_type_defs";
import { bm25Ranker, type ToolRanker } from "./bm25";
import { sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";
import { readSettings } from "@/main/settings";

/**
 * Number of matching tools whose full TypeScript declarations are returned.
 * Kept small on purpose: the point of search is to keep context lean. The
 * model can refine its query (or pass a `server`) to reach the rest.
 */
const MAX_RESULTS = 5;

const searchMcpToolsSchema = z.object({
  query: z
    .string()
    .describe(
      "Keywords describing the MCP tool you need (e.g. 'create github issue', 'send slack message').",
    ),
  server: z
    .string()
    .optional()
    .describe(
      "Optional. Restrict the search to a single MCP server by name. Omit to search across all enabled servers.",
    ),
});

type SearchMcpToolsArgs = z.infer<typeof searchMcpToolsSchema>;

function matchesServer(def: McpToolDef, server: string): boolean {
  const a = def.serverName ?? "";
  return (
    a.toLowerCase() === server.toLowerCase() ||
    sanitizeMcpName(a) === sanitizeMcpName(server)
  );
}

function uniqueServerNames(defs: McpToolDef[]): string[] {
  return [...new Set(defs.map((d) => d.serverName).filter(Boolean))];
}

function buildSearchAttributes(args: Partial<SearchMcpToolsArgs>): string {
  const queryAttr = args.query ? ` query="${escapeXmlAttr(args.query)}"` : "";
  const serverAttr = args.server
    ? ` server="${escapeXmlAttr(args.server)}"`
    : "";
  return `${queryAttr}${serverAttr}`;
}

/**
 * Discover MCP tools by keyword instead of listing every tool in the prompt.
 * Returns the TypeScript `declare function` block (same shape used inside
 * `execute_sandbox_script`) for the best matches, which the model then calls
 * as host functions from a sandbox script.
 *
 * Only registered when MCP-in-sandbox is active for the turn AND the
 * `enableMcpToolSearch` experiment is on (see `isEnabled`). When off, the
 * full type-defs block is embedded in `execute_sandbox_script` as before and
 * this tool is absent.
 */
export const searchMcpToolsTool: ToolDefinition<SearchMcpToolsArgs> = {
  name: "search_mcp_tools",
  description:
    "Search for MCP tools by keyword and get their TypeScript signatures. " +
    "Use this before calling an MCP tool from execute_sandbox_script: search " +
    "for what you need, then call the returned host functions inside a script. " +
    "Pass `server` to restrict the search to one MCP server.",
  inputSchema: searchMcpToolsSchema,
  defaultConsent: "always",

  // ctx.mcpToolsEnabled is derived from shouldIncludeTool(executeSandboxScriptTool),
  // so it already implies sandbox-script execution is on this turn. Only the
  // experiment flag needs a separate check here.
  isEnabled: (ctx) =>
    !!ctx.mcpToolsEnabled && !!readSettings().enableMcpToolSearch,

  getConsentPreview: (args) =>
    args.server
      ? `Search MCP tools for "${args.query}" (server: ${args.server})`
      : `Search MCP tools for "${args.query}"`,

  buildXml: (args, isComplete) => {
    if (!args.query) return undefined;
    if (isComplete) return undefined;
    return `<dyad-mcp-tool-search${buildSearchAttributes(args)}>Searching...`;
  },

  execute: async (args: SearchMcpToolsArgs, ctx: AgentContext) => {
    const finish = (result: string) => {
      ctx.onXmlComplete(
        `<dyad-mcp-tool-search${buildSearchAttributes(args)}>${escapeXmlContent(result)}</dyad-mcp-tool-search>`,
      );
      return result;
    };

    // The handler populates `ctx.mcpToolDefs` with the same defs used to build
    // the sandbox capability map. If it's missing, the sandbox has no MCP host
    // functions this turn, so returning declarations here would point the model
    // at functions it can't call. Surface that instead of guessing.
    if (ctx.mcpToolDefs === undefined) {
      return finish("MCP tools are temporarily unavailable. Try again.");
    }
    const allDefs = ctx.mcpToolDefs;

    const scoped = args.server
      ? allDefs.filter((d) => matchesServer(d, args.server!))
      : allDefs;

    if (scoped.length === 0) {
      const servers = uniqueServerNames(allDefs);
      const hint =
        args.server && servers.length > 0
          ? ` No MCP server named "${args.server}". Available servers: ${servers.join(", ")}.`
          : servers.length > 0
            ? ` Available servers: ${servers.join(", ")}.`
            : " No MCP servers are enabled.";
      return finish(`No MCP tools available to search.${hint}`);
    }

    const ranker: ToolRanker = bm25Ranker;
    const ranked = ranker(args.query, scoped);

    if (ranked.length === 0) {
      const servers = uniqueServerNames(scoped);
      return finish(
        `No MCP tools matched "${args.query}". Try different keywords. ` +
          `Searched ${scoped.length} tool(s) across: ${servers.join(", ")}.`,
      );
    }

    const top = ranked.slice(0, MAX_RESULTS).map((r) => r.def);
    const block = buildMcpTypeDefsBlock(top);
    const remaining = ranked.length - top.length;
    const footer =
      remaining > 0
        ? `\n\n// ${remaining} more tool(s) matched "${args.query}". Refine the query or pass \`server\` to narrow.`
        : "";

    return finish(
      `Top ${top.length} MCP tool(s) for "${args.query}". Call these as host functions inside execute_sandbox_script:\n\n${block}${footer}`,
    );
  },
};
