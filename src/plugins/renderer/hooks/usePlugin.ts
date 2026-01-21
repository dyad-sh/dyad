/**
 * Generic Plugin Hook
 *
 * Provides a generic interface for interacting with plugins from React components.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "../../../ipc/ipc_client";
import type { PluginId } from "../../types";

// ─────────────────────────────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate a query key for a plugin operation.
 */
export function pluginQueryKey(
  pluginId: PluginId,
  operation: string,
  ...params: unknown[]
): readonly unknown[] {
  return [pluginId, operation, ...params] as const;
}

// ─────────────────────────────────────────────────────────────────────
// Generic Plugin Hooks
// ─────────────────────────────────────────────────────────────────────

export interface UsePluginQueryOptions<TData> {
  pluginId: PluginId;
  operation: string;
  params?: unknown;
  enabled?: boolean;
  queryKeyParams?: unknown[];
}

/**
 * Generic hook for plugin queries.
 * Wraps plugin IPC calls in TanStack Query.
 */
export function usePluginQuery<TData>(options: UsePluginQueryOptions<TData>) {
  const { pluginId, operation, params, enabled = true, queryKeyParams = [] } = options;
  const channel = `${pluginId}:${operation}`;

  return useQuery<TData, Error>({
    queryKey: pluginQueryKey(pluginId, operation, ...queryKeyParams),
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke(channel, params);
    },
    enabled,
    meta: { showErrorToast: true },
  });
}

export interface UsePluginMutationOptions<TData, TVariables> {
  pluginId: PluginId;
  operation: string;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: Error, variables: TVariables) => void;
  invalidateQueries?: Array<{ pluginId: PluginId; operation: string; params?: unknown[] }>;
}

/**
 * Generic hook for plugin mutations.
 * Wraps plugin IPC calls in TanStack Mutation.
 */
export function usePluginMutation<TData = void, TVariables = unknown>(
  options: UsePluginMutationOptions<TData, TVariables>,
) {
  const { pluginId, operation, onSuccess, onError, invalidateQueries } = options;
  const queryClient = useQueryClient();
  const channel = `${pluginId}:${operation}`;

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke(channel, variables);
    },
    onSuccess: (data, variables) => {
      // Invalidate specified queries
      if (invalidateQueries) {
        for (const query of invalidateQueries) {
          queryClient.invalidateQueries({
            queryKey: pluginQueryKey(query.pluginId, query.operation, ...(query.params ?? [])),
          });
        }
      }
      onSuccess?.(data, variables);
    },
    onError,
    meta: { showErrorToast: true },
  });
}
