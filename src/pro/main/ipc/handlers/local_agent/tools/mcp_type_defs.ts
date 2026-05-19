import type { IpcMainInvokeEvent } from "electron";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import { mcpServers } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { AgentContext, escapeXmlAttr, escapeXmlContent } from "./types";

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
  /** Raw JSON Schema (or Zod) for the tool input. */
  inputSchema: unknown;
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
  for (const s of servers) {
    let toolSet: Record<string, any>;
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
      defs.push({
        jsName: toJsIdentifier(toolKey),
        toolKey,
        serverId: s.id,
        serverName: s.name || "",
        toolName,
        description: mcpTool.description,
        inputSchema: mcpTool.inputSchema,
      });
    }
  }
  return defs;
}

/**
 * Normalize various schema shapes (AI-SDK wrapped schema, Zod, raw JSON
 * Schema, or unknown) into a plain JSON Schema object. Returns an empty
 * object schema on failure.
 */
function toJsonSchema(input: unknown): Record<string, any> {
  if (!input || typeof input !== "object") {
    return { type: "object" };
  }

  // AI-SDK Schema wrapper: `{ [schemaSymbol]: true, jsonSchema: <schema>, validate }`.
  // The `jsonSchema` property is a getter that returns the underlying JSON
  // Schema (or the result of a thunk).
  const maybeWrapped = input as { jsonSchema?: unknown };
  if (maybeWrapped.jsonSchema && typeof maybeWrapped.jsonSchema === "object") {
    return maybeWrapped.jsonSchema as Record<string, any>;
  }

  return input as Record<string, any>;
}

/**
 * Convert a JSON Schema fragment to a TypeScript type string.
 * Handles the subset MCP tools commonly use.
 */
export function jsonSchemaToTs(schema: any, indent = 0): string {
  if (!schema || typeof schema !== "object") {
    return "unknown";
  }

  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map((s: any) => jsonSchemaToTs(s, indent)).join(" | ");
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((s: any) => jsonSchemaToTs(s, indent)).join(" | ");
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.map((s: any) => jsonSchemaToTs(s, indent)).join(" & ");
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum
      .map((v: unknown) =>
        typeof v === "string" ? JSON.stringify(v) : String(v),
      )
      .join(" | ");
  }
  if (schema.const !== undefined) {
    return typeof schema.const === "string"
      ? JSON.stringify(schema.const)
      : String(schema.const);
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    return type
      .map((t: string) => jsonSchemaToTs({ ...schema, type: t }, indent))
      .join(" | ");
  }

  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const items = schema.items
        ? jsonSchemaToTs(schema.items, indent)
        : "unknown";
      return `Array<${items}>`;
    }
    case "object":
    case undefined: {
      const props = schema.properties ?? {};
      const required: string[] = Array.isArray(schema.required)
        ? schema.required
        : [];
      const keys = Object.keys(props);
      if (keys.length === 0) {
        if (
          schema.additionalProperties &&
          schema.additionalProperties !== false
        ) {
          const ap =
            schema.additionalProperties === true
              ? "unknown"
              : jsonSchemaToTs(schema.additionalProperties, indent);
          return `Record<string, ${ap}>`;
        }
        return "{}";
      }
      const pad = "  ".repeat(indent + 1);
      const closePad = "  ".repeat(indent);
      const lines = keys.map((key) => {
        const optional = required.includes(key) ? "" : "?";
        const propSchema = props[key];
        const desc = propSchema?.description;
        const typeStr = jsonSchemaToTs(propSchema, indent + 1);
        const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
          ? key
          : JSON.stringify(key);
        const docLine = desc
          ? `${pad}/** ${String(desc).replace(/\*\//g, "*\\/")} */\n`
          : "";
        return `${docLine}${pad}${safeKey}${optional}: ${typeStr};`;
      });
      return `{\n${lines.join("\n")}\n${closePad}}`;
    }
    default:
      return "unknown";
  }
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

      const ok = await requireMcpToolConsent(params.event, {
        serverId: def.serverId,
        serverName: def.serverName,
        toolName: def.toolName,
        toolDescription: def.description,
        inputPreview,
        chatId: params.ctx.chatId,
      });
      if (!ok) {
        throw new Error(`User declined running tool ${def.toolKey}`);
      }

      const client = await mcpManager.getClient(def.serverId);
      const toolSet = await client.tools();
      const mcpTool = toolSet[def.toolName];
      if (!mcpTool || typeof mcpTool.execute !== "function") {
        throw new Error(`MCP tool ${def.toolKey} not found at runtime`);
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
        const resultStr = typeof res === "string" ? res : JSON.stringify(res);
        params.ctx.onXmlComplete(
          `<dyad-mcp-tool-result server="${escapeXmlAttr(def.serverName)}" tool="${escapeXmlAttr(def.toolName)}">\n${escapeXmlContent(resultStr)}\n</dyad-mcp-tool-result>`,
        );
        return res;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack =
          error instanceof Error && error.stack ? error.stack : "";
        params.ctx.onXmlComplete(
          `<dyad-output type="error" message="MCP tool '${def.toolKey}' failed: ${escapeXmlAttr(errorMessage)}">${escapeXmlContent(errorStack || errorMessage)}</dyad-output>`,
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
 */
export function buildMcpTypeDefsBlock(defs: McpToolDef[]): string {
  if (defs.length === 0) {
    return `${MCP_RESULT_TYPE}\n\n// No MCP servers enabled.`;
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
      const jsonSchema = toJsonSchema(def.inputSchema);
      const argsType = jsonSchemaToTs(jsonSchema, 0);
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
