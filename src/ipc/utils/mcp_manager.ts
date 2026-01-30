import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { eq } from "drizzle-orm";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class McpManager {
  private static _instance: McpManager;
  static get instance(): McpManager {
    if (!this._instance) this._instance = new McpManager();
    return this._instance;
  }

  private clients = new Map<number, MCPClient>();

  async getClient(serverId: number): Promise<MCPClient> {
    const existing = this.clients.get(serverId);
    if (existing) return existing;
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
      const headers = s.headersJson ?? {};
      transport = new StreamableHTTPClientTransport(new URL(s.url as string), {
        requestInit: {
          headers,
        },
      });
    } else {
      throw new Error(`Unsupported MCP transport: ${s.transport}`);
    }
    const client = await createMCPClient({
      transport,
    });
    this.clients.set(serverId, client);
    return client;
  }

  dispose(serverId: number) {
    const c = this.clients.get(serverId);
    if (c) {
      c.close();
      this.clients.delete(serverId);
    }
  }
}

export const mcpManager = McpManager.instance;
