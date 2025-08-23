import { atom } from 'jotai';
import type { McpConfig, McpSettings, MCPServerTools } from '../lib/services/mcpSchemas.js';

// MCP Configuration Atom
export const mcpConfigAtom = atom<McpConfig>({
  mcpServers: {},
});

// MCP Settings Atom
export const mcpSettingsAtom = atom<McpSettings>({
  mcpConfig: {
    mcpServers: {},
  },
  maxLLMSteps: 10,
});

// MCP Server Tools Status Atom
export const mcpServerToolsAtom = atom<MCPServerTools>({});

// MCP Initialization Status Atom
export const mcpInitializedAtom = atom<boolean>(false);

// MCP Error State Atom
export const mcpErrorAtom = atom<string | null>(null);

// MCP Loading States
export const mcpUpdatingConfigAtom = atom<boolean>(false);
export const mcpCheckingServersAtom = atom<boolean>(false);

// Derived atoms for computed values
export const mcpTotalToolsCountAtom = atom<number>((get) => {
  const serverTools = get(mcpServerToolsAtom);
  return Object.values(serverTools).reduce((total, server) => total + server.tools.length, 0);
});

export const mcpAvailableServersCountAtom = atom<number>((get) => {
  const serverTools = get(mcpServerToolsAtom);
  return Object.values(serverTools).filter(server => server.status === 'available').length;
});

export const mcpUnavailableServersCountAtom = atom<number>((get) => {
  const serverTools = get(mcpServerToolsAtom);
  return Object.values(serverTools).filter(server => server.status === 'unavailable').length;
});

// Example MCP configurations for quick setup
export const EXAMPLE_MCP_CONFIGS = {
  everything: {
    mcpServers: {
      everything: {
        transport: {
          type: 'stdio' as const,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-everything'],
        },
      },
    },
  },
  filesystem: {
    mcpServers: {
      filesystem: {
        transport: {
          type: 'stdio' as const,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'],
        },
      },
    },
  },
  deepwiki: {
    mcpServers: {
      deepwiki: {
        transport: {
          type: 'streamable-http' as const,
          url: 'https://mcp.deepwiki.com/mcp',
        },
      },
    },
  },
};
