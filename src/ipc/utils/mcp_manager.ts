// Legacy MCP manager. Wraps the @ai-sdk/mcp `experimental_createMCPClient` so
// that existing chat / local-agent code paths can keep calling
// `client.tools()` (an AI-SDK ToolSet shape, not the raw MCP SDK shape).
//
// New code should prefer `mcpHubManager` from `./mcp_hub_manager`, which uses
// the official `@modelcontextprotocol/sdk` Client directly and exposes
// resources, prompts, status, and reconnect features.

import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { eq } from "drizzle-orm";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { mcpHubManager } from "./mcp_hub_manager";

type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

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
    let transport:
      | StdioClientTransport
      | StreamableHTTPClientTransport
      | SSEClientTransport;
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
      // For HTTP transports, treat envJson as HTTP headers so callers can
      // inject auth tokens (e.g., X-N8N-API-KEY, Authorization).
      const headers = (s.envJson ?? undefined) as
        | Record<string, string>
        | undefined;
      const url = new URL(s.url as string);
      // n8n exposes MCP via legacy SSE endpoints (path ending in /sse).
      // Use SSEClientTransport for those, StreamableHTTP otherwise.
      if (url.pathname.endsWith("/sse")) {
        // The MCP SDK's SSEClientTransport accepts an `eventSourceInit`
        // (mirrored after the WHATWG EventSource init dict) but uses an
        // older `fetch` shape with a 2-arg signature. We declare exactly
        // that shape locally so we can avoid `as any`.
        type SseFetch = (
          input: RequestInfo | URL,
          init?: RequestInit,
        ) => Promise<Response>;
        type SseEventSourceInit = EventSourceInit & { fetch?: SseFetch };

        const customFetch: SseFetch = (input, init) =>
          fetch(input, {
            ...(init ?? {}),
            headers: { ...(init?.headers ?? {}), ...headers },
          });
        const eventSourceInit: SseEventSourceInit | undefined = headers
          ? { fetch: customFetch }
          : undefined;
        transport = new SSEClientTransport(url, {
          requestInit: headers ? { headers } : undefined,
          eventSourceInit,
        });
      } else {
        transport = new StreamableHTTPClientTransport(url, {
          requestInit: headers ? { headers } : undefined,
        });
      }
    } else {
      throw new Error(`Unsupported MCP transport: ${s.transport}`);
    }
    const client = await experimental_createMCPClient({
      transport,
    });
    this.clients.set(serverId, client);
    return client;
  }

  dispose(serverId: number) {
    const c = this.clients.get(serverId);
    if (c) {
      try {
        c.close();
      } catch {
        // best-effort
      }
      this.clients.delete(serverId);
    }
    // Also drop the new-manager cached client so both stay in sync.
    try {
      mcpHubManager.dispose(serverId);
    } catch {
      // best-effort
    }
  }
}

export const mcpManager = McpManager.instance;
export { mcpHubManager } from "./mcp_hub_manager";
