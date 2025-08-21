import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

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

export class McpStdioClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<JsonRpcId, (res: JsonRpcResponse) => void>();
  private stdoutBuffer: Buffer = Buffer.alloc(0);
  private isInitialized = false;

  constructor(
    private command: string,
    private args: string[] = [],
    private cwd?: string,
    private env?: Record<string, string>,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.on("exit", (code, signal) => {
      this.emit("exit", { code, signal });
      this.child = null;
      this.isInitialized = false;
      // reject all pending
      for (const [, resolve] of this.pending) {
        resolve({
          jsonrpc: "2.0",
          id: null,
          error: { code: -1, message: "MCP server exited" },
        });
      }
      this.pending.clear();
    });

    this.child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: Buffer) =>
      this.emit("stderr", chunk.toString()),
    );

    // Initialize handshake
    await this.initialize();
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    const result = await this.request<any>("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "dyad", version: "1.0" },
      capabilities: {},
    });
    if ((result as any)?.error) {
      throw new Error(
        (result as any).error.message || "Failed to initialize MCP server",
      );
    }
    this.isInitialized = true;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    await this.start();
    const res = await this.request<{ tools?: McpToolDescriptor[] }>(
      "tools/list",
      {},
    );
    if (res.error) throw new Error(res.error.message);
    console.log("********* res.result", res.result);
    return (res.result?.tools as McpToolDescriptor[]) || [];
  }

  async callTool(toolName: string, args: any): Promise<any> {
    await this.start();
    const res = await this.request<any>("tools/call", {
      name: toolName,
      arguments: args,
    });
    if (res.error) throw new Error(res.error.message);
    return res.result;
  }

  dispose(): void {
    try {
      this.child?.kill();
    } catch {}
    this.child = null;
    this.isInitialized = false;
    this.pending.clear();
  }

  private request<T = any>(
    method: string,
    params?: any,
  ): Promise<JsonRpcResponse<T>> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, resolve as any);
      const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      const json = Buffer.from(JSON.stringify(payload), "utf8");
      const header = Buffer.from(
        `Content-Length: ${json.length}\r\n\r\n`,
        "utf8",
      );
      if (!this.child || !this.child.stdin.writable) {
        this.pending.delete(id);
        return reject(new Error("MCP server process not running"));
      }
      this.child.stdin.write(header);
      this.child.stdin.write(json);
    });
  }

  private onStdout(chunk: Buffer) {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    // Parse LSP-style Content-Length frames
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = this.stdoutBuffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Drop invalid header
        this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4);
        continue;
      }
      const length = parseInt(match[1], 10);
      const total = headerEnd + 4 + length;
      if (this.stdoutBuffer.length < total) break;
      const body = this.stdoutBuffer.slice(headerEnd + 4, total);
      this.stdoutBuffer = this.stdoutBuffer.slice(total);
      try {
        const msg = JSON.parse(body.toString("utf8")) as JsonRpcResponse;
        if (msg && Object.prototype.hasOwnProperty.call(msg, "id")) {
          const resolver = this.pending.get(msg.id as JsonRpcId);
          if (resolver) {
            this.pending.delete(msg.id as JsonRpcId);
            resolver(msg);
          }
        }
      } catch (e) {
        this.emit("parse-error", e);
      }
    }
  }
}
