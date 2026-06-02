import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { eq } from "drizzle-orm";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  DyadOAuthClientProvider,
  decryptFromString,
} from "./mcp_oauth_provider";

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

    let client: MCPClient;
    if (s.transport === "stdio") {
      const args = s.args ?? [];
      const env = s.envJson ?? undefined;
      if (!s.command) throw new Error("MCP server command is required");
      const stdio = new StdioClientTransport({
        command: s.command,
        args,
        env,
      });
      client = await createMCPClient({ transport: stdio });
    } else if (s.transport === "http") {
      if (!s.url) throw new Error(`http MCP requires url`);
      const authProvider = s.oauthEnabled
        ? new DyadOAuthClientProvider({
            serverId: s.id,
            callbackPort: s.oauthCallbackPort ?? undefined,
            scope: s.oauthScope ?? undefined,
            preregisteredClientId: s.oauthClientId ?? undefined,
            preregisteredClientSecret: s.oauthClientSecret
              ? decryptFromString(s.oauthClientSecret) || undefined
              : undefined,
          })
        : undefined;
      client = await createMCPClient({
        transport: {
          type: s.transport,
          url: s.url,
          headers: s.headersJson ?? undefined,
          authProvider,
        },
      });
    } else {
      throw new DyadError(
        `Unsupported MCP transport: ${s.transport}`,
        DyadErrorKind.Validation,
      );
    }

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
