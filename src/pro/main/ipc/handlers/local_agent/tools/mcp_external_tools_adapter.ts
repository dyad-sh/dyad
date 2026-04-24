/**
 * External MCP Servers → ToolDefinition Adapter
 *
 * For each enabled row in `mcpServers`, connect (lazily) and expose the
 * server's `tools/list` as `mcp_<serverId>_<toolName>` agent tools.
 *
 * NOTE: connection failures degrade gracefully — a server that's unreachable
 * simply contributes no tools rather than throwing.
 */

import { z } from "zod";
import log from "electron-log";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import type { ToolDefinition } from "./types";

const logger = log.scope("mcp_external_tools_adapter");

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
}

interface ExternalMcpToolDescriptor {
  name: string;
  description?: string;
}

/**
 * Re-read enabled MCP servers and aggregate their tool catalogs.
 * Not memoized: server enable/disable should reflect immediately.
 */
export async function getExternalMcpAgentTools(): Promise<ToolDefinition[]> {
  let rows: Array<{ id: number; name: string }>;
  try {
    rows = await db
      .select({ id: mcpServers.id, name: mcpServers.name })
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true));
  } catch (err) {
    logger.warn(`Could not enumerate mcpServers: ${err}`);
    return [];
  }

  const tools: ToolDefinition[] = [];

  for (const server of rows) {
    let client: Awaited<ReturnType<typeof mcpManager.getClient>>;
    try {
      client = await mcpManager.getClient(server.id);
    } catch (err) {
      logger.warn(`Skipping unreachable MCP server ${server.name}: ${err}`);
      continue;
    }

    let toolMap: Record<string, ExternalMcpToolDescriptor> = {};
    try {
      const anyClient = client as unknown as {
        tools?: () => Promise<Record<string, ExternalMcpToolDescriptor>>;
      };
      if (typeof anyClient.tools === "function") {
        toolMap = await anyClient.tools();
      }
    } catch (err) {
      logger.warn(`Failed to list tools for ${server.name}: ${err}`);
      continue;
    }

    for (const [toolName, descriptor] of Object.entries(toolMap)) {
      const fqName = `mcp_${server.id}_${sanitize(toolName)}`;
      tools.push({
        name: fqName,
        description:
          descriptor.description ??
          `External MCP tool \"${toolName}\" from server \"${server.name}\"`,
        inputSchema: z.record(z.unknown()),
        defaultConsent: "ask",
        getConsentPreview: (args) =>
          `${fqName}(${JSON.stringify(args).slice(0, 80)})`,
        execute: async (args) => {
          const anyClient = client as unknown as {
            callTool?: (name: string, args: unknown) => Promise<unknown>;
          };
          if (typeof anyClient.callTool !== "function") {
            throw new Error(`MCP client for server ${server.name} cannot invoke tools`);
          }
          const result = await anyClient.callTool(toolName, args);
          return typeof result === "string" ? result : JSON.stringify(result);
        },
      });
    }
  }

  logger.info(`External MCP adapter exposed ${tools.length} tool(s) from ${rows.length} server(s)`);
  return tools;
}

export async function getExternalMcpAgentToolNames(): Promise<string[]> {
  return (await getExternalMcpAgentTools()).map((t) => t.name);
}
