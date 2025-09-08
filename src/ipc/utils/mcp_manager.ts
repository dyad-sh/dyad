import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import log from "electron-log";
import { readSettings } from "../../main/settings";

const logger = log.scope("mcp_manager");

export interface McpToolDefinition {
  serverId: string;
  name: string;
  description?: string;
  inputSchema?: any;
}

export interface McpServerConfig {
  id: string;
  name?: string;
  transport: "stdio" | "http";
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse<T = any> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: any };
}

// Simple ID generator
let globalRequestId = 1;
function nextId() {
  return globalRequestId++;
}

class StdioClient {
  private server: McpServerConfig;
  private cp: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: any) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(server: McpServerConfig) {
    this.server = server;
  }

  private ensureProcess() {
    if (this.cp && !this.cp.killed) return;
    const cmd = this.server.command || "";
    const args = this.server.args || [];
    this.cp = spawn(cmd, args, {
      shell: true,
      stdio: "pipe",
      env: { ...process.env, ...(this.server.env || {}) },
    });

    this.cp.stdout.setEncoding("utf8");
    this.cp.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg && (msg.result !== undefined || msg.error)) {
            const idNum = typeof msg.id === "number" ? msg.id : Number(msg.id);
            const pending = this.pending.get(idNum);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(idNum);
              if (msg.error) pending.reject(new Error(msg.error.message));
              else pending.resolve(msg.result);
            }
          }
        } catch (e) {
          logger.warn("Failed to parse MCP stdio line:", e, line);
        }
      }
    });

    this.cp.stderr.setEncoding("utf8");
    this.cp.stderr.on("data", (d) => {
      logger.warn(`[${this.server.id}] STDERR:`, String(d));
    });

    this.cp.on("exit", (code, signal) => {
      logger.warn(
        `MCP stdio process exited id=${this.server.id} code=${code} signal=${signal}`,
      );
      // reject all pending
      for (const [id, p] of this.pending.entries()) {
        clearTimeout(p.timer);
        p.reject(new Error(`Process exited before response (id=${id})`));
      }
      this.pending.clear();
      this.cp = null;
    });
  }

  send<T = any>(method: string, params?: any, timeoutMs = 15000): Promise<T> {
    this.ensureProcess();
    const id = nextId();
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      if (!this.cp || !this.cp.stdin.writable) {
        reject(new Error("MCP stdio process not available"));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP stdio request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.cp.stdin.write(JSON.stringify(req) + "\n");
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
}

class McpManagerImpl {
  private stdioClients = new Map<string, StdioClient>();
  private toolsCache: { ts: number; tools: McpToolDefinition[] } | null = null;
  private static TOOLS_TTL_MS = 5 * 60 * 1000;

  getServers(): McpServerConfig[] {
    const settings = readSettings();
    const servers = settings.mcpServers || [];
    return servers.filter((s) => s.enabled !== false); // default enabled
  }

  /** Return sanitized server info for prompts/UI without exposing secrets. */
  listServersInfo(): Array<{
    id: string;
    name?: string;
    transport: "stdio" | "http";
    urlHost?: string;
    headerKeys?: string[];
    hasCommand?: boolean;
  }> {
    const servers = this.getServers();
    return servers.map((s) => {
      let urlHost: string | undefined;
      if (s.transport === "http" && s.url) {
        try {
          urlHost = new URL(s.url).host;
        } catch {
          urlHost = undefined;
        }
      }
      const headerKeys = s.headers ? Object.keys(s.headers) : undefined;
      return {
        id: s.id,
        name: s.name,
        transport: s.transport,
        urlHost,
        headerKeys,
        hasCommand: !!s.command,
      };
    });
  }

  private getServerById(id: string): McpServerConfig | undefined {
    return this.getServers().find((s) => s.id === id);
  }

  private getOrCreateStdio(server: McpServerConfig): StdioClient {
    let c = this.stdioClients.get(server.id);
    if (!c) {
      c = new StdioClient(server);
      this.stdioClients.set(server.id, c);
    }
    return c;
  }

  async listToolsForServer(
    server: McpServerConfig,
  ): Promise<McpToolDefinition[]> {
    if (server.transport === "http") {
      return this.httpListTools(server);
    }
    if (server.transport === "stdio") {
      const c = this.getOrCreateStdio(server);
      try {
        const result = await c.send<{
          tools: { name: string; description?: string; inputSchema?: any }[];
        }>("tools/list", {});
        return (result.tools || []).map((t) => ({
          serverId: server.id,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      } catch (e) {
        // Try initialize then list again
        try {
          await c.send("initialize", {
            client: { name: "dyad", version: "0.1" },
          });
          const result2 = await c.send<{
            tools: { name: string; description?: string; inputSchema?: any }[];
          }>("tools/list", {});
          return (result2.tools || []).map((t) => ({
            serverId: server.id,
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
        } catch (e2) {
          throw e2;
        }
      }
    }
    return [];
  }

  private async httpListTools(
    server: McpServerConfig,
  ): Promise<McpToolDefinition[]> {
    const url = server.url!;
    // try list directly first
    const id1 = nextId();
    let res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(server.headers || {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: id1,
        method: "tools/list",
        params: {},
      } satisfies JsonRpcRequest),
    });
    let json = (await res.json()) as JsonRpcResponse<{
      tools: { name: string; description?: string; inputSchema?: any }[];
    }>;
    if (json.error) {
      // try initialize then list
      const idInit = nextId();
      await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(server.headers || {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: idInit,
          method: "initialize",
          params: { client: { name: "dyad", version: "0.1" } },
        } satisfies JsonRpcRequest),
      }).catch(() => {});
      const id2 = nextId();
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(server.headers || {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: id2,
          method: "tools/list",
          params: {},
        } satisfies JsonRpcRequest),
      });
      json = (await res.json()) as JsonRpcResponse<{
        tools: { name: string; description?: string; inputSchema?: any }[];
      }>;
      if (json.error) throw new Error(json.error.message);
    }
    const tools = json.result?.tools || [];
    return tools.map((t) => ({
      serverId: server.id,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool<T = any>(
    serverId: string,
    toolName: string,
    args: any,
  ): Promise<T> {
    const server = this.getServerById(serverId);
    if (!server) throw new Error(`MCP server not found: ${serverId}`);
    if (server.transport === "http") {
      return this.httpCallTool<T>(server, toolName, args);
    }
    if (server.transport === "stdio") {
      const c = this.getOrCreateStdio(server);
      return await c.send<T>("tools/call", { name: toolName, arguments: args });
    }
    throw new Error(`Unsupported transport: ${(server as any).transport}`);
  }

  private async httpCallTool<T = any>(
    server: McpServerConfig,
    toolName: string,
    args: any,
  ): Promise<T> {
    const url = server.url!;
    const id = nextId();
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(server.headers || {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) throw new Error(json.error.message);
    return json.result as T;
  }

  async discoverAllTools(force = false): Promise<McpToolDefinition[]> {
    const now = Date.now();
    if (
      !force &&
      this.toolsCache &&
      now - this.toolsCache.ts < McpManagerImpl.TOOLS_TTL_MS
    ) {
      return this.toolsCache.tools;
    }
    const servers = this.getServers();
    const all: McpToolDefinition[] = [];
    for (const server of servers) {
      try {
        const tools = await this.listToolsForServer(server);
        all.push(...tools);
      } catch (e) {
        logger.warn(`Failed to list tools for server ${server.id}:`, e);
      }
    }
    this.toolsCache = { ts: now, tools: all };
    return all;
  }

  async testServerById(
    serverId: string,
  ): Promise<{ ok: boolean; tools?: McpToolDefinition[]; error?: string }> {
    const server = this.getServerById(serverId);
    if (!server) return { ok: false, error: `Server not found: ${serverId}` };
    try {
      const tools = await this.listToolsForServer(server);
      return { ok: true, tools };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }
}

export const McpManager = new McpManagerImpl();
