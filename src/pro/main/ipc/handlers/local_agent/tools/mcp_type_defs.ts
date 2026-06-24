import type { IpcMainInvokeEvent } from "electron";
import { asSchema } from "@ai-sdk/provider-utils";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { MCPClient } from "@ai-sdk/mcp";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import { SANDBOX_HOST_CALL_NAMES } from "@/ipc/utils/sandbox/capabilities";
import { mcpServers } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { AgentContext, escapeXmlAttr, escapeXmlContent } from "./types";
import { jsonSchemaToTs } from "./json_schema_to_ts";
import { buildMcpAutoApprove } from "../mcp_auto_consent";

const MCP_RESULT_TYPE = `type McpResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: unknown }
  >;
  isError?: boolean;
};`;

export interface McpToolDef {
  /** JS-safe function identifier exposed inside sandbox. */
  jsName: string;
  /** Original MCP tool key (serverName__toolName, matching getMcpTools). */
  toolKey: string;
  serverId: number;
  serverName: string;
  toolName: string;
  description?: string;
  /** Tool input schema, normalized to JSON Schema at collection time. */
  inputSchema: JSONSchema7;
}

/**
 * Convert sanitized MCP tool key to a JS-safe identifier.
 * MCP keys allow hyphens; JS identifiers do not.
 */
function toJsIdentifier(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_$]/g, "_");
  if (/^[0-9]/.test(id)) {
    id = `_${id}`;
  }
  return id;
}

export async function collectMcpToolDefs(): Promise<McpToolDef[]> {
  let servers: { id: number; name: string | null }[] = [];
  try {
    servers = (await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true as any))) as typeof servers;
  } catch {
    return [];
  }

  const defs: McpToolDef[] = [];
  // `toJsIdentifier` replaces any character outside [A-Za-z0-9_$] with `_`,
  // which is not one-to-one — two distinct tool keys (e.g. `srv-foo__t` and
  // `srv_foo__t`) can collapse to the same JS identifier. Disambiguate by
  // appending a numeric suffix on collision so each MCP tool maps to a
  // unique sandbox capability.
  //
  // Seeded with the built-in file host fns so an MCP tool whose
  // sanitized name happens to match (e.g. `read_file`) is renamed
  // rather than silently shadowing the file capability when the two
  // maps are merged.
  const seenJsNames = new Set<string>(SANDBOX_HOST_CALL_NAMES);
  for (const s of servers) {
    let toolSet: Awaited<ReturnType<MCPClient["tools"]>>;
    try {
      const client = await mcpManager.getClient(s.id);
      toolSet = await client.tools();
    } catch {
      continue;
    }
    const serverNameSanitized = sanitizeMcpName(s.name || "");
    for (const [toolName, mcpTool] of Object.entries(toolSet)) {
      const sanitizedToolName = sanitizeMcpName(toolName);
      const toolKey = `${serverNameSanitized}__${sanitizedToolName}`;
      const baseJsName = toJsIdentifier(toolKey);
      let jsName = baseJsName;
      let suffix = 2;
      while (seenJsNames.has(jsName)) {
        jsName = `${baseJsName}_${suffix}`;
        suffix += 1;
      }
      seenJsNames.add(jsName);
      let inputSchema: JSONSchema7;
      try {
        inputSchema = await asSchema(mcpTool.inputSchema).jsonSchema;
      } catch {
        inputSchema = {
          type: "object",
          properties: {},
          additionalProperties: false,
        };
      }
      defs.push({
        jsName,
        toolKey,
        serverId: s.id,
        serverName: s.name || "",
        toolName,
        description: mcpTool.description,
        inputSchema,
      });
    }
  }
  return defs;
}

/**
 * Build the capability map exposed to MustardScript for MCP tool calls.
 * Each entry wraps an MCP tool with consent enforcement and XML emission to
 * the UI, mirroring the behavior of individually-registered MCP tools.
 */
export function buildMcpCapabilityMap(params: {
  event: IpcMainInvokeEvent;
  ctx: AgentContext;
  defs: McpToolDef[];
}): Record<string, (...args: unknown[]) => unknown> {
  const map: Record<string, (...args: unknown[]) => unknown> = {};

  for (const def of params.defs) {
    map[def.jsName] = async (rawArgs: unknown) => {
      const args = rawArgs ?? {};
      const inputPreview =
        typeof args === "string"
          ? args
          : Array.isArray(args)
            ? args.join(" ")
            : JSON.stringify(args).slice(0, 500);

      const autoApprove = buildMcpAutoApprove({
        settings: readSettings(),
        isDyadPro: params.ctx.isDyadPro,
        chatId: params.ctx.chatId,
        serverName: def.serverName,
        toolName: def.toolName,
        toolDescription: def.description,
        inputSchema: def.inputSchema,
        args,
      });

      const ok = await requireMcpToolConsent(params.event, {
        serverId: def.serverId,
        serverName: def.serverName,
        toolName: def.toolName,
        toolDescription: def.description,
        inputPreview,
        chatId: params.ctx.chatId,
        autoApprove,
      });
      if (!ok) {
        throw new DyadError(
          `User declined running tool ${def.toolKey}`,
          DyadErrorKind.UserCancelled,
        );
      }

      const client = await mcpManager.getClient(def.serverId);
      const toolSet = await client.tools();
      const mcpTool = toolSet[def.toolName];
      if (!mcpTool || typeof mcpTool.execute !== "function") {
        throw new DyadError(
          `MCP tool ${def.toolKey} not found at runtime`,
          DyadErrorKind.NotFound,
        );
      }

      const contentPretty = JSON.stringify(args, null, 2);
      params.ctx.onXmlComplete(
        `<dyad-mcp-tool-call server="${escapeXmlAttr(def.serverName)}" tool="${escapeXmlAttr(def.toolName)}">\n${escapeXmlContent(contentPretty)}\n</dyad-mcp-tool-call>`,
      );

      try {
        const res = await mcpTool.execute(args, {
          toolCallId: `mcp-sandbox-${def.toolKey}`,
          messages: [],
        });
        // The SDK sometimes returns a plain string for text-only MCP
        // tools. Wrap it into the McpResult shape we advertise in the
        // declarations so scripts can rely on `.content` regardless.
        const normalized =
          typeof res === "string"
            ? { content: [{ type: "text", text: res }] }
            : res;
        const resultStr = typeof res === "string" ? res : JSON.stringify(res);
        params.ctx.onXmlComplete(
          `<dyad-mcp-tool-result server="${escapeXmlAttr(def.serverName)}" tool="${escapeXmlAttr(def.toolName)}">\n${escapeXmlContent(resultStr)}\n</dyad-mcp-tool-result>`,
        );
        return normalized;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack =
          error instanceof Error && error.stack ? error.stack : "";
        params.ctx.onXmlComplete(
          `<dyad-output type="error" message="MCP tool '${escapeXmlAttr(def.toolKey)}' failed: ${escapeXmlAttr(errorMessage)}">${escapeXmlContent(errorStack || errorMessage)}</dyad-output>`,
        );
        throw error;
      }
    };
  }

  return map;
}

/**
 * Build the full TypeScript declaration block describing all MCP tools
 * exposed inside the sandbox. Injected into the `execute` tool description.
 * Returns an empty string when `defs` is empty; callers should skip
 * emitting the MCP section entirely in that case.
 */
export function buildMcpTypeDefsBlock(defs: McpToolDef[]): string {
  if (defs.length === 0) {
    return "";
  }

  const byServer = new Map<string, McpToolDef[]>();
  for (const d of defs) {
    const list = byServer.get(d.serverName) ?? [];
    list.push(d);
    byServer.set(d.serverName, list);
  }

  const sections: string[] = [MCP_RESULT_TYPE, ""];
  for (const [serverName, list] of byServer) {
    sections.push(`// ---- Server: ${serverName} ----`);
    for (const def of list) {
      const argsType = jsonSchemaToTs(def.inputSchema, 0);
      if (def.description) {
        const oneLine = def.description.replace(/\s+/g, " ").trim();
        sections.push(`/** ${oneLine.replace(/\*\//g, "*\\/")} */`);
      }
      sections.push(
        `declare function ${def.jsName}(args: ${argsType}): Promise<McpResult>;`,
      );
      sections.push("");
    }
  }

  return sections.join("\n");
}
