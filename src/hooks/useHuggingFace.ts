/**
 * HuggingFace Hub React Hooks
 * TanStack Query hooks for HF model/dataset search, download, and push
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import type {
  HfSearchParams,
  HfModelInfo,
  HfDatasetInfo,
  HfDownloadProgress,
} from "@/ipc/handlers/huggingface_handlers";
import { showError, showSuccess } from "@/lib/toast";

const ipc = IpcClient.getInstance();

// =============================================================================
// Query Keys
// =============================================================================

export const hfKeys = {
  all: ["huggingface"] as const,
  auth: () => [...hfKeys.all, "auth"] as const,
  models: (query: string, filter?: string) =>
    [...hfKeys.all, "models", query, filter] as const,
  datasets: (query: string, filter?: string) =>
    [...hfKeys.all, "datasets", query, filter] as const,
  modelInfo: (modelId: string) =>
    [...hfKeys.all, "model", modelId] as const,
};

// =============================================================================
// Auth
// =============================================================================

export function useHfAuthStatus() {
  return useQuery({
    queryKey: hfKeys.auth(),
    queryFn: () => ipc.hfAuthStatus(),
    staleTime: 5 * 60 * 1000,
  });
}

// =============================================================================
// Search
// =============================================================================

export function useHfSearchModels(
  query: string,
  options?: { filter?: string; limit?: number; enabled?: boolean },
) {
  return useQuery({
    queryKey: hfKeys.models(query, options?.filter),
    queryFn: () =>
      ipc.hfSearchModels({
        query,
        filter: options?.filter,
        limit: options?.limit ?? 20,
      }),
    enabled: (options?.enabled ?? true) && query.length > 0,
    staleTime: 30 * 1000,
  });
}

export function useHfSearchDatasets(
  query: string,
  options?: { filter?: string; limit?: number; enabled?: boolean },
) {
  return useQuery({
    queryKey: hfKeys.datasets(query, options?.filter),
    queryFn: () =>
      ipc.hfSearchDatasets({
        query,
        filter: options?.filter,
        limit: options?.limit ?? 20,
      }),
    enabled: (options?.enabled ?? true) && query.length > 0,
    staleTime: 30 * 1000,
  });
}

// =============================================================================
// Model Info
// =============================================================================

export function useHfModelInfo(modelId: string | null) {
  return useQuery({
    queryKey: hfKeys.modelInfo(modelId || ""),
    queryFn: () => ipc.hfModelInfo(modelId!),
    enabled: !!modelId,
    staleTime: 60 * 1000,
  });
}

// =============================================================================
// Download Model
// =============================================================================

export function useHfDownloadModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { modelId: string; files?: string[] }) =>
      ipc.hfDownloadModel(params),
    onSuccess: (result, variables) => {
      showSuccess(
        `Downloaded ${variables.modelId} (${result.files.length} files)`,
      );
      queryClient.invalidateQueries({ queryKey: hfKeys.all });
    },
    onError: (error: Error) => {
      showError(`Download failed: ${error.message}`);
    },
  });
}

// =============================================================================
// Download Dataset
// =============================================================================

export function useHfDownloadDataset() {
  return useMutation({
    mutationFn: (params: { datasetId: string; split?: string }) =>
      ipc.hfDownloadDataset(params),
    onSuccess: (_, variables) => {
      showSuccess(`Downloaded dataset ${variables.datasetId}`);
    },
    onError: (error: Error) => {
      showError(`Dataset download failed: ${error.message}`);
    },
  });
}

// =============================================================================
// Push Adapter
// =============================================================================

export function useHfPushAdapter() {
  return useMutation({
    mutationFn: (params: {
      adapterPath: string;
      repoId: string;
      commitMessage?: string;
    }) => ipc.hfPushAdapter(params),
    onSuccess: (result) => {
      showSuccess(`Adapter pushed to ${result.url}`);
    },
    onError: (error: Error) => {
      showError(`Push failed: ${error.message}`);
    },
  });
}

// =============================================================================
// Download Progress (event-based)
// =============================================================================

export function useHfDownloadProgress(): HfDownloadProgress | null {
  const [progress, setProgress] = useState<HfDownloadProgress | null>(null);

  useEffect(() => {
    const unsubscribe = ipc.onHfDownloadProgress((event) => {
      setProgress(event);
    });
    return unsubscribe;
  }, []);

  return progress;
}
