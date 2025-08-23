import { useAtom } from 'jotai';
import { useCallback } from 'react';
import type { McpConfig, McpSettings, MCPServerTools } from '../lib/services/mcpSchemas.js';
import {
  mcpSettingsAtom,
  mcpServerToolsAtom,
  mcpInitializedAtom,
  mcpErrorAtom,
  mcpUpdatingConfigAtom,
  mcpCheckingServersAtom,
  EXAMPLE_MCP_CONFIGS,
} from '../atoms/mcpAtoms.js';

export function useMCP() {
  const [settings, setSettings] = useAtom(mcpSettingsAtom);
  const [serverTools, setServerTools] = useAtom(mcpServerToolsAtom);
  const [isInitialized, setIsInitialized] = useAtom(mcpInitializedAtom);
  const [error, setError] = useAtom(mcpErrorAtom);
  const [isUpdatingConfig, setIsUpdatingConfig] = useAtom(mcpUpdatingConfigAtom);
  const [isCheckingServers, setIsCheckingServers] = useAtom(mcpCheckingServersAtom);

  const updateSettings = useCallback(async (newSettings: McpSettings) => {
    try {
      setIsUpdatingConfig(true);
      setError(null);

      // Use IPC to update MCP configuration in main process
      const result = await (window as any).electron.ipcRenderer.invoke('mcp:update-config', newSettings.mcpConfig);

      if (result.success) {
        setSettings(newSettings);
        setServerTools(result.serverTools);
        setIsInitialized(true);

        // Persist to localStorage
        localStorage.setItem('mcp_settings', JSON.stringify(newSettings));
      } else {
        throw new Error(result.error || 'Failed to update MCP configuration');
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update MCP settings';
      setError(errorMessage);
      console.error('MCP settings update failed:', err);
    } finally {
      setIsUpdatingConfig(false);
    }
  }, [setSettings, setServerTools, setIsInitialized, setError, setIsUpdatingConfig]);

  const checkServersAvailabilities = useCallback(async () => {
    try {
      setIsCheckingServers(true);
      setError(null);

      // Use IPC to check server availability in main process
      const result = await (window as any).electron.ipcRenderer.invoke('mcp:check-servers');

      if (result.success) {
        setServerTools(result.serverTools);
      } else {
        throw new Error(result.error || 'Failed to check MCP servers');
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check MCP servers';
      setError(errorMessage);
      console.error('MCP servers check failed:', err);
    } finally {
      setIsCheckingServers(false);
    }
  }, [setServerTools, setError, setIsCheckingServers]);

  const refreshMCP = useCallback(async () => {
    try {
      setIsUpdatingConfig(true);
      setError(null);
      const result = await (window as any).electron.ipcRenderer.invoke('mcp:refresh');
      if (result.success) {
        setServerTools(result.serverTools);
        setIsInitialized(true);
        console.log(`MCP refreshed successfully with ${result.totalTools} total tools`);
      } else {
        throw new Error(result.error || 'Failed to refresh MCP configuration');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh MCP configuration';
      setError(errorMessage);
      console.error('MCP refresh failed:', err);
    } finally {
      setIsUpdatingConfig(false);
    }
  }, []);

  const debugMCP = useCallback(async () => {
    try {
      const result = await (window as any).electron.ipcRenderer.invoke('mcp:debug');
      if (result.success) {
        console.log('MCP Debug Info:', result.state);
        return result.state;
      } else {
        throw new Error(result.error || 'Failed to get MCP debug info');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get MCP debug info';
      setError(errorMessage);
      console.error('MCP debug failed:', err);
    }
  }, [setError]);

  const loadExampleConfig = useCallback((configName: keyof typeof EXAMPLE_MCP_CONFIGS) => {
    const exampleConfig = EXAMPLE_MCP_CONFIGS[configName];
    const newSettings: McpSettings = {
      ...settings,
      mcpConfig: exampleConfig,
    };
    updateSettings(newSettings);
  }, [settings, updateSettings]);

  const initialize = useCallback(async () => {
    if (isInitialized) return;

    try {
      // First try to load from localStorage
      const savedSettings = localStorage.getItem('mcp_settings');
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        await updateSettings(parsedSettings);
      } else {
        // Try to load from Cursor's MCP config by passing empty config
        // The main process will automatically try to load Cursor config
        await updateSettings({
          mcpConfig: { mcpServers: {} }, // Empty config will trigger Cursor config loading
          maxLLMSteps: 10,
        });
      }
    } catch (err) {
      console.error('Failed to initialize MCP:', err);
      setIsInitialized(true);
    }
  }, [isInitialized, updateSettings, setIsInitialized]);

  const resetConfig = useCallback(async () => {
    const defaultSettings: McpSettings = {
      mcpConfig: { mcpServers: {} },
      maxLLMSteps: 10,
    };
    await updateSettings(defaultSettings);
    localStorage.removeItem('mcp_settings');
  }, [updateSettings]);

  return {
    // State
    settings,
    serverTools,
    isInitialized,
    error,
    isUpdatingConfig,
    isCheckingServers,

    // Actions
    updateSettings,
    checkServersAvailabilities,
    loadExampleConfig,
    initialize,
    resetConfig,
    refreshMCP,
    debugMCP,

    // Computed values
    totalToolsCount: Object.values(serverTools).reduce((total, server) => total + server.tools.length, 0),
    availableServersCount: Object.values(serverTools).filter(server => server.status === 'available').length,
    unavailableServersCount: Object.values(serverTools).filter(server => server.status === 'unavailable').length,
  };
}
