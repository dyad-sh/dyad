/**
 * usePlugins Hook
 * React hook for interacting with the plugin system
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { PluginSystemClient } from "@/ipc/plugin_system_client";
import type {
  PluginId,
  PluginTrust,
  InstalledPlugin,
  PluginRegistryEntry,
  PluginSearchQuery,
  PluginEvent,
} from "@/ipc/plugin_system_client";
import { toast } from "sonner";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const pluginKeys = {
  all: ["plugins"] as const,
  list: () => [...pluginKeys.all, "list"] as const,
  plugin: (id: PluginId) => [...pluginKeys.all, "plugin", id] as const,
  config: (id: PluginId) => [...pluginKeys.all, "config", id] as const,
  registry: () => [...pluginKeys.all, "registry"] as const,
  search: (query: PluginSearchQuery) => [...pluginKeys.registry(), "search", query] as const,
  registryPlugin: (id: string) => [...pluginKeys.registry(), "plugin", id] as const,
};

// =============================================================================
// INITIALIZATION HOOK
// =============================================================================

export function usePluginSystem() {
  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const queryClient = useQueryClient();

  const initializeMutation = useMutation({
    mutationFn: () => PluginSystemClient.initialize(),
    onSuccess: () => {
      setIsReady(true);
      toast.success("Plugin system initialized");
    },
    onError: (error) => {
      toast.error(`Failed to initialize plugin system: ${error}`);
    },
  });

  const shutdownMutation = useMutation({
    mutationFn: () => PluginSystemClient.shutdown(),
    onSuccess: () => {
      setIsReady(false);
      queryClient.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });

  const initialize = useCallback(async () => {
    if (isReady || isInitializing) return;
    setIsInitializing(true);
    try {
      await initializeMutation.mutateAsync();
      await PluginSystemClient.subscribe();
    } finally {
      setIsInitializing(false);
    }
  }, [isReady, isInitializing, initializeMutation]);

  // Event subscription
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = PluginSystemClient.onEvent((event: PluginEvent) => {
      switch (event.type) {
        case "plugin:installed":
          queryClient.invalidateQueries({ queryKey: pluginKeys.list() });
          toast.success(`Plugin installed: ${event.data?.manifest?.name || event.pluginId}`);
          break;
        case "plugin:uninstalled":
          queryClient.invalidateQueries({ queryKey: pluginKeys.list() });
          toast.info(`Plugin uninstalled: ${event.pluginId}`);
          break;
        case "plugin:enabled":
          queryClient.invalidateQueries({ queryKey: pluginKeys.plugin(event.pluginId!) });
          break;
        case "plugin:disabled":
          queryClient.invalidateQueries({ queryKey: pluginKeys.plugin(event.pluginId!) });
          break;
        case "plugin:updated":
          queryClient.invalidateQueries({ queryKey: pluginKeys.list() });
          toast.success(`Plugin updated from v${event.data?.oldVersion} to v${event.data?.newVersion}`);
          break;
        case "plugin:error":
          toast.error(`Plugin error: ${event.data?.message || "Unknown error"}`);
          break;
        case "plugin:message":
          const type = event.data?.type || "info";
          if (type === "error") {
            toast.error(event.data?.message);
          } else if (type === "warning") {
            toast.warning(event.data?.message);
          } else {
            toast.info(event.data?.message);
          }
          break;
      }
    });

    return unsubscribe;
  }, [isReady, queryClient]);

  return {
    isReady,
    isInitializing,
    initialize,
    shutdown: shutdownMutation.mutate,
  };
}

// =============================================================================
// INSTALLED PLUGINS HOOKS
// =============================================================================

export function useInstalledPlugins(enabled = true) {
  return useQuery({
    queryKey: pluginKeys.list(),
    queryFn: () => PluginSystemClient.listPlugins(),
    enabled,
    staleTime: 30000,
  });
}

export function usePlugin(id: PluginId | null) {
  return useQuery({
    queryKey: id ? pluginKeys.plugin(id) : pluginKeys.all,
    queryFn: () => (id ? PluginSystemClient.getPlugin(id) : null),
    enabled: !!id,
  });
}

export function usePluginConfig(id: PluginId | null) {
  return useQuery({
    queryKey: id ? pluginKeys.config(id) : pluginKeys.all,
    queryFn: () => (id ? PluginSystemClient.getPluginConfig(id) : null),
    enabled: !!id,
  });
}

// =============================================================================
// INSTALLATION HOOKS
// =============================================================================

export function useInstallPlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      source,
      value,
      trust,
    }: {
      source: "registry" | "url" | "file";
      value: string;
      trust?: PluginTrust;
    }) => {
      switch (source) {
        case "registry":
          return PluginSystemClient.installFromRegistry(value);
        case "url":
          return PluginSystemClient.installFromUrl(value, trust);
        case "file":
          return PluginSystemClient.installFromFile(value);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.list() });
    },
    onError: (error) => {
      toast.error(`Failed to install plugin: ${error}`);
    },
  });
}

export function useUninstallPlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: PluginId) => PluginSystemClient.uninstallPlugin(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.list() });
    },
    onError: (error) => {
      toast.error(`Failed to uninstall plugin: ${error}`);
    },
  });
}

export function useUpdatePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: PluginId) => PluginSystemClient.updatePlugin(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.plugin(id) });
      queryClient.invalidateQueries({ queryKey: pluginKeys.list() });
    },
    onError: (error) => {
      toast.error(`Failed to update plugin: ${error}`);
    },
  });
}

// =============================================================================
// LIFECYCLE HOOKS
// =============================================================================

export function useEnablePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: PluginId) => PluginSystemClient.enablePlugin(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.plugin(id) });
      toast.success("Plugin enabled");
    },
    onError: (error) => {
      toast.error(`Failed to enable plugin: ${error}`);
    },
  });
}

export function useDisablePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: PluginId) => PluginSystemClient.disablePlugin(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.plugin(id) });
      toast.info("Plugin disabled");
    },
    onError: (error) => {
      toast.error(`Failed to disable plugin: ${error}`);
    },
  });
}

// =============================================================================
// CONFIG HOOKS
// =============================================================================

export function useSetPluginConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, key, value }: { id: PluginId; key: string; value: unknown }) =>
      PluginSystemClient.setPluginConfig(id, key, value),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.config(id) });
    },
    onError: (error) => {
      toast.error(`Failed to update config: ${error}`);
    },
  });
}

// =============================================================================
// PERMISSIONS HOOKS
// =============================================================================

export function useGrantPermission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, permission }: { id: PluginId; permission: string }) =>
      PluginSystemClient.grantPermission(id, permission),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.plugin(id) });
    },
    onError: (error) => {
      toast.error(`Failed to grant permission: ${error}`);
    },
  });
}

export function useRevokePermission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, permission }: { id: PluginId; permission: string }) =>
      PluginSystemClient.revokePermission(id, permission),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.plugin(id) });
    },
    onError: (error) => {
      toast.error(`Failed to revoke permission: ${error}`);
    },
  });
}

// =============================================================================
// REGISTRY HOOKS
// =============================================================================

export function useRegistrySearch(query: PluginSearchQuery, enabled = true) {
  return useQuery({
    queryKey: pluginKeys.search(query),
    queryFn: () => PluginSystemClient.searchRegistry(query),
    enabled: enabled,
    staleTime: 60000, // 1 minute
  });
}

export function useRegistryPlugin(id: string | null) {
  return useQuery({
    queryKey: id ? pluginKeys.registryPlugin(id) : pluginKeys.registry(),
    queryFn: () => (id ? PluginSystemClient.getRegistryPlugin(id) : null),
    enabled: !!id,
    staleTime: 60000,
  });
}

// Re-export types
export type {
  PluginId,
  PluginTrust,
  InstalledPlugin,
  PluginRegistryEntry,
  PluginSearchQuery,
  PluginEvent,
};
