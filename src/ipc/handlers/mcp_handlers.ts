import { ipcMain } from "electron";
import { experimental_createMCPClient } from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpConfig, MCPServerTools, Tool, ToolSet } from "../../lib/services/mcpSchemas.js";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from "electron-log";
import { getUserDataPath } from "../../paths/paths"; // Import getUserDataPath

const logger = log.scope("mcp_handlers");

// Global state for MCP service in main process
let mcpTools: ToolSet = {};
let mcpToolsWithoutExecute: ToolSet = {};
let mcpToolsPerServer: MCPServerTools = {};
let mcpToolNamesToServerNames = new Map<string, string>();
let mcpConfig: McpConfig = { mcpServers: {} };
let mcpClients: Map<string, any> = new Map();

// Define the path for the user-managed mcp.json file
const MCP_CONFIG_FILE = "mcp.json";
const MCP_CONFIG_PATH = path.join(getUserDataPath(), MCP_CONFIG_FILE);

export function registerMCPHandlers() {
  // Initialize global MCP state
  (global as any).mcpState = {
    tools: {},
    toolsWithoutExecute: {},
    toolsPerServer: {},
    toolNamesToServerNames: new Map(),
    config: { mcpServers: {} },
    clients: new Map(),
  };

  const mcpState = (global as any).mcpState;

  // Automatically initialize MCP configuration on startup
  initializeMCPOnStartup();

  // Update MCP configuration
  ipcMain.handle("mcp:update-config", async (event, config: McpConfig) => {
    try {
      logger.info("Updating MCP configuration", {
        serverCount: Object.keys(config.mcpServers).length
      });

      // Save the updated configuration to the user-managed mcp.json file
      await saveMcpConfig(config);

      // Clean up existing clients
      for (const client of mcpState.clients.values()) {
        try {
          await client.close();
        } catch (error) {
          logger.warn('Error closing client', error);
        }
      }
      mcpState.clients.clear();

      // Normalize config to support both Cursor-style and internal formats
      const normalizedConfig = normalizeMcpConfig(config as any);
      mcpState.config = normalizedConfig;
      mcpState.tools = {};
      mcpState.toolsWithoutExecute = {};
      mcpState.toolsPerServer = {};
      mcpState.toolNamesToServerNames.clear();

      // Initialize new clients
      for (const [serverName, serverConfig] of Object.entries(mcpState.config.mcpServers)) {
        await initializeServer(serverName, serverConfig);
      }

      logger.info('MCP configuration updated successfully');
      return { success: true, serverTools: mcpState.toolsPerServer };
    } catch (error) {
      logger.error("Failed to update MCP configuration", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Save MCP configuration to file
  ipcMain.handle("mcp:save-config", async (event, config: McpConfig) => {
    try {
      await saveMcpConfig(config);
      logger.info("MCP configuration saved successfully");
      return { success: true };
    } catch (error) {
      logger.error("Failed to save MCP configuration", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Check servers availability
  ipcMain.handle("mcp:check-servers", async () => {
    try {
      logger.info("Checking MCP servers availability");

      for (const [serverName, _serverConfig] of Object.entries(mcpState.config.mcpServers)) {
        if (mcpState.toolsPerServer[serverName]?.status === 'checking') {
          continue; // Still initializing
        }

        try {
          mcpState.toolsPerServer[serverName] = {
            status: 'checking',
            tools: mcpState.toolsPerServer[serverName]?.tools || [],
          };

          const client = mcpState.clients.get(serverName);
          if (!client) {
            throw new Error('Client not found');
          }

          // Test connectivity by listing tools
          const listToolsResult = await (client as any).listTools();
          const tools: Tool[] = (listToolsResult?.tools ?? []) as Tool[];

          mcpState.toolsPerServer[serverName] = {
            status: 'available',
            tools,
          };
        } catch (error) {
          logger.warn(`Server ${serverName} is unavailable`, error);
          mcpState.toolsPerServer[serverName] = {
            status: 'unavailable',
            tools: [],
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }

      logger.info('MCP servers availability check completed');
      return { success: true, serverTools: mcpState.toolsPerServer };
    } catch (error) {
      logger.error("Failed to check MCP servers", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get server tools
  ipcMain.handle("mcp:get-server-tools", async () => {
    try {
      return { success: true, serverTools: mcpState.toolsPerServer };
    } catch (error) {
      logger.error("Failed to get MCP server tools", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Refresh MCP configuration and tools
  ipcMain.handle("mcp:refresh", async () => {
    try {
      logger.info("Refreshing MCP configuration and tools");
      
      // Clean up existing clients
      for (const client of mcpState.clients.values()) {
        try {
          await client.close();
        } catch (error) {
          logger.warn('Error closing client', error);
        }
      }
      mcpState.clients.clear();
      mcpState.tools = {};
      mcpState.toolsWithoutExecute = {};
      mcpState.toolsPerServer = {};
      mcpState.toolNamesToServerNames.clear();

      // Load configuration from user-managed mcp.json
      const currentConfig = await loadMcpConfig();
      mcpState.config = currentConfig;

      // Initialize servers based on loaded config
      for (const [serverName, serverConfig] of Object.entries(currentConfig.mcpServers)) {
        await initializeServer(serverName, serverConfig);
      }

      logger.info(`MCP refresh complete: ${Object.keys(mcpState.tools).length} tools available for chat`);
      return { 
        success: true, 
        serverTools: mcpState.toolsPerServer,
        totalTools: Object.keys(mcpState.tools).length
      };
    } catch (error) {
      logger.error("Failed to refresh MCP configuration", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Process tool calls (for chat integration)
  ipcMain.handle("mcp:process-tool-call", async (event, toolCall: any) => {
    try {
      return await processToolCall(toolCall);
    } catch (error) {
      logger.error("Failed to process tool call", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get all available MCP tools for AI models
  ipcMain.handle("mcp:get-tools-for-ai", async () => {
    try {
      const mcpState = (global as any).mcpState;
      if (!mcpState || !mcpState.tools) {
        return { success: false, error: 'No MCP tools available' };
      }

      const tools = Object.entries(mcpState.tools).map(([toolName, tool]: [string, any]) => ({
        name: toolName,
        description: tool.description || 'No description available',
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        serverName: mcpState.toolNamesToServerNames.get(toolName) || 'unknown'
      }));

      logger.info(`Returning ${tools.length} MCP tools for AI models`);
      return { 
        success: true, 
        tools,
        totalTools: tools.length,
        availableServers: Object.keys(mcpState.toolsPerServer || {})
      };
    } catch (error) {
      logger.error("Failed to get MCP tools for AI", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Execute a specific MCP tool
  ipcMain.handle("mcp:execute-tool", async (event, toolName: string, args: any) => {
    try {
      const mcpState = (global as any).mcpState;
      if (!mcpState || !mcpState.tools[toolName]) {
        return { success: false, error: `Tool ${toolName} not found` };
      }

      const tool = mcpState.tools[toolName];
      if (!tool.execute) {
        return { success: false, error: `Tool ${toolName} is not executable` };
      }

      logger.debug(`Executing MCP tool: ${toolName}`);
      const result = await tool.execute(args);
      
      return { success: true, result };
    } catch (error) {
      logger.error(`Failed to execute MCP tool ${toolName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  logger.info("MCP handlers registered successfully");
}

async function initializeServer(serverName: string, serverConfig: any): Promise<void> {
  const mcpState = (global as any).mcpState;

  try {
    logger.info(`Initializing MCP server: ${serverName}`);

    mcpState.toolsPerServer[serverName] = {
      status: 'checking',
      tools: [],
    };

    const transport = createTransport(serverConfig.transport);
    const client = await experimental_createMCPClient({ transport });

    mcpState.clients.set(serverName, client);

    // Get available tools
    const listToolsResult = await (client as any).listTools();
    const tools: Tool[] = (listToolsResult?.tools ?? []) as Tool[];

    logger.info(`Server ${serverName} provides ${tools.length} tools`);

    // Store tools with server mapping
    tools.forEach(tool => {
      const toolName = `${serverName}.${tool.name}`;
      mcpState.toolNamesToServerNames.set(toolName, serverName);

      // Tool with execute function
      mcpState.tools[toolName] = {
        name: toolName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (args: any) => {
          try {
            logger.debug(`Executing tool: ${toolName}`); // Use debug to avoid logging sensitive args
            const result = await (client as any).callTool({ name: tool.name, args });
            return result;
          } catch (error) {
            logger.error(`Tool execution failed: ${toolName}`, error);
            throw error;
          }
        },
      } as any; // Type assertion to bypass TypeScript limitation

      // Tool without execute function (for LLM)
      mcpState.toolsWithoutExecute[toolName] = {
        name: toolName,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    });

    mcpState.toolsPerServer[serverName] = {
      status: 'available',
      tools,
    };

    logger.info(`Successfully initialized MCP server: ${serverName}`);
  } catch (error) {
    logger.error(`Failed to initialize MCP server: ${serverName}`, error);
    mcpState.toolsPerServer[serverName] = {
      status: 'unavailable',
      tools: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function createTransport(transportConfig: any): any {
  switch (transportConfig.type) {
    case 'stdio':
      return createStdioTransport(transportConfig);
    case 'sse':
      // Validate SSE config
      if (!transportConfig.url) {
        throw new Error('SSE transport requires a url');
      }
      return {
        type: 'sse',
        url: transportConfig.url,
        headers: transportConfig.headers || {},
      };
    case 'streamable-http':
      // Not supported by AI SDK MCP client
      throw new Error('Unsupported transport type: streamable-http');
    default:
      throw new Error(`Unsupported transport type: ${transportConfig.type}`);
  }
}

function createStdioTransport(config: any): any {
  // Provide a custom transport that implements MCPTransport
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

// Normalize incoming config to our internal McpConfig shape
function normalizeMcpConfig(raw: any): McpConfig {
  try {
    const result: McpConfig = { mcpServers: {} } as McpConfig;
    for (const [name, serverConfig] of Object.entries<any>(raw?.mcpServers ?? {})) {
      // If already in internal format
      if (serverConfig && serverConfig.transport && serverConfig.transport.type) {
        result.mcpServers[name] = serverConfig;
        continue;
      }
      // Cursor-style: has transportType at top-level
      const transportType = serverConfig?.transportType;
      if (!transportType) {
        logger.warn(`Server ${name} missing transportType/transport; skipping normalization`);
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
      } else {
        throw new Error(`Unsupported transport type: ${transportType}`);
      }
    }
    return result;
  } catch (error) {
    logger.error('Failed to normalize MCP config', error);
    return { mcpServers: {} } as McpConfig;
  }
}

// Load MCP configuration from the user-managed mcp.json file
async function loadMcpConfig(): Promise<McpConfig> {
  try {
    logger.info(`Attempting to load MCP config from: ${MCP_CONFIG_PATH}`);
    if (!fs.existsSync(MCP_CONFIG_PATH)) {
      logger.warn(`MCP config file not found at ${MCP_CONFIG_PATH}. Creating a new one.`);
      // Create a default empty config file if it doesn't exist
      const defaultConfig: McpConfig = { mcpServers: {} };
      fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }

    const configContent = fs.readFileSync(MCP_CONFIG_PATH, 'utf-8');
    logger.info(`Successfully read MCP config file from ${MCP_CONFIG_PATH}`);
    
    const config = JSON.parse(configContent);
    logger.info(`Parsed MCP config with ${Object.keys(config.mcpServers || {}).length} servers.`);
    
    // Normalize the loaded config
    return normalizeMcpConfig(config);
  } catch (error) {
    logger.error(`Failed to load or parse MCP config from ${MCP_CONFIG_PATH}`, error);
    // Return empty config as fallback in case of errors
    return { mcpServers: {} };
  }
}

// Save MCP configuration to the user-managed mcp.json file
async function saveMcpConfig(config: McpConfig): Promise<void> {
  try {
    logger.info(`Saving MCP config to: ${MCP_CONFIG_PATH}`);
    // Ensure the directory exists
    const dirPath = path.dirname(MCP_CONFIG_PATH);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
    logger.info(`MCP config successfully saved to ${MCP_CONFIG_PATH}`);
  } catch (error) {
    logger.error(`Failed to save MCP config to ${MCP_CONFIG_PATH}`, error);
    throw error; // Re-throw to be caught by the IPC handler
  }
}

async function processToolCall(toolCall: any): Promise<any> {
  const mcpState = (global as any).mcpState;

  try {
    const { id: toolCallId, name: toolName } = toolCall.function;

    // Find which server this tool belongs to
    const serverName = mcpState.toolNamesToServerNames.get(toolName);

    if (!serverName) {
      logger.warn(`Could not find server for tool: ${toolName}`);
      return null;
    }

    const serverTools = mcpState.toolsPerServer[serverName];
    const tool = serverTools?.tools.find((t: any) => `${serverName}.${t.name}` === toolName);

    if (!tool) {
      logger.warn(`Could not find tool definition: ${toolName}`);
      return null;
    }

    // Create annotation for frontend processing
    const annotation = {
      type: 'toolCall',
      toolCallId,
      serverName,
      toolName: tool.name,
      toolDescription: tool.description || '',
    };

    logger.debug(`Processed tool call annotation: ${toolName}`);
    return annotation;
  } catch (error) {
    logger.error('Failed to process tool call', error);
    throw error;
  }
}

async function initializeMCPOnStartup() {
  const mcpState = (global as any).mcpState;
  
  logger.info('Starting MCP initialization on startup...');
  
  try {
    // Load configuration from user-managed mcp.json
    const currentConfig = await loadMcpConfig();
    mcpState.config = currentConfig;
    logger.info(`Loaded MCP config with ${Object.keys(currentConfig.mcpServers).length} servers.`);

    // Initialize servers based on loaded config
    for (const [serverName, serverConfig] of Object.entries(currentConfig.mcpServers)) {
      logger.info(`Initializing server: ${serverName}`);
      await initializeServer(serverName, serverConfig);
    }
    logger.info(`MCP startup complete: ${Object.keys(mcpState.tools).length} tools available for chat`);
  } catch (error) {
    logger.error('Failed to initialize MCP on startup', error);
    // Ensure state is clean if initialization fails
    mcpState.config = { mcpServers: {} };
    mcpState.clients.clear();
    mcpState.tools = {};
    mcpState.toolsWithoutExecute = {};
    mcpState.toolsPerServer = {};
    mcpState.toolNamesToServerNames.clear();
  }
  
  // Final status check
  logger.info(`Final MCP state: ${mcpState.clients.size} clients, ${Object.keys(mcpState.tools).length} tools`);
}
