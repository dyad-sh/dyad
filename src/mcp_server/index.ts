/**
 * JoyCreate MCP Server
 *
 * Exposes JoyCreate capabilities as MCP tools so external AI platforms
 * (Claude Desktop, Cursor, Windsurf, etc.) can connect and use them.
 *
 * Supports two transports:
 *  - StreamableHTTP on a configurable localhost port (default 3777)
 *  - stdio (when launched as a subprocess)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import http from "node:http";
import log from "electron-log";
import { registerDocumentTools } from "./tools/document_tools";
import { registerAgentTools } from "./tools/agent_tools";
import { registerWorkflowTools } from "./tools/workflow_tools";
import { registerChatTools } from "./tools/chat_tools";
import { registerMarketplaceTools } from "./tools/marketplace_tools";
import { registerKnowledgeBaseTools } from "./tools/knowledge_base_tools";
import { processInboundEvent, type MarketplaceInboundEvent } from "../ipc/handlers/marketplace_inbound_handlers";

const logger = log.scope("mcp-server");

// ---------------------------------------------------------------------------
// Singleton server manager
// ---------------------------------------------------------------------------

class JoyCreateMcpServer {
  private static instance: JoyCreateMcpServer;
  private mcpServer: McpServer | null = null;
  private httpServer: http.Server | null = null;
  private httpTransport: StreamableHTTPServerTransport | null = null;
  private port = 3777;
  private running = false;

  static getInstance(): JoyCreateMcpServer {
    if (!JoyCreateMcpServer.instance) {
      JoyCreateMcpServer.instance = new JoyCreateMcpServer();
    }
    return JoyCreateMcpServer.instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async startHttp(port?: number): Promise<{ port: number }> {
    if (this.running) {
      logger.info("MCP server already running on port", this.port);
      return { port: this.port };
    }

    this.port = port ?? this.port;
    this.mcpServer = this.createServer();

    this.httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — each request is independent
    });

    await this.mcpServer.connect(this.httpTransport);

    this.httpServer = http.createServer(async (req, res) => {
      // ── CORS preflight ───────────────────────────────────────────────────
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-bot-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // ── POST /sync/inbound — Joy Marketplace → JoyCreate webhook ────────
      if (req.method === "POST" && req.url === "/sync/inbound") {
        try {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as MarketplaceInboundEvent;
              const result = await processInboundEvent(body);
              res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } catch (parseErr) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false, error: "Invalid JSON body" }));
            }
          });
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: err?.message ?? "Internal error" }));
        }
        return;
      }

      // ── GET /sync/health — liveness check ────────────────────────────────
      if (req.method === "GET" && req.url === "/sync/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "joycreate-sync", port: this.port }));
        return;
      }

      // ── /mcp — MCP protocol endpoint ─────────────────────────────────────
      if (req.url === "/mcp") {
        await this.httpTransport!.handleRequest(req, res);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.port, "127.0.0.1", () => {
        resolve();
      });
      this.httpServer!.on("error", reject);
    });

    this.running = true;
    logger.info(`MCP server started on http://127.0.0.1:${this.port}/mcp`);
    return { port: this.port };
  }

  async startStdio(): Promise<void> {
    this.mcpServer = this.createServer();
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    logger.info("MCP server started on stdio");
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    try {
      if (this.httpServer) {
        this.httpServer.close();
        this.httpServer = null;
      }
      if (this.mcpServer) {
        await this.mcpServer.close();
        this.mcpServer = null;
      }
      this.httpTransport = null;
    } catch (err) {
      logger.warn("Error stopping MCP server:", err);
    }

    this.running = false;
    logger.info("MCP server stopped");
  }

  getStatus(): { running: boolean; port: number; url: string | null } {
    return {
      running: this.running,
      port: this.port,
      url: this.running ? `http://127.0.0.1:${this.port}/mcp` : null,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private createServer(): McpServer {
    const server = new McpServer(
      {
        name: "joycreate",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    // Register all tool groups
    registerDocumentTools(server);
    registerAgentTools(server);
    registerWorkflowTools(server);
    registerChatTools(server);
    registerMarketplaceTools(server);
    registerKnowledgeBaseTools(server);

    return server;
  }
}

export { JoyCreateMcpServer };
