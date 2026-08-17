import log from "electron-log";
import { shell } from "electron";
import { createMCPClient } from "@ai-sdk/mcp";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
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
  type McpWorkflow,
} from "../types/mcp";
import {
  LOVABLE_MCP_SERVER_URL,
  isLovableMcpServerUrl,
} from "@/lib/lovableMcp";
import {
  clearLovableOAuthCredentials,
  hasLovableOAuthTokens,
  listenForLovableOAuthCallback,
  LovableOAuthClientProvider,
} from "../utils/lovable_mcp_oauth";
import { createLovableMcpTransport } from "../utils/lovable_mcp_transport";
import { CANVA_MCP_SERVER_URL, isCanvaMcpServerUrl } from "@/lib/canvaMcp";
import {
  CanvaOAuthClientProvider,
  clearCanvaOAuthCredentials,
  hasCanvaOAuthTokens,
  listenForCanvaOAuthCallback,
} from "../utils/canva_mcp_oauth";
import { createCanvaMcpTransport } from "../utils/canva_mcp_transport";

const logger = log.scope("mcp_handlers");
let lovableConnectPromise:
  | Promise<{
      state: "connected" | "error";
      serverId?: number;
      toolCount?: number;
      error?: string;
    }>
  | undefined;
let canvaConnectPromise:
  | Promise<{
      state: "connected" | "error";
      serverId?: number;
      toolCount?: number;
      error?: string;
    }>
  | undefined;

// Helper to cast DB server to typed server
function toMcpServer(dbServer: typeof mcpServers.$inferSelect): McpServer {
  return {
    ...dbServer,
    transport: dbServer.transport as McpTransport,
  };
}

function parseMcpToolResult(result: unknown): unknown {
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as unknown;
    } catch {
      return result;
    }
  }

  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const text = (result as { content: Array<{ text?: unknown }> }).content
      .map((item) => (typeof item.text === "string" ? item.text : ""))
      .join("\n")
      .trim();
    if (text) {
      return parseMcpToolResult(text);
    }
  }

  return result;
}

function workflowFromUnknown(value: unknown): McpWorkflow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const idValue =
    record.id ?? record.workflowId ?? record.workflow_id ?? record.workflowID;
  const nameValue = record.name ?? record.title ?? record.workflowName;

  if (idValue == null || nameValue == null) {
    return null;
  }

  const activeValue =
    typeof record.active === "boolean"
      ? record.active
      : typeof record.published === "boolean"
        ? record.published
        : typeof record.enabled === "boolean"
          ? record.enabled
          : null;

  return {
    id: String(idValue),
    name: String(nameValue),
    description:
      typeof record.description === "string" ? record.description : null,
    active: activeValue,
  };
}

function workflowsFromUnknown(value: unknown): McpWorkflow[] {
  const parsed = parseMcpToolResult(value);
  const candidates = (() => {
    if (Array.isArray(parsed)) return parsed;
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.workflows)) return record.workflows;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.results)) return record.results;
    if (Array.isArray(record.items)) return record.items;
    return [record];
  })();

  const seen = new Set<string>();
  return candidates
    .map(workflowFromUnknown)
    .filter((workflow): workflow is McpWorkflow => {
      if (!workflow || seen.has(workflow.id)) return false;
      seen.add(workflow.id);
      return true;
    });
}

async function findLovableServer() {
  const servers = await db.select().from(mcpServers);
  return servers.find((server) => isLovableMcpServerUrl(server.url));
}

async function ensureLovableServer() {
  const existing = await findLovableServer();
  if (existing) return existing;

  const [created] = await db
    .insert(mcpServers)
    .values({
      name: "Lovable",
      transport: "http",
      url: LOVABLE_MCP_SERVER_URL,
      enabled: false,
    })
    .returning();
  return created;
}

async function findCanvaServer() {
  const servers = await db.select().from(mcpServers);
  return servers.find((server) => isCanvaMcpServerUrl(server.url));
}

async function ensureCanvaServer() {
  const existing = await findCanvaServer();
  if (existing) return existing;

  const [created] = await db
    .insert(mcpServers)
    .values({
      name: "Canva",
      transport: "http",
      url: CANVA_MCP_SERVER_URL,
      enabled: false,
    })
    .returning();
  return created;
}

async function verifyLovableWorkspaceAccess(
  tools: Awaited<
    ReturnType<Awaited<ReturnType<typeof createMCPClient>>["tools"]>
  >,
) {
  const listWorkspacesTool = tools.list_workspaces;
  if (!listWorkspacesTool?.execute) {
    throw new Error(
      "Lovable connected, but the list_workspaces verification tool is unavailable.",
    );
  }

  await listWorkspacesTool.execute({}, {
    toolCallId: "lovable-oauth-scope-verification",
    messages: [],
    abortSignal: new AbortController().signal,
  } as any);
}

async function getLovableConnectionStatus() {
  const server = await findLovableServer();
  if (!server || !server.enabled || !hasLovableOAuthTokens()) {
    return {
      state: "disconnected" as const,
      serverId: server?.id,
    };
  }

  try {
    const client = await mcpManager.getClient(server.id);
    const tools = await client.tools();
    await verifyLovableWorkspaceAccess(tools);
    return {
      state: "connected" as const,
      serverId: server.id,
      toolCount: Object.keys(tools).length,
    };
  } catch (error) {
    mcpManager.dispose(server.id);
    return {
      state: "error" as const,
      serverId: server.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function connectLovable() {
  const server = await ensureLovableServer();
  mcpManager.dispose(server.id);

  const oauthProvider = new LovableOAuthClientProvider(
    undefined,
    async (authorizationUrl) => {
      await shell.openExternal(authorizationUrl.toString());
    },
  );
  // Connecting is an explicit reauthorization action. Remove any legacy
  // identity-only token so the SDK must request the expanded permissions.
  oauthProvider.invalidateCredentials("tokens");
  const callback = await listenForLovableOAuthCallback(
    oauthProvider.expectedState,
  );
  oauthProvider.setRedirectUrl(callback.redirectUrl);
  let bootstrapClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;

  try {
    const transport = createLovableMcpTransport(oauthProvider);
    try {
      bootstrapClient = await createMCPClient({ transport });
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      const authorizationCode = await callback.waitForCode;
      await transport.finishAuth(authorizationCode);
      await transport.close();

      bootstrapClient = await createMCPClient({
        transport: createLovableMcpTransport(oauthProvider),
      });
    }

    const tools = await bootstrapClient.tools();
    logger.info("Lovable MCP tools discovered", {
      tools: Object.keys(tools),
    });
    await verifyLovableWorkspaceAccess(tools);
    await db
      .update(mcpServers)
      .set({ enabled: true, name: "Lovable", url: LOVABLE_MCP_SERVER_URL })
      .where(eq(mcpServers.id, server.id));

    return {
      state: "connected" as const,
      serverId: server.id,
      toolCount: Object.keys(tools).length,
    };
  } catch (error) {
    logger.error("Lovable OAuth connection failed", error);
    return {
      state: "error" as const,
      serverId: server.id,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await bootstrapClient?.close();
    await callback.close();
  }
}

async function getCanvaConnectionStatus() {
  const server = await findCanvaServer();
  if (!server || !server.enabled || !hasCanvaOAuthTokens()) {
    return {
      state: "disconnected" as const,
      serverId: server?.id,
    };
  }

  try {
    const client = await mcpManager.getClient(server.id);
    const tools = await client.tools();
    return {
      state: "connected" as const,
      serverId: server.id,
      toolCount: Object.keys(tools).length,
    };
  } catch (error) {
    mcpManager.dispose(server.id);
    return {
      state: "error" as const,
      serverId: server.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function connectCanva() {
  const server = await ensureCanvaServer();
  mcpManager.dispose(server.id);

  const oauthProvider = new CanvaOAuthClientProvider(
    undefined,
    async (authorizationUrl) => {
      await shell.openExternal(authorizationUrl.toString());
    },
  );
  const callback = await listenForCanvaOAuthCallback(
    oauthProvider.expectedState,
  );
  oauthProvider.setRedirectUrl(callback.redirectUrl);
  // A DCR registration contains its redirect URL. Re-register for the new
  // loopback port whenever the user explicitly reconnects.
  oauthProvider.invalidateCredentials("all");
  let bootstrapClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;

  try {
    const transport = createCanvaMcpTransport(oauthProvider);
    try {
      bootstrapClient = await createMCPClient({ transport });
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      const authorizationCode = await callback.waitForCode;
      await transport.finishAuth(authorizationCode);
      await transport.close();
      bootstrapClient = await createMCPClient({
        transport: createCanvaMcpTransport(oauthProvider),
      });
    }

    const tools = await bootstrapClient.tools();
    logger.info("Canva MCP tools discovered", { tools: Object.keys(tools) });
    await db
      .update(mcpServers)
      .set({ enabled: true, name: "Canva", url: CANVA_MCP_SERVER_URL })
      .where(eq(mcpServers.id, server.id));

    return {
      state: "connected" as const,
      serverId: server.id,
      toolCount: Object.keys(tools).length,
    };
  } catch (error) {
    logger.error("Canva OAuth connection failed", error);
    return {
      state: "error" as const,
      serverId: server.id,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await bootstrapClient?.close();
    await callback.close();
  }
}

/**
 * What kind of failure this is.
 *
 * The transport reports an HTTP 401 as an Error whose message is "Unauthorized",
 * so this reads the message rather than a status code it never receives.
 */
export function classifyMcpFailure(error: unknown): {
  reason: "unauthorized" | "unreachable" | "unknown";
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthori[sz]ed|\b401\b|\b403\b|forbidden/i.test(message)) {
    return { reason: "unauthorized", message };
  }
  if (
    /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timed? ?out|network/i.test(
      message,
    )
  ) {
    return { reason: "unreachable", message };
  }
  return { reason: "unknown", message };
}

/**
 * One line per failure, and never a stack for a server that simply needs
 * signing in. These run on a poll, so an error-level stack each time buries
 * everything else in the log.
 */
function logMcpFailure(what: string, serverId: number, error: unknown) {
  const { reason, message } = classifyMcpFailure(error);
  if (reason === "unauthorized") {
    logger.warn(`${what}: server ${serverId} needs authentication`);
    return;
  }
  if (reason === "unreachable") {
    logger.warn(`${what}: server ${serverId} unreachable (${message})`);
    return;
  }
  logger.error(`${what}: server ${serverId}`, error);
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
      logMcpFailure("Could not list tools", serverId, e);
      return [];
    }
  });

  createTypedHandler(mcpContracts.listWorkflows, async (_, serverId) => {
    try {
      const client = await mcpManager.getClient(serverId);
      const remoteTools = await client.tools();
      const searchWorkflowsTool = remoteTools.search_workflows;
      if (!searchWorkflowsTool?.execute) {
        return [];
      }

      const result = await searchWorkflowsTool.execute({}, {
        toolCallId: `settings-list-workflows-${serverId}`,
        messages: [],
        abortSignal: new AbortController().signal,
      } as any);
      return workflowsFromUnknown(result);
    } catch (e) {
      logMcpFailure("Could not list workflows", serverId, e);
      return [];
    }
  });

  createTypedHandler(mcpContracts.checkConnection, async (_, serverId) => {
    try {
      const client = await mcpManager.getClient(serverId);
      const remoteTools = await client.tools();
      return {
        serverId,
        ok: true,
        toolCount: Object.keys(remoteTools).length,
      };
    } catch (error) {
      const { reason, message } = classifyMcpFailure(error);
      logMcpFailure("Connection check failed", serverId, error);
      return {
        serverId,
        ok: false,
        reason,
        error:
          reason === "unauthorized"
            ? "Authentication required. Sign in or add a token for this server."
            : message,
      };
    }
  });

  createTypedHandler(mcpContracts.getLovableStatus, async () => {
    return getLovableConnectionStatus();
  });

  createTypedHandler(mcpContracts.connectLovable, async () => {
    lovableConnectPromise ??= connectLovable().finally(() => {
      lovableConnectPromise = undefined;
    });
    return lovableConnectPromise;
  });

  createTypedHandler(mcpContracts.disconnectLovable, async () => {
    const server = await findLovableServer();
    if (server) {
      mcpManager.dispose(server.id);
      await db
        .update(mcpServers)
        .set({ enabled: false })
        .where(eq(mcpServers.id, server.id));
    }
    clearLovableOAuthCredentials();
    return {
      state: "disconnected" as const,
      serverId: server?.id,
    };
  });

  createTypedHandler(mcpContracts.getCanvaStatus, async () => {
    return getCanvaConnectionStatus();
  });

  createTypedHandler(mcpContracts.connectCanva, async () => {
    canvaConnectPromise ??= connectCanva().finally(() => {
      canvaConnectPromise = undefined;
    });
    return canvaConnectPromise;
  });

  createTypedHandler(mcpContracts.disconnectCanva, async () => {
    const server = await findCanvaServer();
    if (server) {
      mcpManager.dispose(server.id);
      await db
        .update(mcpServers)
        .set({ enabled: false })
        .where(eq(mcpServers.id, server.id));
    }
    clearCanvaOAuthCredentials();
    return {
      state: "disconnected" as const,
      serverId: server?.id,
    };
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
