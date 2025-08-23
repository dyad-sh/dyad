import { useCallback, useState, useEffect } from 'react';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  serverName: string;
}

export interface MCPToolsState {
  tools: MCPTool[];
  totalTools: number;
  availableServers: string[];
  isLoading: boolean;
  error: string | null;
}

export function useMCPTools() {
  const [state, setState] = useState<MCPToolsState>({
    tools: [],
    totalTools: 0,
    availableServers: [],
    isLoading: false,
    error: null,
  });

  const fetchTools = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      const result = await (window as any).electron.ipcRenderer.invoke('mcp:get-tools-for-ai');
      
      if (result.success) {
        setState({
          tools: result.tools || [],
          totalTools: result.totalTools || 0,
          availableServers: result.availableServers || [],
          isLoading: false,
          error: null,
        });
      } else {
        throw new Error(result.error || 'Failed to fetch MCP tools');
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, []);

  const executeTool = useCallback(async (toolName: string, args: any) => {
    try {
      const result = await (window as any).electron.ipcRenderer.invoke('mcp:execute-tool', toolName, args);
      
      if (result.success) {
        return result.result;
      } else {
        throw new Error(result.error || 'Tool execution failed');
      }
    } catch (error) {
      throw new Error(`Failed to execute tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const refreshTools = useCallback(() => {
    fetchTools();
  }, [fetchTools]);

  // Auto-fetch tools on mount
  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  return {
    ...state,
    fetchTools,
    executeTool,
    refreshTools,
  };
}
