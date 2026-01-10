import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { eq } from "drizzle-orm";

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class McpManager {
  private static _instance: McpManager;
  static get instance(): McpManager {
    if (!this._instance) this._instance = new McpManager();
    return this._instance;
  }

  private clients = new Map<number, MCPClient>();
  private rawClients = new Map<number, Client>();

  async getClient(serverId: number): Promise<MCPClient> {
    const existing = this.clients.get(serverId);
    if (existing) return existing;

    // Initialize raw client first (if not already done)
    if (!this.rawClients.has(serverId)) {
      await this._initializeClients(serverId);
    }

    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP client not found after initialization: ${serverId}`);
    }
    return client;
  }

  async getRawClient(serverId: number): Promise<Client> {
    // Ensure clients are initialized
    if (!this.rawClients.has(serverId)) {
      await this._initializeClients(serverId);
    }
    const client = this.rawClients.get(serverId);
    if (!client) {
      throw new Error(`Raw MCP client not found: ${serverId}`);
    }
    return client;
  }

  private async _initializeClients(serverId: number): Promise<void> {
    const server = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, serverId));
    const s = server.find((x) => x.id === serverId);
    if (!s) throw new Error(`MCP server not found: ${serverId}`);

    let transport: StdioClientTransport | StreamableHTTPClientTransport;
    if (s.transport === "stdio") {
      const args = s.args ?? [];
      const env = s.envJson ?? undefined;
      if (!s.command) throw new Error("MCP server command is required");
      transport = new StdioClientTransport({
        command: s.command,
        args,
        env,
      });
    } else if (s.transport === "http") {
      if (!s.url) throw new Error("HTTP MCP requires url");
      transport = new StreamableHTTPClientTransport(new URL(s.url as string));
    } else {
      throw new Error(`Unsupported MCP transport: ${s.transport}`);
    }

    // Create raw client for direct tool calling
    const rawClient = new Client(
      { name: "shinso-mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );
    await rawClient.connect(transport);
    this.rawClients.set(serverId, rawClient);

    // Create MCPClient wrapper for AI SDK integration
    // Note: We create a new transport here to avoid conflicts
    let mcpTransport: StdioClientTransport | StreamableHTTPClientTransport;
    if (s.transport === "stdio") {
      const args = s.args ?? [];
      const env = s.envJson ?? undefined;
      mcpTransport = new StdioClientTransport({
        command: s.command!,
        args,
        env,
      });
    } else {
      mcpTransport = new StreamableHTTPClientTransport(
        new URL(s.url as string),
      );
    }

    const client = await createMCPClient({
      transport: mcpTransport,
    });
    this.clients.set(serverId, client);
  }

  dispose(serverId: number) {
    const c = this.clients.get(serverId);
    if (c) {
      c.close();
      this.clients.delete(serverId);
    }
    const rawC = this.rawClients.get(serverId);
    if (rawC) {
      rawC.close();
      this.rawClients.delete(serverId);
    }
  }
}

export const mcpManager = McpManager.instance;
