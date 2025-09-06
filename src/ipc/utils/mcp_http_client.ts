import fetch from "node-fetch";

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: any;
}

interface JsonRpcResponse<T = any> {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: T;
  error?: { code: number; message: string; data?: any };
}

interface McpToolDescriptor {
  name: string;
  description?: string;
}

export class McpHttpClient {
  private nextId = 1;
  private initialized = false;

  constructor(private baseUrl: string) {}

  private async request<T = any>(
    method: string,
    params?: any,
  ): Promise<JsonRpcResponse<T>> {
    const id = this.nextId++;
    const body: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP MCP server responded with ${response.status}`);
    }
    const json = (await response.json()) as JsonRpcResponse<T>;
    return json;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    const res = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "dyad", version: "1.0" },
      capabilities: {},
    });
    if (res.error)
      throw new Error(res.error.message || "MCP initialize failed");
    this.initialized = true;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    await this.ensureInitialized();
    const res = await this.request<{ tools?: McpToolDescriptor[] }>(
      "tools/list",
      {},
    );
    if (res.error) throw new Error(res.error.message);
    return (res.result?.tools as McpToolDescriptor[]) || [];
  }

  async callTool(toolName: string, args: any): Promise<any> {
    await this.ensureInitialized();
    const res = await this.request<any>("tools/call", {
      name: toolName,
      arguments: args,
    });
    if (res.error) throw new Error(res.error.message);
    return res.result;
  }
}
