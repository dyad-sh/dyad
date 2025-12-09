#!/usr/bin/env node

/**
 * Dyad MCP Server
 * 
 * A Model Context Protocol server that exposes Dyad's AI app building capabilities
 * to other AI agents and tools.
 * 
 * This server provides tools for:
 * - Managing apps (create, list, delete)
 * - Managing chats and conversations
 * - Reading and editing files in apps
 * - Running and managing app processes
 * - Version control operations
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { DyadDatabase } from "./database.js";
import { registerAppTools } from "./tools/app-tools.js";
import { registerChatTools } from "./tools/chat-tools.js";
import { registerFileTools } from "./tools/file-tools.js";
import { registerVersionTools } from "./tools/version-tools.js";

// Server configuration
const SERVER_NAME = "dyad-mcp-server";
const SERVER_VERSION = "0.1.0";

/**
 * Main server class that handles MCP protocol communication
 */
class DyadMcpServer {
  private server: Server;
  private database: DyadDatabase;
  private tools: Map<string, Tool>;
  private toolHandlers: Map<string, (args: any) => Promise<any>>;

  constructor() {
    this.server = new Server(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.database = new DyadDatabase();
    this.tools = new Map();
    this.toolHandlers = new Map();

    this.setupHandlers();
    this.registerTools();
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    // Handle list_tools requests
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.tools.values()),
      };
    });

    // Handle call_tool requests
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const handler = this.toolHandlers.get(name);
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      try {
        const result = await handler(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: errorMessage,
                  toolName: name,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Register all available tools
   */
  private registerTools(): void {
    const registerTool = (tool: Tool, handler: (args: any) => Promise<any>) => {
      this.tools.set(tool.name, tool);
      this.toolHandlers.set(tool.name, handler);
    };

    // Register tools from different modules
    registerAppTools(this.database, registerTool);
    registerChatTools(this.database, registerTool);
    registerFileTools(this.database, registerTool);
    registerVersionTools(this.database, registerTool);
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Log to stderr (stdout is used for MCP communication)
    console.error("Dyad MCP Server started successfully");
    console.error(`Server: ${SERVER_NAME} v${SERVER_VERSION}`);
    console.error(`Database: ${this.database.getDatabasePath()}`);
  }
}

// Start the server
const server = new DyadMcpServer();
server.start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
