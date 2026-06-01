import log from "electron-log";
import { db } from "../../db";
import { mcpServers, mcpToolConsents } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { DyadError, DyadErrorKind } from "../../errors/dyad_error";

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
  DEFAULT_OAUTH_CALLBACK_PORT,
  type McpServer,
  type McpTransport,
  type McpConsentValue,
} from "../types/mcp";
import { findAvailablePort } from "../utils/port_utils";
import net from "node:net";
import { safeStorage } from "electron";
import {
  classifyOAuthError,
  looksLikeUnauthorized,
} from "./mcp_error_classifiers";

const logger = log.scope("mcp_handlers");

// EADDRINUSE on either stack disqualifies the port; a stack that's
// unavailable system-wide (e.g. IPv6 disabled) is OK if the other is
// free.
async function isPortFreeOnBothLoopbacks(port: number): Promise<boolean> {
  const probeOne = (host: string): Promise<"free" | "in_use" | "other"> =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", (err: NodeJS.ErrnoException) => {
        s.close(() => undefined);
        resolve(err.code === "EADDRINUSE" ? "in_use" : "other");
      });
      s.once("listening", () => {
        s.close(() => resolve("free"));
      });
      s.listen(port, host);
    });
  const [v4, v6] = await Promise.all([probeOne("127.0.0.1"), probeOne("::1")]);
  if (v4 === "in_use" || v6 === "in_use") return false;
  return v4 === "free" || v6 === "free";
}

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
    throw new DyadError(
      `Invalid JSON for "${field}": ${message}`,
      DyadErrorKind.Validation,
    );
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
    oauthCallbackPort: dbServer.oauthCallbackPort,
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
      oauthCallbackPort,
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
        // OAuth only applies to HTTP transport.
        oauthEnabled: transport === "http" ? !!oauthEnabled : false,
        oauthClientId: oauthClientId ?? null,
        oauthClientSecret: oauthClientSecret
          ? encryptToString(oauthClientSecret)
          : null,
        oauthScope: oauthScope ?? null,
        oauthCallbackPort:
          typeof oauthCallbackPort === "number" ? oauthCallbackPort : null,
      })
      .returning();
    if (!result[0])
      throw new DyadError(
        "Failed to create MCP server.",
        DyadErrorKind.Internal,
      );
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
    if (params.oauthEnabled !== undefined) {
      update.oauthEnabled = !!params.oauthEnabled;
      // Scrub OAuth columns so a stale client secret / token blob
      // doesn't linger without a UI to clear it. An in-flight loopback
      // listener for this server frees its port when the flow times
      // out, so there's nothing to cancel here.
      if (!params.oauthEnabled) {
        update.oauthState = null;
        update.oauthClientId = null;
        update.oauthClientSecret = null;
        update.oauthScope = null;
        update.oauthCallbackPort = null;
      }
    }

    const result = await db
      .update(mcpServers)
      .set(update)
      .where(eq(mcpServers.id, params.id))
      .returning();
    if (!result[0])
      throw new DyadError(
        `MCP server not found: ${params.id}`,
        DyadErrorKind.NotFound,
      );
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
    // Caps a hung server (often unconnected OAuth) so it doesn't
    // freeze the whole tools list.
    const LIST_TOOLS_TIMEOUT_MS = 8_000;
    // Cleared after the race so a late reject stays unobserved.
    let timeoutId: NodeJS.Timeout | undefined;
    // Swallow a late `mainOp` reject after the timeout wins.
    const mainOp = (async () => {
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
      return { tools, status: "ok" as const };
    })();
    mainOp.catch(() => undefined);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new Error(
              `Timed out after ${LIST_TOOLS_TIMEOUT_MS / 1000}s waiting for tools from server ${serverId}.`,
            ),
          ),
        LIST_TOOLS_TIMEOUT_MS,
      );
    });
    // Same guard for a late timeout reject after the race resolves.
    timeoutPromise.catch(() => undefined);
    try {
      const result = await Promise.race([mainOp, timeoutPromise]);
      clearTimeout(timeoutId);
      return result;
    } catch (e) {
      clearTimeout(timeoutId);
      // Tear down the cached client so a hung transport doesn't leak
      // an FD on every subsequent poll.
      try {
        mcpManager.dispose(serverId);
      } catch {}
      const message =
        e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      logger.error(`Failed to list tools for server ${serverId}: ${message}`);
      // Report a 401 so the UI can persistently flag a server that
      // needs auth; everything else is a generic error.
      const status = looksLikeUnauthorized(message) ? "unauthorized" : "error";
      return { tools: [], status: status as "unauthorized" | "error" };
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
    const result = await runOAuthFlow({
      serverId: params.serverId,
      callbackPort: params.callbackPort,
    });
    if (result.success) {
      return { ...result, errorKind: null };
    }
    return { ...result, errorKind: classifyOAuthError(result.error) };
  });

  // Default port first (matches typical pre-registered redirect
  // URIs); ephemeral fallback also passes the both-stacks check.
  createTypedHandler(mcpContracts.probeCallbackPort, async () => {
    if (await isPortFreeOnBothLoopbacks(DEFAULT_OAUTH_CALLBACK_PORT)) {
      return { port: DEFAULT_OAUTH_CALLBACK_PORT };
    }
    const MIN = 49152;
    const MAX = 65535;
    for (let i = 0; i < 8; i++) {
      const candidate = Math.floor(Math.random() * (MAX - MIN + 1)) + MIN;
      if (await isPortFreeOnBothLoopbacks(candidate)) {
        return { port: candidate };
      }
    }
    // Retry the single-stack util a few times until it returns a port
    // that also passes the both-stacks check; the listener would
    // otherwise EADDRINUSE on the other stack.
    for (let i = 0; i < 4; i++) {
      const candidate = await findAvailablePort(MIN, MAX);
      if (await isPortFreeOnBothLoopbacks(candidate)) {
        return { port: candidate };
      }
    }
    // No fully-clean port found; surface what we have and let the
    // listener's error path explain the conflict.
    const fallback = await findAvailablePort(MIN, MAX);
    return { port: fallback };
  });

  createTypedHandler(mcpContracts.probeConnection, async (_, serverId) => {
    try {
      const client = await mcpManager.getClient(serverId);
      // listTools forces a real request so a 401 surfaces here, not
      // on the first tool call.
      await client.tools();
      return { status: "ok" as const, error: null };
    } catch (err) {
      try {
        mcpManager.dispose(serverId);
      } catch {}
      const message = err instanceof Error ? err.message : String(err);
      if (looksLikeUnauthorized(message)) {
        return { status: "unauthorized" as const, error: message };
      }
      return { status: "error" as const, error: message };
    }
  });

  // OAuth disconnect: clear stored tokens + client info. Forces the
  // next tool call to require a fresh consent flow.
  createTypedHandler(mcpContracts.disconnectOAuth, async (_, serverId) => {
    return await disconnectOAuth(serverId);
  });

  // Drives the no-keyring banner on the MCP settings page.
  createTypedHandler(mcpContracts.isOauthStorageEncrypted, async () => {
    return { available: safeStorage.isEncryptionAvailable() };
  });

  logger.debug("Registered MCP IPC handlers");
}
