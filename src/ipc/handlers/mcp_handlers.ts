import { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { db } from "../../db";
import { mcpServers, mcpToolConsents } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { createLoggedHandler } from "./safe_handle";

import { resolveConsent } from "../utils/mcp_consent";
import { getStoredConsent } from "../utils/mcp_consent";
import { mcpManager } from "../utils/mcp_manager";
import { CreateMcpServer, McpServerUpdate, McpTool } from "../ipc_types";

const logger = log.scope("mcp_handlers");
const handle = createLoggedHandler(logger);

type ConsentDecision = "accept-once" | "accept-always" | "decline";

export function registerMcpHandlers() {
  // CRUD for MCP servers
  handle("mcp:list-servers", async () => {
    return await db.select().from(mcpServers);
  });

  handle(
    "mcp:create-server",
    async (_event: IpcMainInvokeEvent, params: CreateMcpServer) => {
      const { name, transport, command, args, envJson, url, enabled } = params;
      const result = await db
        .insert(mcpServers)
        .values({
          name,
          transport,
          command: command || null,
          args: args || null,
          envJson: envJson || null,
          url: url || null,
          enabled: !!enabled,
        })
        .returning();
      return result[0];
    },
  );

  handle(
    "mcp:update-server",
    async (_event: IpcMainInvokeEvent, params: McpServerUpdate) => {
      const update: any = {};
      if (params.name !== undefined) update.name = params.name;
      if (params.transport !== undefined) update.transport = params.transport;
      if (params.command !== undefined) update.command = params.command;
      if (params.args !== undefined) update.args = params.args || null;
      if (params.cwd !== undefined) update.cwd = params.cwd;
      if (params.envJson !== undefined) update.envJson = params.envJson || null;
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
      return result[0];
    },
  );

  handle(
    "mcp:delete-server",
    async (_event: IpcMainInvokeEvent, id: number) => {
      try {
        mcpManager.dispose(id);
      } catch {}
      await db.delete(mcpServers).where(eq(mcpServers.id, id));
      return { success: true };
    },
  );

  // Tools listing (dynamic)
  handle(
    "mcp:list-tools",
    async (
      _event: IpcMainInvokeEvent,
      serverId: number,
    ): Promise<McpTool[]> => {
      try {
        const client = await mcpManager.getClient(serverId);
        const remoteTools = await client.tools();
        const tools = await Promise.all(
          Object.entries(remoteTools).map(async ([name, tool]) => ({
            name,
            description: tool.description ?? null,
            consent: await getStoredConsent(serverId, name),
          })),
        );
        return tools;
      } catch (e) {
        logger.error("Failed to list tools", e);
        return [];
      }
    },
  );
  // Consents
  handle("mcp:get-tool-consents", async () => {
    return await db.select().from(mcpToolConsents);
  });

  handle(
    "mcp:set-tool-consent",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        serverId: number;
        toolName: string;
        consent: "ask" | "always" | "denied";
      },
    ) => {
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
        return result[0];
      } else {
        const result = await db
          .insert(mcpToolConsents)
          .values({
            serverId: params.serverId,
            toolName: params.toolName,
            consent: params.consent,
          })
          .returning();
        return result[0];
      }
    },
  );

  // Tool consent request/response handshake
  // Receive consent response from renderer
  handle(
    "mcp:tool-consent-response",
    async (_event, data: { requestId: string; decision: ConsentDecision }) => {
      resolveConsent(data.requestId, data.decision);
    },
  );
}
