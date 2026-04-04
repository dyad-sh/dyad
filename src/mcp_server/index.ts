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
      // Only accept requests to /mcp endpoint
      if (req.url !== "/mcp") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      await this.httpTransport!.handleRequest(req, res);
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
