import log from "electron-log";
import { db } from "../../db";
import { mcpServers, mcpToolConsents } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { createTypedHandler } from "./base";

import { resolveConsent } from "../utils/mcp_consent";
import { getStoredConsent } from "../utils/mcp_consent";
import { mcpManager } from "../utils/mcp_manager";
import { disconnectOAuth, runOAuthFlow } from "../utils/mcp_oauth_flow";
import {
  encryptToString,
  oauthStateHasTokens,
} from "../utils/mcp_oauth_provider";
import {
  mcpContracts,
  type McpServer,
  type McpTransport,
  type McpConsentValue,
} from "../types/mcp";

const logger = log.scope("mcp_handlers");

// Parse a JSON string from the renderer and surface a clear error
// instead of letting the main process see a raw SyntaxError. Returns
// `null` if the input is falsy.
function parseJsonField<T>(
  value: string | null | undefined,
  field: string,
): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON for "${field}": ${message}`);
  }
}

// Convert a DB row into the shape sent to the UI. Drops the encrypted
// `oauthState` / `oauthClientSecret`; sends `oauthConnected` instead.
function toMcpServer(dbServer: typeof mcpServers.$inferSelect): McpServer {
  return {
    id: dbServer.id,
    name: dbServer.name,
    transport: dbServer.transport as McpTransport,
    command: dbServer.command,
    args: dbServer.args,
    envJson: dbServer.envJson,
    headersJson: dbServer.headersJson,
    url: dbServer.url,
    enabled: dbServer.enabled,
    oauthEnabled: dbServer.oauthEnabled,
    // `oauthState` being set isn't enough -- it can hold just a
    // registered client ID before any tokens exist.
    // `oauthStateHasTokens` checks for a real access token.
    oauthConnected: oauthStateHasTokens(dbServer.oauthState),
    createdAt: dbServer.createdAt,
    updatedAt: dbServer.updatedAt,
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
      oauthEnabled,
      oauthClientId,
      oauthClientSecret,
      oauthScope,
    } = params;
    // Handle args: can be string (JSON), array, or null/undefined
    const parsedArgs =
      typeof args === "string"
        ? parseJsonField<string[]>(args, "args")
        : (args ?? null);
    // Handle envJson: can be string (JSON), object, or null/undefined
    const parsedEnvJson =
      typeof envJson === "string"
        ? parseJsonField<Record<string, string>>(envJson, "envJson")
        : (envJson ?? null);
    // Handle headersJson: can be string (JSON), object, or null/undefined
    const parsedHeadersJson =
      typeof headersJson === "string"
        ? parseJsonField<Record<string, string>>(headersJson, "headersJson")
        : (headersJson ?? null);
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
        oauthEnabled: !!oauthEnabled,
        oauthClientId: oauthClientId ?? null,
        oauthClientSecret: oauthClientSecret
          ? encryptToString(oauthClientSecret)
          : null,
        oauthScope: oauthScope ?? null,
      })
      .returning();
    return toMcpServer(result[0]);
  });

  createTypedHandler(mcpContracts.updateServer, async (_, params) => {
    const update: Partial<typeof mcpServers.$inferInsert> = {};
    if (params.name !== undefined) update.name = params.name;
    if (params.transport !== undefined) update.transport = params.transport;
    if (params.command !== undefined) update.command = params.command;
    if (params.args !== undefined)
      update.args = parseJsonField<string[]>(params.args, "args");
    if (params.envJson !== undefined)
      update.envJson =
        typeof params.envJson === "string"
          ? parseJsonField<Record<string, string>>(params.envJson, "envJson")
          : (params.envJson ?? null);
    if (params.headersJson !== undefined)
      update.headersJson =
        typeof params.headersJson === "string"
          ? parseJsonField<Record<string, string>>(
              params.headersJson,
              "headersJson",
            )
          : (params.headersJson ?? null);
    if (params.url !== undefined) update.url = params.url;
    if (params.enabled !== undefined) update.enabled = !!params.enabled;

    const result = await db
      .update(mcpServers)
      .set(update)
      .where(eq(mcpServers.id, params.id))
      .returning();
    if (!result[0]) throw new Error(`MCP server not found: ${params.id}`);
    // Config may have changed; dispose the cached client so the next
    // use rebuilds the transport with the updated row.
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
    // Bounded wait per server: the renderer waits for every server's
    // listTools to settle before rendering, so one hung server (often
    // an unconnected OAuth-gated host) would otherwise freeze the
    // whole tools list. This ceiling caps the worst case.
    const LIST_TOOLS_TIMEOUT_MS = 8_000;
    try {
      const result = await Promise.race([
        (async () => {
          const client = await mcpManager.getClient(serverId);
          const remoteTools = await client.tools();
          return Promise.all(
            Object.entries(remoteTools).map(async ([name, mcpTool]) => ({
              name,
              description: mcpTool.description ?? null,
              consent: (await getStoredConsent(serverId, name)) as
                | McpConsentValue
                | undefined,
            })),
          );
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Timed out after ${LIST_TOOLS_TIMEOUT_MS / 1000}s waiting for tools from server ${serverId}.`,
                ),
              ),
            LIST_TOOLS_TIMEOUT_MS,
          ),
        ),
      ]);
      return result;
    } catch (e) {
      logger.error(
        `Failed to list tools for server ${serverId}: ${
          e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        }`,
      );
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

  // OAuth: kick off the full flow against the named MCP server. The
  // main-process loopback listener captures the redirect, the
  // `@ai-sdk/mcp` `auth()` function drives PKCE + token exchange, and
  // tokens land in the encrypted `oauth_state` column.
  createTypedHandler(mcpContracts.startOAuth, async (_, params) => {
    return await runOAuthFlow({ serverId: params.serverId });
  });

  // OAuth disconnect: clear stored tokens + client info. Forces the
  // next tool call to require a fresh consent flow.
  createTypedHandler(mcpContracts.disconnectOAuth, async (_, serverId) => {
    return await disconnectOAuth(serverId);
  });

  logger.debug("Registered MCP IPC handlers");
}
