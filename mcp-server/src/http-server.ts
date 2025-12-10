#!/usr/bin/env node

/**
 * Dyad MCP HTTP Gateway
 * 
 * Exposes MCP server tools via HTTP REST API
 * This allows remote access to MCP tools without SSH/stdio
 */

import express from 'express';
import cors from 'cors';
import { DyadDatabase } from './database.js';
import { registerAppTools } from './tools/app-tools.js';
import { registerChatTools } from './tools/chat-tools.js';
import { registerFileTools } from './tools/file-tools.js';
import { registerVersionTools } from './tools/version-tools.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

const PORT = parseInt(process.env.MCP_HTTP_PORT || '3008', 10);
const HOST = process.env.MCP_HTTP_HOST || '0.0.0.0';

interface ToolHandler {
    tool: Tool;
    handler: (args: any) => Promise<any>;
}

class DyadMcpHttpServer {
    private app: express.Application;
    private database: DyadDatabase;
    private tools: Map<string, ToolHandler>;

    constructor() {
        this.app = express();
        this.database = new DyadDatabase();
        this.tools = new Map();

        this.setupMiddleware();
        this.registerTools();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        // CORS support for remote access
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));

        // JSON body parser
        this.app.use(express.json());

        // Request logging
        this.app.use((req, res, next) => {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
            next();
        });
    }

    private registerTools(): void {
        const registerTool = (tool: Tool, handler: (args: any) => Promise<any>) => {
            this.tools.set(tool.name, { tool, handler });
        };

        // Register all MCP tools
        registerAppTools(this.database, registerTool);
        registerChatTools(this.database, registerTool);
        registerFileTools(this.database, registerTool);
        registerVersionTools(this.database, registerTool);

        console.log(`[INFO] Registered ${this.tools.size} MCP tools`);
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                server: 'dyad-mcp-http',
                version: '0.1.0',
                timestamp: new Date().toISOString(),
                database: this.database.getDatabasePath(),
                toolCount: this.tools.size
            });
        });

        // List all available tools
        this.app.get('/tools', (req, res) => {
            const toolsList = Array.from(this.tools.values()).map(({ tool }) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            }));

            res.json({
                tools: toolsList,
                count: toolsList.length
            });
        });

        // Get specific tool info
        this.app.get('/tools/:toolName', (req, res) => {
            const { toolName } = req.params;
            const toolHandler = this.tools.get(toolName);

            if (!toolHandler) {
                return res.status(404).json({
                    error: 'Tool not found',
                    toolName,
                    availableTools: Array.from(this.tools.keys())
                });
            }

            res.json({
                name: toolHandler.tool.name,
                description: toolHandler.tool.description,
                inputSchema: toolHandler.tool.inputSchema
            });
        });

        // Execute a tool (POST)
        this.app.post('/tools/:toolName', async (req, res) => {
            const { toolName } = req.params;
            const args = req.body;

            const toolHandler = this.tools.get(toolName);

            if (!toolHandler) {
                return res.status(404).json({
                    error: 'Tool not found',
                    toolName,
                    availableTools: Array.from(this.tools.keys())
                });
            }

            try {
                const startTime = Date.now();
                const result = await toolHandler.handler(args);
                const duration = Date.now() - startTime;

                res.json({
                    success: true,
                    toolName,
                    result,
                    executionTime: `${duration}ms`
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                res.status(500).json({
                    success: false,
                    error: errorMessage,
                    toolName,
                    args
                });
            }
        });

        // JSON-RPC endpoint (compatible with MCP protocol)
        this.app.post('/jsonrpc', async (req, res) => {
            const { jsonrpc, id, method, params } = req.body;

            // Validate JSON-RPC format
            if (jsonrpc !== '2.0' || !method) {
                return res.status(400).json({
                    jsonrpc: '2.0',
                    id: id || null,
                    error: {
                        code: -32600,
                        message: 'Invalid Request'
                    }
                });
            }

            try {
                if (method === 'tools/list') {
                    const tools = Array.from(this.tools.values()).map(({ tool }) => tool);
                    return res.json({
                        jsonrpc: '2.0',
                        id,
                        result: { tools }
                    });
                }

                if (method === 'tools/call') {
                    const { name, arguments: args } = params;
                    const toolHandler = this.tools.get(name);

                    if (!toolHandler) {
                        return res.json({
                            jsonrpc: '2.0',
                            id,
                            error: {
                                code: -32601,
                                message: `Tool not found: ${name}`
                            }
                        });
                    }

                    const result = await toolHandler.handler(args || {});

                    return res.json({
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2)
                                }
                            ]
                        }
                    });
                }

                // Unknown method
                return res.json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${method}`
                    }
                });

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                return res.json({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32603,
                        message: errorMessage
                    }
                });
            }
        });

        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Not found',
                path: req.path,
                availableEndpoints: [
                    'GET /health',
                    'GET /tools',
                    'GET /tools/:toolName',
                    'POST /tools/:toolName',
                    'POST /jsonrpc'
                ]
            });
        });
    }

    start(): void {
        this.app.listen(PORT, HOST, () => {
            console.log('');
            console.log('╔════════════════════════════════════════════════════════════╗');
            console.log('║  Dyad MCP HTTP Gateway                                     ║');
            console.log('╚════════════════════════════════════════════════════════════╝');
            console.log('');
            console.log(`  Server:    http://${HOST}:${PORT}`);
            console.log(`  Health:    http://${HOST}:${PORT}/health`);
            console.log(`  Tools:     http://${HOST}:${PORT}/tools`);
            console.log(`  JSON-RPC:  http://${HOST}:${PORT}/jsonrpc`);
            console.log('');
            console.log(`  Database:  ${this.database.getDatabasePath()}`);
            console.log(`  Tools:     ${this.tools.size} available`);
            console.log('');
            console.log('  Ready to accept HTTP requests!');
            console.log('');
        });
    }
}

// Start the server
const server = new DyadMcpHttpServer();
server.start();
