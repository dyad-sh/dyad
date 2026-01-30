import log from "electron-log";
import { db } from "../../db";
import { mcpServers, mcpToolConsents } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { createTypedHandler } from "./base";

import { resolveConsent } from "../utils/mcp_consent";
import { getStoredConsent } from "../utils/mcp_consent";
import { mcpManager } from "../utils/mcp_manager";
import {
  mcpContracts,
  type McpServer,
  type McpTransport,
  type McpConsentValue,
} from "../types/mcp";

const logger = log.scope("mcp_handlers");

// Helper to cast DB server to typed server
function toMcpServer(dbServer: typeof mcpServers.$inferSelect): McpServer {
  return {
    ...dbServer,
    transport: dbServer.transport as McpTransport,
  };
}

export function registerMcpHandlers() {
  // CRUD for MCP servers
  createTypedHandler(mcpContracts.listServers, async () => {
    const servers = await db.select().from(mcpServers);
    return servers.map(toMcpServer);
  });

  createTypedHandler(mcpContracts.createServer, async (_, params) => {
    const {
      name,
      transport,
      command,
      args,
      envJson,
      headersJson,
      url,
      enabled,
    } = params;
    // Handle args: can be string (JSON), array, or null/undefined
    const parsedArgs = args
      ? typeof args === "string"
        ? (JSON.parse(args) as string[])
        : args
      : null;
    // Handle envJson: can be string (JSON), object, or null/undefined
    const parsedEnvJson = envJson
      ? typeof envJson === "string"
        ? (JSON.parse(envJson) as Record<string, string>)
        : envJson
      : null;
    // Handle headersJson: can be string (JSON), object, or null/undefined
    const parsedHeadersJson = headersJson
      ? typeof headersJson === "string"
        ? (JSON.parse(headersJson) as Record<string, string>)
        : headersJson
      : null;
    const result = await db
      .insert(mcpServers)
      .values({
        name,
        transport,
        command: command || null,
        args: parsedArgs,
        envJson: parsedEnvJson,
        headersJson: parsedHeadersJson,
        url: url || null,
        enabled: !!enabled,
      })
      .returning();
    return toMcpServer(result[0]);
  });

  createTypedHandler(mcpContracts.updateServer, async (_, params) => {
    const update: any = {};
    if (params.name !== undefined) update.name = params.name;
    if (params.transport !== undefined) update.transport = params.transport;
    if (params.command !== undefined) update.command = params.command;
    if (params.args !== undefined)
      update.args = params.args
        ? typeof params.args === "string"
          ? JSON.parse(params.args)
          : params.args
        : null;
    if (params.cwd !== undefined) update.cwd = params.cwd;
    if (params.envJson !== undefined)
      update.envJson = params.envJson
        ? typeof params.envJson === "string"
          ? JSON.parse(params.envJson)
          : params.envJson
        : null;
    if (params.headersJson !== undefined)
      update.headersJson = params.headersJson
        ? typeof params.headersJson === "string"
          ? JSON.parse(params.headersJson)
          : params.headersJson
        : null;
    if (params.url !== undefined) update.url = params.url;
    if (params.enabled !== undefined) update.enabled = !!params.enabled;

    const result = await db
      .update(mcpServers)
      .set(update)
      .where(eq(mcpServers.id, params.id))
      .returning();
    // If server config changed, dispose cached client to be recreated on next use
    try {
      mcpManager.dispose(params.id);
    } catch {}
    return toMcpServer(result[0]);
  });

  createTypedHandler(mcpContracts.deleteServer, async (_, id) => {
    try {
      mcpManager.dispose(id);
    } catch {}
    await db.delete(mcpServers).where(eq(mcpServers.id, id));
    return { success: true };
  });

  // Tools listing (dynamic)
  createTypedHandler(mcpContracts.listTools, async (_, serverId) => {
    try {
      const client = await mcpManager.getClient(serverId);
      const remoteTools = await client.tools();
      const tools = await Promise.all(
        Object.entries(remoteTools).map(async ([name, mcpTool]) => ({
          name,
          description: mcpTool.description ?? null,
          consent: (await getStoredConsent(serverId, name)) as
            | McpConsentValue
            | undefined,
        })),
      );
      return tools;
    } catch (e) {
      logger.error("Failed to list tools", e);
      return [];
    }
  });

  // Consents
  createTypedHandler(mcpContracts.getToolConsents, async () => {
    const consents = await db.select().from(mcpToolConsents);
    return consents.map((c) => ({
      ...c,
      consent: c.consent as McpConsentValue,
    }));
  });

  createTypedHandler(mcpContracts.setToolConsent, async (_, params) => {
    const existing = await db
      .select()
      .from(mcpToolConsents)
      .where(
        and(
          eq(mcpToolConsents.serverId, params.serverId),
          eq(mcpToolConsents.toolName, params.toolName),
        ),
      );
    if (existing.length > 0) {
      const result = await db
        .update(mcpToolConsents)
        .set({ consent: params.consent })
        .where(
          and(
            eq(mcpToolConsents.serverId, params.serverId),
            eq(mcpToolConsents.toolName, params.toolName),
          ),
        )
        .returning();
      return {
        ...result[0],
        consent: result[0].consent as McpConsentValue,
      };
    } else {
      const result = await db
        .insert(mcpToolConsents)
        .values({
          serverId: params.serverId,
          toolName: params.toolName,
          consent: params.consent,
        })
        .returning();
      return {
        ...result[0],
        consent: result[0].consent as McpConsentValue,
      };
    }
  });

  // Tool consent request/response handshake
  // Receive consent response from renderer
  createTypedHandler(mcpContracts.respondToConsent, async (_, data) => {
    resolveConsent(data.requestId, data.decision);
  });

  logger.debug("Registered MCP IPC handlers");
}
