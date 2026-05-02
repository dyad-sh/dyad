import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { EventEmitter } from "node:events";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import type {
  McpServerStatus,
  McpServerStatusInfo,
} from "../ipc_types";

export type { McpServerStatus, McpServerStatusInfo };

const logger = log.scope("mcp_hub_manager");

interface ClientEntry {
  client: Client;
  transport: Transport;
}

const RECONNECT_DELAY_MS = 5_000;

export class McpHubManager extends EventEmitter {
  private static _instance: McpHubManager | undefined;
  static get instance(): McpHubManager {
    if (!this._instance) this._instance = new McpHubManager();
    return this._instance;
  }

  private clients = new Map<number, ClientEntry>();
  private statuses = new Map<number, McpServerStatusInfo>();
  private reconnectTimers = new Map<number, NodeJS.Timeout>();
  // Optional injection point for tests: pre-built transports keyed by serverId.
  private transportOverrides = new Map<number, Transport>();

  /** Test-only: register a pre-built transport to use on next connect(). */
  __setTransportForTesting(serverId: number, transport: Transport): void {
    this.transportOverrides.set(serverId, transport);
  }

  getStatus(serverId: number): McpServerStatusInfo {
    return (
      this.statuses.get(serverId) ?? {
        serverId,
        status: "disconnected",
      }
    );
  }

  getAllStatuses(): McpServerStatusInfo[] {
    return Array.from(this.statuses.values());
  }

  private setStatus(info: McpServerStatusInfo): void {
    this.statuses.set(info.serverId, info);
    this.emit("status-change", info);
  }

  private async buildTransport(serverId: number): Promise<Transport> {
    const override = this.transportOverrides.get(serverId);
    if (override) {
      this.transportOverrides.delete(serverId);
      return override;
    }
    const rows = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, serverId));
    const s = rows.find((x) => x.id === serverId);
    if (!s) throw new Error(`MCP server not found: ${serverId}`);

    if (s.transport === "stdio") {
      if (!s.command) throw new Error("MCP server command is required");
      return new StdioClientTransport({
        command: s.command,
        args: s.args ?? [],
        env: s.envJson ?? undefined,
      });
    }
    if (s.transport === "http") {
      if (!s.url) throw new Error("HTTP MCP requires url");
      const headers = (s.envJson ?? undefined) as
        | Record<string, string>
        | undefined;
      const url = new URL(s.url);
      if (url.pathname.endsWith("/sse")) {
        return new SSEClientTransport(url, {
          requestInit: headers ? { headers } : undefined,
          eventSourceInit: headers
            ? ({
                fetch: (input: any, init: any) =>
                  fetch(input, {
                    ...(init || {}),
                    headers: { ...(init?.headers || {}), ...headers },
                  }),
              } as any)
            : undefined,
        });
      }
      return new StreamableHTTPClientTransport(url, {
        requestInit: headers ? { headers } : undefined,
      });
    }
    throw new Error(`Unsupported MCP transport: ${s.transport}`);
  }

  async connect(serverId: number): Promise<void> {
    const existing = this.clients.get(serverId);
    if (existing) return;
    this.cancelReconnect(serverId);
    this.setStatus({ serverId, status: "connecting" });

    let transport: Transport;
    try {
      transport = await this.buildTransport(serverId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus({ serverId, status: "error", error: msg });
      throw err;
    }

    const client = new Client(
      { name: "joycreate-hub", version: "1.0.0" },
      { capabilities: {} },
    );

    transport.onerror = (err: Error) => {
      logger.error(`MCP server ${serverId} transport error:`, err);
      this.setStatus({
        serverId,
        status: "error",
        error: err?.message ?? String(err),
      });
      // Best-effort: close the broken transport/client so we don't leak
      // child processes (stdio) or open sockets (HTTP/SSE) before the
      // reconnect timer spawns a fresh one.
      void this.disconnect(serverId).catch((closeErr) => {
        logger.warn(
          `Failed to clean up after transport error for ${serverId}:`,
          closeErr,
        );
      });
      this.scheduleReconnect(serverId);
    };

    try {
      await client.connect(transport);
    } catch (err) {
      // Close the transport so we don't leak resources on a failed connect.
      try {
        const closable = transport as unknown as { close?: () => unknown };
        if (typeof closable.close === "function") {
          await Promise.resolve(closable.close());
        }
      } catch (closeErr) {
        logger.warn(
          `Failed to close transport after connect failure for ${serverId}:`,
          closeErr,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus({ serverId, status: "error", error: msg });
      throw err;
    }

    this.clients.set(serverId, { client, transport });
    this.setStatus({
      serverId,
      status: "connected",
      lastConnectedAt: Date.now(),
    });
  }

  private scheduleReconnect(serverId: number): void {
    if (this.reconnectTimers.has(serverId)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(serverId);
      this.connect(serverId).catch((err) => {
        logger.warn(`Auto-reconnect for MCP ${serverId} failed:`, err);
      });
    }, RECONNECT_DELAY_MS);
    this.reconnectTimers.set(serverId, timer);
  }

  private cancelReconnect(serverId: number): void {
    const t = this.reconnectTimers.get(serverId);
    if (t) {
      clearTimeout(t);
      this.reconnectTimers.delete(serverId);
    }
  }

  async disconnect(serverId: number): Promise<void> {
    this.cancelReconnect(serverId);
    const entry = this.clients.get(serverId);
    if (!entry) {
      this.setStatus({ serverId, status: "disconnected" });
      return;
    }
    try {
      await entry.client.close();
    } catch (err) {
      logger.warn(`Error closing MCP client ${serverId}:`, err);
    }
    this.clients.delete(serverId);
    this.setStatus({ serverId, status: "disconnected" });
  }

  async reconnect(serverId: number): Promise<void> {
    await this.disconnect(serverId);
    await this.connect(serverId);
  }

  async getClient(serverId: number): Promise<Client> {
    const entry = this.clients.get(serverId);
    if (entry) return entry.client;
    await this.connect(serverId);
    const after = this.clients.get(serverId);
    if (!after) throw new Error(`MCP server ${serverId} failed to connect`);
    return after.client;
  }

  async ping(serverId: number): Promise<void> {
    const client = await this.getClient(serverId);
    await client.ping();
  }

  async listTools(serverId: number) {
    const client = await this.getClient(serverId);
    const result = await client.listTools();
    return result.tools;
  }

  async callTool(serverId: number, name: string, args?: unknown) {
    const client = await this.getClient(serverId);
    return client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
  }

  async listResources(serverId: number) {
    const client = await this.getClient(serverId);
    const result = await client.listResources();
    return result.resources;
  }

  async listResourceTemplates(serverId: number) {
    const client = await this.getClient(serverId);
    const result = await client.listResourceTemplates();
    return result.resourceTemplates;
  }

  async readResource(serverId: number, uri: string) {
    const client = await this.getClient(serverId);
    return client.readResource({ uri });
  }

  async listPrompts(serverId: number) {
    const client = await this.getClient(serverId);
    const result = await client.listPrompts();
    return result.prompts;
  }

  async getPrompt(
    serverId: number,
    name: string,
    args?: Record<string, string>,
  ) {
    const client = await this.getClient(serverId);
    return client.getPrompt({ name, arguments: args });
  }

  /** Alias for disconnect; preserved for back-compat with legacy callers. */
  dispose(serverId: number): void {
    this.disconnect(serverId).catch((err) =>
      logger.warn(`dispose() failed for ${serverId}:`, err),
    );
  }

  async disposeAll(): Promise<void> {
    // Cancel every pending reconnect first so timers cannot fire and
    // re-spawn clients while we're tearing everything down.
    for (const [id, timer] of this.reconnectTimers) {
      clearTimeout(timer);
      this.reconnectTimers.delete(id);
    }
    const ids = new Set<number>([
      ...this.clients.keys(),
      ...this.statuses.keys(),
    ]);
    await Promise.allSettled(
      Array.from(ids).map((id) => this.disconnect(id)),
    );
  }
}

export const mcpHubManager = McpHubManager.instance;
