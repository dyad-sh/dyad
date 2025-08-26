import { ipcMain, IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { db } from "../../db";
import { mcpServers, mcpTools, mcpToolConsents } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { createLoggedHandler } from "./safe_handle";

import { resolveConsent } from "../utils/mcp_consent";
import { mcpManager } from "../utils/mcp_manager";

const logger = log.scope("mcp_handlers");
const handle = createLoggedHandler(logger);

type ConsentDecision = "accept-once" | "accept-always" | "decline";

interface ToolConsentRequestPayload {
  requestId: string;
  serverId: number;
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputPreview?: string | null;
}

export function registerMcpHandlers() {
  // CRUD for MCP servers
  handle("mcp:list-servers", async () => {
    return await db.select().from(mcpServers);
  });

  handle(
    "mcp:create-server",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        name: string;
        transport: string;
        command?: string | null;
        args?: string[] | null;
        cwd?: string | null;
        env?: Record<string, string> | null;
        url?: string | null;
        enabled?: boolean;
      },
    ) => {
      const { name, transport, command, args, cwd, env, url, enabled } = params;
      const result = await db
        .insert(mcpServers)
        .values({
          name,
          transport,
          command: command || null,
          args: args ? JSON.stringify(args) : null,
          cwd: cwd || null,
          envJson: env ? JSON.stringify(env) : null,
          url: url || null,
          enabled: !!enabled,
        })
        .returning();
      return result[0];
    },
  );

  handle(
    "mcp:update-server",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        id: number;
        name?: string;
        transport?: string;
        command?: string | null;
        args?: string[] | null;
        cwd?: string | null;
        env?: Record<string, string> | null;
        url?: string | null;
        enabled?: boolean;
      },
    ) => {
      const update: any = {};
      if (params.name !== undefined) update.name = params.name;
      if (params.transport !== undefined) update.transport = params.transport;
      if (params.command !== undefined) update.command = params.command;
      if (params.args !== undefined)
        update.args = params.args ? JSON.stringify(params.args) : null;
      if (params.cwd !== undefined) update.cwd = params.cwd;
      if (params.env !== undefined)
        update.envJson = params.env ? JSON.stringify(params.env) : null;
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

  // Tools listing and activation
  handle(
    "mcp:list-tools",
    async (_event: IpcMainInvokeEvent, serverId: number) => {
      // Try to refresh tool list from server if stdio
      try {
        const client = await mcpManager.getClient(serverId);
        const remoteTools = await client.listTools();
        if (remoteTools?.length) {
          await Promise.all(
            remoteTools.map(async (rt) => {
              const exists = await db
                .select()
                .from(mcpTools)
                .where(
                  and(
                    eq(mcpTools.serverId, serverId),
                    eq(mcpTools.name, rt.name),
                  ),
                );
              if (exists.length === 0) {
                await db.insert(mcpTools).values({
                  serverId,
                  name: rt.name,
                  description: rt.description ?? null,
                  isActive: false,
                });
              } else if (exists[0].description !== (rt.description ?? null)) {
                await db
                  .update(mcpTools)
                  .set({ description: rt.description ?? null })
                  .where(
                    and(
                      eq(mcpTools.serverId, serverId),
                      eq(mcpTools.name, rt.name),
                    ),
                  );
              }
            }),
          );
        }
      } catch (e) {
        logger.error("Failed to list tools", e);
      }
      return await db
        .select()
        .from(mcpTools)
        .where(eq(mcpTools.serverId, serverId));
    },
  );

  handle(
    "mcp:upsert-tools",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        serverId: number;
        tools: { name: string; description?: string }[];
      },
    ) => {
      const existing = await db
        .select()
        .from(mcpTools)
        .where(eq(mcpTools.serverId, params.serverId));
      const existingByName = new Map(existing.map((t) => [t.name, t]));
      const results: any[] = [];
      for (const t of params.tools) {
        const found = existingByName.get(t.name);
        if (found) {
          const updated = await db
            .update(mcpTools)
            .set({ description: t.description ?? found.description })
            .where(
              and(
                eq(mcpTools.serverId, params.serverId),
                eq(mcpTools.name, t.name),
              ),
            )
            .returning();
          results.push(updated[0]);
        } else {
          const inserted = await db
            .insert(mcpTools)
            .values({
              serverId: params.serverId,
              name: t.name,
              description: t.description ?? null,
              isActive: false,
            })
            .returning();
          results.push(inserted[0]);
        }
      }
      return results;
    },
  );

  handle(
    "mcp:set-tool-active",
    async (
      _event: IpcMainInvokeEvent,
      params: { serverId: number; toolName: string; isActive: boolean },
    ) => {
      const result = await db
        .update(mcpTools)
        .set({ isActive: params.isActive })
        .where(
          and(
            eq(mcpTools.serverId, params.serverId),
            eq(mcpTools.name, params.toolName),
          ),
        )
        .returning();
      return result[0];
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
  ipcMain.on(
    /mcp:tool-consent-response:(.*)/ as unknown as any,
    (_event, data: { requestId: string; decision: ConsentDecision }) => {
      resolveConsent(data.requestId, data.decision);
    },
  );
}
