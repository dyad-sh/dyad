import { experimental_createMCPClient } from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  McpConfig,
  ToolSet,
  MCPServerTools,
  Tool,
  ToolCallAnnotation,
  TransportConfig,
  StdioTransportConfig,
} from './mcpSchemas.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Simple logger for MCP service
const logger = {
  info: (message: string, data?: any) => console.log(`[MCP] ${message}`, data),
  warn: (message: string, data?: any) => console.warn(`[MCP] ${message}`, data),
  error: (message: string, data?: any) => console.error(`[MCP] ${message}`, data),
  debug: (message: string, data?: any) => console.debug(`[MCP] ${message}`, data),
};

export class MCPService {
  private static _instance: MCPService;
  private _tools: ToolSet = {};
  private _toolsWithoutExecute: ToolSet = {};
  private _mcpToolsPerServer: MCPServerTools = {};
  private _toolNamesToServerNames = new Map<string, string>();
  private _config: McpConfig = { mcpServers: {} };
  private _clients: Map<string, any> = new Map();

  static getInstance(): MCPService {
    if (!MCPService._instance) {
      MCPService._instance = new MCPService();
    }
    return MCPService._instance;
  }

  private constructor() {
    // Private constructor for singleton
  }

  get tools(): ToolSet {
    return this._tools;
  }

  get toolsWithoutExecute(): ToolSet {
    return this._toolsWithoutExecute;
  }

  get mcpToolsPerServer(): MCPServerTools {
    return this._mcpToolsPerServer;
  }

  async updateConfig(config: McpConfig): Promise<MCPServerTools> {
    try {
      logger.info('Updating MCP configuration', { serverCount: Object.keys(config.mcpServers).length });

      // Try to load and convert Cursor's mcp.json if no servers are configured
      if (Object.keys(config.mcpServers).length === 0) {
        try {
          config = await this.loadCursorMcpConfig();
        } catch (error) {
          logger.warn('Could not load Cursor MCP config, using empty config', error);
        }
      }

      // Clean up existing clients
      for (const client of this._clients.values()) {
        try {
          await client.close();
        } catch (error) {
          logger.warn('Error closing client', error);
        }
      }
      this._clients.clear();

      // Normalize config to support Cursor-style inputs
      this._config = this.normalizeMcpConfig(config as any);
      this._tools = {};
      this._toolsWithoutExecute = {};
      this._mcpToolsPerServer = {};
      this._toolNamesToServerNames.clear();

      // Initialize new clients
      for (const [serverName, serverConfig] of Object.entries(this._config.mcpServers)) {
        await this.initializeServer(serverName, serverConfig);
      }

      logger.info('MCP configuration updated successfully');
      return this._mcpToolsPerServer;
    } catch (error) {
      logger.error('Failed to update MCP configuration', error);
      throw error;
    }
  }

  private async initializeServer(serverName: string, serverConfig: any): Promise<void> {
    try {
      logger.info(`Initializing MCP server: ${serverName}`);

      this._mcpToolsPerServer[serverName] = {
        status: 'checking',
        tools: [],
      };

      const transport = this.createTransport(serverConfig.transport);
      const client = await experimental_createMCPClient({ transport });

      this._clients.set(serverName, client);

      // Get available tools
      const listToolsResult = await (client as any).listTools();
      const tools: Tool[] = (listToolsResult?.tools ?? []) as Tool[];

      logger.info(`Server ${serverName} provides ${tools.length} tools`);

      // Store tools with server mapping
      tools.forEach(tool => {
        const toolName = `${serverName}.${tool.name}`;
        this._toolNamesToServerNames.set(toolName, serverName);

        // Tool with execute function
        this._tools[toolName] = {
          name: toolName,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: async (args: any) => {
            try {
              logger.debug(`Executing tool: ${toolName}`, args);
              const result = await (client as any).callTool({ name: tool.name, args });
              return result;
            } catch (error) {
              logger.error(`Tool execution failed: ${toolName}`, error);
              throw error;
            }
          },
        } as any; // Type assertion to bypass TypeScript limitation

        // Tool without execute function (for LLM)
        this._toolsWithoutExecute[toolName] = {
          name: toolName,
          description: tool.description,
          inputSchema: tool.inputSchema,
        };
      });

      this._mcpToolsPerServer[serverName] = {
        status: 'available',
        tools,
      };

      logger.info(`Successfully initialized MCP server: ${serverName}`);
    } catch (error) {
      logger.error(`Failed to initialize MCP server: ${serverName}`, error);
      this._mcpToolsPerServer[serverName] = {
        status: 'unavailable',
        tools: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private createTransport(transportConfig: TransportConfig): any {
    switch (transportConfig.type) {
      case 'stdio':
        return this.createStdioTransport(transportConfig as any);
      case 'sse':
        // AI SDK requires SSE transport; validate minimally
        if (!(transportConfig as any).url) {
          throw new Error('SSE transport requires a url');
        }
        return {
          type: 'sse',
          url: (transportConfig as any).url,
          headers: (transportConfig as any).headers,
        };
      case 'streamable-http':
        // Not supported by AI SDK MCP client out of the box
        throw new Error('Unsupported transport type: streamable-http');
      default:
        throw new Error(`Unsupported transport type: ${(transportConfig as any).type}`);
    }
  }

  private createStdioTransport(config: StdioTransportConfig): any {
    // Provide a custom transport that satisfies the AI SDK MCPTransport interface
    const inheritedEnv: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => typeof v === 'string') as Array<[string, string]>
    );
    return new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      cwd: config.cwd,
      env: {
        ...inheritedEnv,
        ...(config.env || {}),
      },
    });
  }

  async checkServersAvailabilities(): Promise<MCPServerTools> {
    try {
      logger.info('Checking MCP servers availability');

      for (const [serverName, _serverConfig] of Object.entries(this._config.mcpServers)) {
        if (this._mcpToolsPerServer[serverName]?.status === 'checking') {
          continue; // Still initializing
        }

        try {
          this._mcpToolsPerServer[serverName] = {
            status: 'checking',
            tools: this._mcpToolsPerServer[serverName]?.tools || [],
          };

          const client = this._clients.get(serverName);
          if (!client) {
            throw new Error('Client not found');
          }

          // Test connectivity by listing tools
          const listToolsResult = await (client as any).listTools();
          const tools: Tool[] = (listToolsResult?.tools ?? []) as Tool[];

          this._mcpToolsPerServer[serverName] = {
            status: 'available',
            tools,
          };
        } catch (error) {
          logger.warn(`Server ${serverName} is unavailable`, error);
          this._mcpToolsPerServer[serverName] = {
            status: 'unavailable',
            tools: [],
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }

      logger.info('MCP servers availability check completed');
      return this._mcpToolsPerServer;
    } catch (error) {
      logger.error('Failed to check MCP servers availability', error);
      throw error;
    }
  }

  async processToolInvocations(messages: any[], dataStream: any): Promise<any[]> {
    try {
      // Process messages for tool invocations
      // This is a placeholder - actual implementation would depend on message format
      const processedMessages = [...messages];

      // Look for tool invocation messages and process them
      for (let i = 0; i < processedMessages.length; i++) {
        const message = processedMessages[i];
        if (message.role === 'assistant' && message.toolInvocations) {
          for (const toolInvocation of message.toolInvocations) {
            await this.processToolInvocation(toolInvocation, dataStream);
          }
        }
      }

      return processedMessages;
    } catch (error) {
      logger.error('Failed to process tool invocations', error);
      throw error;
    }
  }

  private async processToolInvocation(toolInvocation: any, dataStream: any): Promise<void> {
    const { toolCallId, toolName, args } = toolInvocation;

    try {
      const tool = this._tools[toolName] as any; // Type assertion for execute property
      if (!tool || !tool.execute) {
        throw new Error(`Tool not found or not executable: ${toolName}`);
      }

      // Execute the tool
      const result = await tool.execute(args);

      // Add result to data stream
      dataStream.append({
        type: 'tool_result',
        toolCallId,
        result,
      });

      logger.debug(`Tool execution completed: ${toolName}`);
    } catch (error) {
      logger.error(`Tool execution failed: ${toolName}`, error);

      // Add error result to data stream
      dataStream.append({
        type: 'tool_result',
        toolCallId,
        result: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  processToolCall(toolCall: any, dataStream: any): void {
    try {
      const { id: toolCallId, name: toolName } = toolCall.function;

      // Find which server this tool belongs to
      const serverName = this._toolNamesToServerNames.get(toolName);

      if (!serverName) {
        logger.warn(`Could not find server for tool: ${toolName}`);
        return;
      }

      const serverTools = this._mcpToolsPerServer[serverName];
      const tool = serverTools?.tools.find(t => `${serverName}.${t.name}` === toolName);

      if (!tool) {
        logger.warn(`Could not find tool definition: ${toolName}`);
        return;
      }

      // Create annotation for frontend processing
      const annotation: ToolCallAnnotation = {
        type: 'toolCall',
        toolCallId,
        serverName,
        toolName: tool.name,
        toolDescription: tool.description || '',
      };

      // Add annotation to data stream
      dataStream.append({
        type: 'annotation',
        data: annotation,
      });

      logger.debug(`Processed tool call annotation: ${toolName}`);
    } catch (error) {
      logger.error('Failed to process tool call', error);
    }
  }

  private async loadCursorMcpConfig(): Promise<McpConfig> {
    try {
      // Try to find Cursor's mcp.json file
      const possiblePaths = [
        path.join(os.homedir(), '.cursor', 'mcp.json'),
        path.join(process.cwd(), 'mcp.json'),
        'c:\\Users\\www\\.cursor\\mcp.json', // Windows-specific path
      ];

      let cursorConfigPath = '';
      for (const configPath of possiblePaths) {
        if (fs.existsSync(configPath)) {
          cursorConfigPath = configPath;
          break;
        }
      }

      if (!cursorConfigPath) {
        throw new Error('Could not find Cursor MCP configuration file');
      }

      const configContent = fs.readFileSync(cursorConfigPath, 'utf-8');
      const cursorConfig = JSON.parse(configContent);

      // Convert Cursor format to our format
      const convertedConfig: McpConfig = {
        mcpServers: {},
      };

      for (const [serverName, serverConfig] of Object.entries(cursorConfig.mcpServers || {})) {
        const config = serverConfig as any;

        // Determine transport type
        let transport: TransportConfig;
        switch (config.transportType) {
          case 'stdio':
            transport = {
              type: 'stdio',
              command: config.command,
              args: config.args || [],
              env: config.env || {},
            };
            break;
          case 'sse':
            transport = {
              type: 'sse',
              url: config.url,
              headers: config.headers || {},
            };
            break;
          default:
            // Assume stdio if transportType is not specified
            transport = {
              type: 'stdio',
              command: config.command,
              args: config.args || [],
              env: config.env || {},
            };
            break;
        }

        convertedConfig.mcpServers[serverName] = {
          transport,
        };
      }

      logger.info(`Loaded ${Object.keys(convertedConfig.mcpServers).length} servers from Cursor MCP config`);
      return convertedConfig;
    } catch (error) {
      logger.error('Failed to load Cursor MCP config', error);
      // Return empty config as fallback
      return { mcpServers: {} };
    }
  }

  private normalizeMcpConfig(raw: any): McpConfig {
    try {
      const result: McpConfig = { mcpServers: {} } as McpConfig;
      for (const [name, serverConfig] of Object.entries<any>(raw?.mcpServers ?? {})) {
        if (serverConfig && serverConfig.transport && serverConfig.transport.type) {
          result.mcpServers[name] = serverConfig;
          continue;
        }
        const transportType = serverConfig?.transportType;
        if (!transportType) {
          continue;
        }
        if (transportType === 'stdio') {
          result.mcpServers[name] = {
            transport: {
              type: 'stdio',
              command: serverConfig.command,
              args: serverConfig.args || [],
              cwd: serverConfig.cwd,
              env: serverConfig.env || {},
            },
          } as any;
        } else if (transportType === 'sse') {
          result.mcpServers[name] = {
            transport: {
              type: 'sse',
              url: serverConfig.url,
              headers: serverConfig.headers || {},
            },
          } as any;
        }
      }
      return result;
    } catch (error) {
      logger.error('Failed to normalize MCP config', error);
      return { mcpServers: {} } as McpConfig;
    }
  }

  // Clean up resources
  async destroy(): Promise<void> {
    try {
      logger.info('Destroying MCP service');

      for (const client of this._clients.values()) {
        try {
          await client.close();
        } catch (error) {
          logger.warn('Error closing client during destroy', error);
        }
      }
      this._clients.clear();

      logger.info('MCP service destroyed');
    } catch (error) {
      logger.error('Failed to destroy MCP service', error);
    }
  }
}
