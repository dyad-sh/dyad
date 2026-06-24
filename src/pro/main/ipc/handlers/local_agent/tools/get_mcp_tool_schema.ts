import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { buildMcpTypeDefsBlock, resolveMcpToolDefs } from "./mcp_type_defs";
import { readSettings } from "@/main/settings";

const getMcpToolSchemaSchema = z.object({
  tools: z
    .array(z.string())
    .min(1)
    .describe(
      "Names of the MCP tools to fetch full TypeScript signatures for, as " +
        "listed in execute_sandbox_script (e.g. ['github__issue_write']).",
    ),
});

type GetMcpToolSchemaArgs = z.infer<typeof getMcpToolSchemaSchema>;

/**
 * Return the description and full TypeScript `declare function` signature
 * (input schema included) for named MCP tools. The search-mode
 * `execute_sandbox_script` description lists every tool by name only; the
 * model calls this to get the details of the tool(s) it intends to use before
 * calling them as host functions. `search_mcp_tools` remains available for
 * when the name list isn't enough to know which tool fits.
 *
 * Only registered when MCP-in-sandbox is active AND the `enableMcpToolSearch`
 * setting is on (the same setting that lists tool names and registers
 * `search_mcp_tools`).
 */
export const getMcpToolSchemaTool: ToolDefinition<GetMcpToolSchemaArgs> = {
  name: "get_mcp_tool_schema",
  description:
    "Get the description and full TypeScript signature of MCP tools by name. " +
    "The MCP tools listed in execute_sandbox_script show only names; call " +
    "this to get a tool's description and input schema before calling it as " +
    "a host function inside a script. If a name is shared by tools on more " +
    "than one server, the signatures for all of them are returned.",
  inputSchema: getMcpToolSchemaSchema,
  defaultConsent: "always",

  // ctx.mcpToolsEnabled already implies sandbox-script execution is on, so only
  // the setting flag needs a separate check.
  isEnabled: (ctx) =>
    !!ctx.mcpToolsEnabled && !!readSettings().enableMcpToolSearch,

  getConsentPreview: (args) =>
    `Get schema for MCP tool(s): ${args.tools.join(", ")}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    // buildXml runs on partial, unvalidated args mid-stream; `tools` may not be
    // an array yet, so guard before joining.
    const tools = Array.isArray(args.tools) ? args.tools : [];
    if (tools.length === 0) return undefined;
    return `<dyad-mcp-tool-schema tools="${escapeXmlAttr(tools.join(", "))}">Loading...`;
  },

  execute: async (args: GetMcpToolSchemaArgs, ctx: AgentContext) => {
    const finish = (result: string) => {
      ctx.onXmlComplete(
        `<dyad-mcp-tool-schema tools="${escapeXmlAttr(args.tools.join(", "))}">${escapeXmlContent(result)}</dyad-mcp-tool-schema>`,
      );
      return result;
    };

    // No defs means the handler's collection failed and the sandbox has no MCP
    // host functions this turn, so don't hand the model tools it can't call.
    if (ctx.mcpToolDefs === undefined) {
      return finish("MCP tools are temporarily unavailable. Try again.");
    }

    const { found, missing } = resolveMcpToolDefs(ctx.mcpToolDefs, args.tools);

    if (found.length === 0) {
      return finish(
        `No MCP tool matched [${args.tools.join(", ")}]. Use the names exactly ` +
          `as listed in execute_sandbox_script, or search_mcp_tools to find one.`,
      );
    }

    const block = buildMcpTypeDefsBlock(found);
    const missingNote =
      missing.length > 0 ? `\n\n// No match for: ${missing.join(", ")}` : "";

    return finish(
      `Signature(s) for ${found.length} MCP tool(s). Call these as host ` +
        `functions inside execute_sandbox_script:\n\n${block}${missingNote}`,
    );
  },
};
