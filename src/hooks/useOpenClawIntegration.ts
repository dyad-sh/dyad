/**
 * React Hooks for OpenClaw Personal AI Assistant
 * 
 * Provides easy-to-use hooks for integrating OpenClaw into JoyCreate's UI.
 * OpenClaw is the central nervous system - handling multi-channel messaging,
 * AI agents with thinking levels, memory search, and plugin management.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { openClawIntegrationClient } from "@/ipc/openclaw_integration_client";
import type {
  OpenClawChannel,
  OpenClawThinkingLevel,
  OpenClawGatewayStatus,
  OpenClawHealthStatus,
  OpenClawAgentRequest,
  OpenClawAgentResponse,
  OpenClawMessageRequest,
  OpenClawMessageResponse,
  OpenClawBroadcastRequest,
  OpenClawMemorySearchRequest,
  OpenClawMemoryResult,
  OpenClawPlugin,
  OpenClawIntegrationConfig,
  OpenClawChannelStatus,
} from "@/lib/openclaw_integration";

// Re-export types for convenience  
export interface OpenClawToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  duration?: number;
}

// =============================================================================
// QUERY KEYS
// =============================================================================

export const OPENCLAW_QUERY_KEYS = {
  connection: ["openclaw", "connection"],
  gatewayStatus: ["openclaw", "gateway", "status"],
  gatewayHealth: ["openclaw", "gateway", "health"],
  config: ["openclaw", "config"],
  channels: ["openclaw", "channels"],
  plugins: ["openclaw", "plugins"],
  memory: ["openclaw", "memory"],
} as const;

// =============================================================================
// CONNECTION & STATUS HOOKS
// =============================================================================

type ConnectionStatusType = "connected" | "disconnected" | "connecting" | "error";

/**
 * Hook for OpenClaw connection status
 */
export function useOpenClawConnection() {
  const queryClient = useQueryClient();

  const { data: connectionStatus, isLoading } = useQuery({
    queryKey: OPENCLAW_QUERY_KEYS.connection,
    queryFn: async (): Promise<{ connected: boolean; status: ConnectionStatusType }> => {
      const result = await openClawIntegrationClient.getConnectionStatus();
      return result;
    },
    refetchInterval: 5000,
  });

  // Listen for connection events
  useEffect(() => {
    const unsubConnected = openClawIntegrationClient.onConnected(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.connection });
    });

    const unsubDisconnected = openClawIntegrationClient.onDisconnected(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.connection });
    });

    const unsubError = openClawIntegrationClient.onError(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.connection });
    });

    return () => {
      unsubConnected?.();
      unsubDisconnected?.();
      unsubError?.();
    };
  }, [queryClient]);

  return {
    isConnected: connectionStatus?.connected ?? false,
    status: connectionStatus?.status ?? "disconnected",
    isLoading,
  };
}

/**
 * Hook for OpenClaw Gateway status
 */
export function useOpenClawGatewayStatus() {
  const queryClient = useQueryClient();

  const { data: status, isLoading, error } = useQuery<OpenClawGatewayStatus | null>({
    queryKey: OPENCLAW_QUERY_KEYS.gatewayStatus,
    queryFn: () => openClawIntegrationClient.getGatewayStatus(),
    refetchInterval: 10000,
  });

  // Listen for gateway events
  useEffect(() => {
    const unsubStarted = openClawIntegrationClient.onGatewayStarted(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.gatewayStatus });
    });

    const unsubStopped = openClawIntegrationClient.onGatewayStopped(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.gatewayStatus });
    });

    const unsubRestarted = openClawIntegrationClient.onGatewayRestarted(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.gatewayStatus });
    });

    return () => {
      unsubStarted?.();
      unsubStopped?.();
      unsubRestarted?.();
    };
  }, [queryClient]);

  const startMutation = useMutation({
    mutationFn: () => openClawIntegrationClient.startGateway(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.gatewayStatus });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => openClawIntegrationClient.stopGateway(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.gatewayStatus });
    },
  });

  const restartMutation = useMutation({
    mutationFn: () => openClawIntegrationClient.restartGateway(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.gatewayStatus });
    },
  });

  return {
    status,
    isLoading,
    error,
    isRunning: status?.running ?? false,
    start: startMutation.mutate,
    stop: stopMutation.mutate,
    restart: restartMutation.mutate,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
    isRestarting: restartMutation.isPending,
  };
}

/**
 * Hook for OpenClaw Gateway health
 */
export function useOpenClawGatewayHealth() {
  const { data: health, isLoading } = useQuery<OpenClawHealthStatus | null>({
    queryKey: OPENCLAW_QUERY_KEYS.gatewayHealth,
    queryFn: () => openClawIntegrationClient.getGatewayHealth(),
    refetchInterval: 30000,
  });

  return {
    health,
    isLoading,
    isHealthy: health?.gateway === "healthy",
    isDegraded: health?.gateway === "degraded",
    isUnhealthy: health?.gateway === "unhealthy",
  };
}

// =============================================================================
// CONFIGURATION HOOKS
// =============================================================================

/**
 * Hook for OpenClaw configuration
 */
export function useOpenClawConfig() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery<OpenClawIntegrationConfig>({
    queryKey: OPENCLAW_QUERY_KEYS.config,
    queryFn: () => openClawIntegrationClient.getConfig(),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<OpenClawIntegrationConfig>) =>
      openClawIntegrationClient.updateConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.config });
    },
  });

  return {
    config,
    isLoading,
    updateConfig: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

// =============================================================================
// AGENT HOOKS
// =============================================================================

interface UseOpenClawAgentOptions {
  onThinking?: (thinking: string) => void;
  onToolCall?: (tool: OpenClawToolCall) => void;
  onChunk?: (chunk: string) => void;
}

/**
 * Hook for running OpenClaw agent tasks
 */
export function useOpenClawAgent(options?: UseOpenClawAgentOptions) {
  const [isThinking, setIsThinking] = useState(false);
  const [currentThinking, setCurrentThinking] = useState<string>("");
  const [toolCalls, setToolCalls] = useState<OpenClawToolCall[]>([]);

  // Listen for agent events
  useEffect(() => {
    const unsubThinking = openClawIntegrationClient.onAgentThinking((data) => {
      setCurrentThinking(data.content);
      setIsThinking(true);
      options?.onThinking?.(data.content);
    });

    const unsubToolCall = openClawIntegrationClient.onAgentToolCall((data) => {
      const tool = data as OpenClawToolCall;
      setToolCalls((prev) => [...prev, tool]);
      options?.onToolCall?.(tool);
    });

    const unsubResponse = openClawIntegrationClient.onAgentResponse((data) => {
      options?.onChunk?.(data.content);
    });

    const unsubCompleted = openClawIntegrationClient.onAgentCompleted(() => {
      setIsThinking(false);
    });

    return () => {
      unsubThinking?.();
      unsubToolCall?.();
      unsubResponse?.();
      unsubCompleted?.();
    };
  }, [options]);

  const runMutation = useMutation({
    mutationFn: (request: OpenClawAgentRequest) => 
      openClawIntegrationClient.runAgent(request),
    onMutate: () => {
      setIsThinking(true);
      setCurrentThinking("");
      setToolCalls([]);
    },
    onSettled: () => {
      setIsThinking(false);
    },
  });

  const runAgent = useCallback(
    (message: string, opts?: Partial<Omit<OpenClawAgentRequest, "message">>) => {
      return runMutation.mutateAsync({ message, ...opts });
    },
    [runMutation]
  );

  return {
    runAgent,
    isRunning: runMutation.isPending,
    isThinking,
    currentThinking,
    toolCalls,
    lastResponse: runMutation.data,
    error: runMutation.error,
    reset: () => {
      runMutation.reset();
      setCurrentThinking("");
      setToolCalls([]);
    },
  };
}

/**
 * Simplified hook for quick agent interactions
 */
export function useOpenClawChat(defaultThinking: OpenClawThinkingLevel = "medium") {
  const [messages, setMessages] = useState<Array<{
    role: "user" | "assistant";
    content: string;
    thinking?: string;
    toolCalls?: OpenClawToolCall[];
  }>>([]);

  const { runAgent, isRunning, isThinking, currentThinking, toolCalls } = useOpenClawAgent();

  const sendMessage = useCallback(
    async (content: string, thinking?: OpenClawThinkingLevel) => {
      // Add user message
      setMessages((prev) => [...prev, { role: "user", content }]);

      try {
        const response = await runAgent(content, { thinking: thinking ?? defaultThinking });

        // Add assistant message
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: response.reply,
            thinking: response.thinking,
            toolCalls: response.toolCalls,
          },
        ]);

        return response;
      } catch (error) {
        // Remove the user message on error
        setMessages((prev) => prev.slice(0, -1));
        throw error;
      }
    },
    [runAgent, defaultThinking]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    sendMessage,
    clearMessages,
    isRunning,
    isThinking,
    currentThinking,
    toolCalls,
  };
}

// =============================================================================
// MESSAGING HOOKS
// =============================================================================

/**
 * Hook for sending messages via OpenClaw channels
 */
export function useOpenClawMessaging() {
  const sendMutation = useMutation({
    mutationFn: (request: OpenClawMessageRequest) =>
      openClawIntegrationClient.sendMessage(request),
  });

  const broadcastMutation = useMutation({
    mutationFn: (request: OpenClawBroadcastRequest) =>
      openClawIntegrationClient.broadcastMessage(request),
  });

  const readMutation = useMutation({
    mutationFn: ({
      target,
      channel,
      limit,
    }: {
      target: string;
      channel?: OpenClawChannel;
      limit?: number;
    }) => openClawIntegrationClient.readMessages(target, channel, limit),
  });

  return {
    sendMessage: sendMutation.mutate,
    sendMessageAsync: sendMutation.mutateAsync,
    isSending: sendMutation.isPending,
    sendError: sendMutation.error,

    broadcastMessage: broadcastMutation.mutate,
    broadcastMessageAsync: broadcastMutation.mutateAsync,
    isBroadcasting: broadcastMutation.isPending,
    broadcastError: broadcastMutation.error,

    readMessages: readMutation.mutateAsync,
    isReading: readMutation.isPending,
    readError: readMutation.error,
  };
}

/**
 * Hook for listening to incoming messages
 */
export function useOpenClawIncomingMessages(
  onMessage?: (message: unknown) => void
) {
  const [messages, setMessages] = useState<unknown[]>([]);

  useEffect(() => {
    const unsub = openClawIntegrationClient.onMessageReceived((data) => {
      setMessages((prev) => [...prev, data]);
      onMessage?.(data);
    });

    return () => unsub?.();
  }, [onMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    clearMessages,
    messageCount: messages.length,
  };
}

// =============================================================================
// CHANNEL HOOKS
// =============================================================================

/**
 * Hook for managing OpenClaw channels
 */
export function useOpenClawChannels() {
  const queryClient = useQueryClient();

  const { data: channels, isLoading } = useQuery<OpenClawChannelStatus[]>({
    queryKey: OPENCLAW_QUERY_KEYS.channels,
    queryFn: () => openClawIntegrationClient.getChannels(),
    refetchInterval: 30000,
  });

  // Listen for channel events
  useEffect(() => {
    const unsubConnected = openClawIntegrationClient.onChannelConnected(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.channels });
    });

    const unsubDisconnected = openClawIntegrationClient.onChannelDisconnected(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.channels });
    });

    return () => {
      unsubConnected?.();
      unsubDisconnected?.();
    };
  }, [queryClient]);

  const configureMutation = useMutation({
    mutationFn: (channel: OpenClawChannel) =>
      openClawIntegrationClient.configureChannel(channel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.channels });
    },
  });

  const connectedChannels = channels?.filter((c) => c.connected) ?? [];
  const disconnectedChannels = channels?.filter((c) => !c.connected) ?? [];

  return {
    channels,
    connectedChannels,
    disconnectedChannels,
    isLoading,
    configureChannel: configureMutation.mutate,
    isConfiguring: configureMutation.isPending,
  };
}

// =============================================================================
// MEMORY HOOKS
// =============================================================================

/**
 * Hook for searching OpenClaw memory
 */
export function useOpenClawMemory() {
  const searchMutation = useMutation({
    mutationFn: (request: OpenClawMemorySearchRequest) =>
      openClawIntegrationClient.searchMemory(request),
  });

  return {
    search: searchMutation.mutate,
    searchAsync: searchMutation.mutateAsync,
    isSearching: searchMutation.isPending,
    results: searchMutation.data,
    error: searchMutation.error,
    reset: searchMutation.reset,
  };
}

// =============================================================================
// PLUGIN HOOKS
// =============================================================================

/**
 * Hook for managing OpenClaw plugins
 */
export function useOpenClawPlugins() {
  const queryClient = useQueryClient();

  const { data: plugins, isLoading } = useQuery<OpenClawPlugin[]>({
    queryKey: OPENCLAW_QUERY_KEYS.plugins,
    queryFn: () => openClawIntegrationClient.listPlugins(),
  });

  // Listen for plugin events
  useEffect(() => {
    const unsubInstalled = openClawIntegrationClient.onPluginInstalled(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.plugins });
    });

    const unsubUninstalled = openClawIntegrationClient.onPluginUninstalled(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.plugins });
    });

    const unsubEnabled = openClawIntegrationClient.onPluginEnabled(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.plugins });
    });

    const unsubDisabled = openClawIntegrationClient.onPluginDisabled(() => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.plugins });
    });

    return () => {
      unsubInstalled?.();
      unsubUninstalled?.();
      unsubEnabled?.();
      unsubDisabled?.();
    };
  }, [queryClient]);

  const installMutation = useMutation({
    mutationFn: (pluginId: string) => openClawIntegrationClient.installPlugin(pluginId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.plugins });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (pluginId: string) => openClawIntegrationClient.uninstallPlugin(pluginId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.plugins });
    },
  });

  const enableMutation = useMutation({
    mutationFn: (pluginId: string) => openClawIntegrationClient.enablePlugin(pluginId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.plugins });
    },
  });

  const disableMutation = useMutation({
    mutationFn: (pluginId: string) => openClawIntegrationClient.disablePlugin(pluginId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.plugins });
    },
  });

  const enabledPlugins = plugins?.filter((p) => p.enabled) ?? [];
  const disabledPlugins = plugins?.filter((p) => !p.enabled) ?? [];

  return {
    plugins,
    enabledPlugins,
    disabledPlugins,
    isLoading,

    installPlugin: installMutation.mutate,
    isInstalling: installMutation.isPending,

    uninstallPlugin: uninstallMutation.mutate,
    isUninstalling: uninstallMutation.isPending,

    enablePlugin: enableMutation.mutate,
    isEnabling: enableMutation.isPending,

    disablePlugin: disableMutation.mutate,
    isDisabling: disableMutation.isPending,
  };
}

// =============================================================================
// DIAGNOSTICS HOOKS
// =============================================================================

/**
 * Hook for OpenClaw diagnostics
 */
export function useOpenClawDoctor() {
  const doctorMutation = useMutation({
    mutationFn: () => openClawIntegrationClient.runDoctor(),
  });

  return {
    runDoctor: doctorMutation.mutate,
    runDoctorAsync: doctorMutation.mutateAsync,
    isRunning: doctorMutation.isPending,
    results: doctorMutation.data,
    error: doctorMutation.error,
  };
}

// =============================================================================
// COMPOSITE HOOKS
// =============================================================================

/**
 * All-in-one hook for OpenClaw status and basic operations
 */
export function useOpenClawIntegration() {
  const connection = useOpenClawConnection();
  const gateway = useOpenClawGatewayStatus();
  const health = useOpenClawGatewayHealth();
  const config = useOpenClawConfig();

  return {
    // Connection
    isConnected: connection.isConnected,
    connectionStatus: connection.status,
    
    // Gateway
    gatewayStatus: gateway.status,
    isGatewayRunning: gateway.isRunning,
    startGateway: gateway.start,
    stopGateway: gateway.stop,
    restartGateway: gateway.restart,
    
    // Health
    health: health.health,
    isHealthy: health.isHealthy,
    
    // Config
    config: config.config,
    updateConfig: config.updateConfig,
    
    // Loading states
    isLoading: connection.isLoading || gateway.isLoading || health.isLoading || config.isLoading,
  };
}
