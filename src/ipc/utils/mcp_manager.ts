import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { McpStdioClient } from "./mcp_stdio_client";
import { experimental_createMCPClient } from "ai";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Client =
  | McpStdioClient
  | {
      listTools: () => Promise<any[]>;
      callTool: (name: string, args: any) => Promise<any>;
      dispose?: () => void;
    };

class McpManager {
  private static _instance: McpManager;
  static get instance(): McpManager {
    if (!this._instance) this._instance = new McpManager();
    return this._instance;
  }

  private clients = new Map<number, Client>();

  async getClient(serverId: number): Promise<Client> {
    const existing = this.clients.get(serverId);
    if (existing) return existing;
    const server = (await db
      .select()
      .from(mcpServers)
      .where(
        (mcpServers.id as any).eq?.(serverId) ?? (mcpServers.id as any),
      )) as any[];
    const s = server.find((x) => x.id === serverId);
    if (!s) throw new Error(`MCP server not found: ${serverId}`);
    let client: Client;
    if (s.transport === "stdio") {
      const args = s.args ? JSON.parse(s.args) : [];
      const env = s.envJson ? JSON.parse(s.envJson) : undefined;
      const stdio = new McpStdioClient(
        s.command,
        args,
        s.cwd || undefined,
        env,
      );
      await stdio.start();
      client = stdio;
    } else if (s.transport === "http") {
      if (!s.url) throw new Error("HTTP MCP requires url");
      const httpClient = await experimental_createMCPClient({
        transport: new StreamableHTTPClientTransport(new URL(s.url as string)),
      });
      client = {
        listTools: async () => {
          const toolSet = await httpClient.tools();
          return Object.keys(toolSet).map((name) => ({ name }));
        },
        callTool: async (name: string, args: any) => {
          const toolSet = await httpClient.tools();
          const fn = (toolSet as any)[name];
          if (!fn) throw new Error(`Tool not found: ${name}`);
          return await fn(args);
        },
        dispose: async () => {
          try {
            await (httpClient as any).close?.();
          } catch {}
        },
      } as Client;
    } else {
      throw new Error(`Unsupported MCP transport: ${s.transport}`);
    }
    this.clients.set(serverId, client);
    return client;
  }

  dispose(serverId: number) {
    const c = this.clients.get(serverId);
    if (c) {
      (c as any).dispose?.();
      this.clients.delete(serverId);
    }
  }
}

export const mcpManager = McpManager.instance;
