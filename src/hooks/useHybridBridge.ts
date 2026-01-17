/**
 * React Hooks for Hybrid Bridge
 * Provides seamless local/cloud integration with TanStack Query
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hybridBridgeClient } from "@/ipc/hybrid_bridge_client";
import type {
  HybridBridgeConfig,
  ServiceEndpoint,
  ServiceBridge,
  SyncState,
  HybridBridgeStatus,
  HybridBridgeEvent,
  ConnectionState,
  BridgeResponse,
} from "@/types/hybrid_bridge_types";

// Query keys
export const bridgeQueryKeys = {
  all: ["hybrid-bridge"] as const,
  status: () => [...bridgeQueryKeys.all, "status"] as const,
  config: () => [...bridgeQueryKeys.all, "config"] as const,
  services: () => [...bridgeQueryKeys.all, "services"] as const,
  syncState: () => [...bridgeQueryKeys.all, "sync-state"] as const,
  n8nHealth: () => [...bridgeQueryKeys.all, "n8n-health"] as const,
};

// ============================================================================
// Bridge Status Hook
// ============================================================================

export interface UseBridgeStatusOptions {
  /** Polling interval in ms (0 to disable) */
  refetchInterval?: number;
  /** Enable/disable the query */
  enabled?: boolean;
}

export function useBridgeStatus(options: UseBridgeStatusOptions = {}) {
  const { refetchInterval = 5000, enabled = true } = options;

  return useQuery({
    queryKey: bridgeQueryKeys.status(),
    queryFn: () => hybridBridgeClient.getStatus(),
    refetchInterval: refetchInterval > 0 ? refetchInterval : false,
    enabled,
    staleTime: 2000,
  });
}

// ============================================================================
// Bridge Events Hook
// ============================================================================

export interface UseBridgeEventsOptions {
  /** Event types to listen for */
  eventTypes?: (HybridBridgeEvent["type"] | "*")[];
  /** Callback for events */
  onEvent?: (event: HybridBridgeEvent) => void;
}

export function useBridgeEvents(options: UseBridgeEventsOptions = {}) {
  const { eventTypes = ["*"], onEvent } = options;
  const [lastEvent, setLastEvent] = useState<HybridBridgeEvent | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    for (const eventType of eventTypes) {
      const unsub = hybridBridgeClient.on(eventType, (event) => {
        setLastEvent(event);
        onEvent?.(event);

        // Update connection state on connection events
        if (event.type === "connection:changed") {
          setConnectionState(event.state);
        }

        // Invalidate queries on relevant events
        switch (event.type) {
          case "connection:changed":
          case "n8n:started":
          case "n8n:stopped":
          case "n8n:restarting":
          case "n8n:error":
            queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.status() });
            break;
          case "sync:completed":
          case "sync:error":
            queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.syncState() });
            break;
          case "service:connected":
          case "service:disconnected":
            queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.services() });
            break;
        }
      });
      unsubscribers.push(unsub);
    }

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [eventTypes, onEvent, queryClient]);

  return { lastEvent, connectionState };
}

// ============================================================================
// Bridge Control Hook
// ============================================================================

export function useBridgeControl() {
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: (config?: Partial<HybridBridgeConfig>) => hybridBridgeClient.start(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.all });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => hybridBridgeClient.stop(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.all });
    },
  });

  const autoStartMutation = useMutation({
    mutationFn: ({
      config,
      maxRetries,
    }: {
      config?: Partial<HybridBridgeConfig>;
      maxRetries?: number;
    }) => hybridBridgeClient.autoStart(config, maxRetries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.all });
    },
  });

  return {
    start: startMutation.mutateAsync,
    stop: stopMutation.mutateAsync,
    autoStart: autoStartMutation.mutateAsync,
    isStarting: startMutation.isPending || autoStartMutation.isPending,
    isStopping: stopMutation.isPending,
    startError: startMutation.error,
    stopError: stopMutation.error,
  };
}

// ============================================================================
// Bridge Config Hook
// ============================================================================

export function useBridgeConfig() {
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: bridgeQueryKeys.config(),
    queryFn: () => hybridBridgeClient.getConfig(),
    staleTime: 30000,
  });

  const updateMutation = useMutation({
    mutationFn: (config: Partial<HybridBridgeConfig>) => hybridBridgeClient.updateConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.config() });
    },
  });

  return {
    config: configQuery.data,
    isLoading: configQuery.isLoading,
    error: configQuery.error,
    updateConfig: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error,
  };
}

// ============================================================================
// Services Hook
// ============================================================================

export function useBridgeServices() {
  const queryClient = useQueryClient();

  const servicesQuery = useQuery({
    queryKey: bridgeQueryKeys.services(),
    queryFn: () => hybridBridgeClient.listServices(),
    staleTime: 10000,
  });

  const addMutation = useMutation({
    mutationFn: (endpoint: ServiceEndpoint) => hybridBridgeClient.addService(endpoint),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.services() });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (serviceId: string) => hybridBridgeClient.removeService(serviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.services() });
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: (serviceId: string) => hybridBridgeClient.reconnectService(serviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.services() });
    },
  });

  return {
    services: servicesQuery.data ?? [],
    isLoading: servicesQuery.isLoading,
    error: servicesQuery.error,
    addService: addMutation.mutateAsync,
    removeService: removeMutation.mutateAsync,
    reconnectService: reconnectMutation.mutateAsync,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
    isReconnecting: reconnectMutation.isPending,
  };
}

// ============================================================================
// Sync Hook
// ============================================================================

export function useBridgeSync() {
  const queryClient = useQueryClient();

  const syncStateQuery = useQuery({
    queryKey: bridgeQueryKeys.syncState(),
    queryFn: () => hybridBridgeClient.getSyncState(),
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const triggerSyncMutation = useMutation({
    mutationFn: () => hybridBridgeClient.triggerSync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.syncState() });
    },
  });

  const clearErrorsMutation = useMutation({
    mutationFn: () => hybridBridgeClient.clearSyncErrors(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.syncState() });
    },
  });

  return {
    syncState: syncStateQuery.data,
    isLoading: syncStateQuery.isLoading,
    error: syncStateQuery.error,
    triggerSync: triggerSyncMutation.mutateAsync,
    clearErrors: clearErrorsMutation.mutateAsync,
    isSyncing: triggerSyncMutation.isPending,
    isClearingErrors: clearErrorsMutation.isPending,
  };
}

// ============================================================================
// n8n Health Hook
// ============================================================================

export function useN8nHealth(options: { refetchInterval?: number; enabled?: boolean } = {}) {
  const { refetchInterval = 10000, enabled = true } = options;
  const queryClient = useQueryClient();

  const healthQuery = useQuery({
    queryKey: bridgeQueryKeys.n8nHealth(),
    queryFn: () => hybridBridgeClient.checkN8nHealth(),
    refetchInterval: refetchInterval > 0 ? refetchInterval : false,
    enabled,
    staleTime: 5000,
  });

  const restartMutation = useMutation({
    mutationFn: () => hybridBridgeClient.restartN8n(),
    onSuccess: () => {
      // Wait a bit for n8n to restart before refetching
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.n8nHealth() });
        queryClient.invalidateQueries({ queryKey: bridgeQueryKeys.status() });
      }, 3000);
    },
  });

  return {
    isHealthy: healthQuery.data?.healthy ?? false,
    health: healthQuery.data?.health,
    isLoading: healthQuery.isLoading,
    error: healthQuery.error,
    restart: restartMutation.mutateAsync,
    isRestarting: restartMutation.isPending,
    restartError: restartMutation.error,
  };
}

// ============================================================================
// Bridge Request Hook
// ============================================================================

export interface UseBridgeRequestOptions {
  /** Prefer local or cloud execution */
  routePreference?: "local" | "cloud" | "auto";
  /** Timeout in ms */
  timeout?: number;
  /** Retry on failure */
  retry?: boolean;
}

export function useBridgeRequest<TData = any, TVariables = any>(
  service: string,
  operation: string,
  options: UseBridgeRequestOptions = {}
) {
  const { routePreference = "auto", timeout, retry } = options;

  return useMutation({
    mutationFn: async (variables: TVariables): Promise<BridgeResponse & { data?: TData }> => {
      return hybridBridgeClient.request<TData>(service, operation, variables, {
        routePreference,
        timeout,
        retries: retry ? 3 : 0,
      });
    },
  });
}

// ============================================================================
// Combined Bridge Hook
// ============================================================================

export interface UseHybridBridgeOptions {
  /** Auto-start bridge on mount */
  autoStart?: boolean;
  /** Auto-start configuration */
  config?: Partial<HybridBridgeConfig>;
  /** Event callback */
  onEvent?: (event: HybridBridgeEvent) => void;
}

export function useHybridBridge(options: UseHybridBridgeOptions = {}) {
  const { autoStart = false, config, onEvent } = options;

  const status = useBridgeStatus();
  const control = useBridgeControl();
  const events = useBridgeEvents({ onEvent });
  const n8nHealth = useN8nHealth();

  // Auto-start on mount
  useEffect(() => {
    if (autoStart && status.data?.n8n?.running === false) {
      control.autoStart({ config });
    }
  }, [autoStart]); // Only run on mount

  const isConnected = useMemo(() => {
    return status.data?.n8n?.running === true || events.connectionState === "connected";
  }, [status.data?.n8n?.running, events.connectionState]);

  const isHealthy = useMemo(() => {
    return isConnected && n8nHealth.isHealthy;
  }, [isConnected, n8nHealth.isHealthy]);

  return {
    // Status
    status: status.data,
    isLoading: status.isLoading,
    isConnected,
    isHealthy,
    connectionState: events.connectionState,

    // Control
    start: control.start,
    stop: control.stop,
    autoStartBridge: control.autoStart,
    isStarting: control.isStarting,
    isStopping: control.isStopping,

    // n8n
    n8nHealth: n8nHealth.health,
    restartN8n: n8nHealth.restart,
    isN8nRestarting: n8nHealth.isRestarting,

    // Events
    lastEvent: events.lastEvent,

    // Errors
    error: status.error || control.startError || control.stopError,
  };
}

// ============================================================================
// Connection Status Component Helper
// ============================================================================

export interface ConnectionStatusInfo {
  state: ConnectionState;
  label: string;
  color: "green" | "yellow" | "red" | "gray";
  isActive: boolean;
  canReconnect: boolean;
}

export function getConnectionStatusInfo(state: ConnectionState): ConnectionStatusInfo {
  switch (state) {
    case "connected":
      return {
        state,
        label: "Connected",
        color: "green",
        isActive: true,
        canReconnect: false,
      };
    case "connecting":
      return {
        state,
        label: "Connecting...",
        color: "yellow",
        isActive: true,
        canReconnect: false,
      };
    case "reconnecting":
      return {
        state,
        label: "Reconnecting...",
        color: "yellow",
        isActive: true,
        canReconnect: false,
      };
    case "disconnected":
      return {
        state,
        label: "Disconnected",
        color: "gray",
        isActive: false,
        canReconnect: true,
      };
    case "error":
      return {
        state,
        label: "Error",
        color: "red",
        isActive: false,
        canReconnect: true,
      };
    default:
      return {
        state: "disconnected",
        label: "Unknown",
        color: "gray",
        isActive: false,
        canReconnect: true,
      };
  }
}
