/**
 * useModelDownload — TanStack Query hooks for Model Download Manager
 *
 * Wraps IpcClient model-manager methods with proper caching,
 * invalidation, and real-time progress tracking.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useCallback } from "react";
import { IpcClient } from "../ipc/ipc_client";
import { toast } from "sonner";

const ipc = IpcClient.getInstance();

// ── Query Keys ──

export const modelDownloadKeys = {
  all: ["model-download"] as const,
  hardware: () => [...modelDownloadKeys.all, "hardware"] as const,
  catalog: () => [...modelDownloadKeys.all, "catalog"] as const,
  filteredCatalog: () =>
    [...modelDownloadKeys.all, "filtered-catalog"] as const,
  installed: () => [...modelDownloadKeys.all, "installed"] as const,
  pullStatus: () => [...modelDownloadKeys.all, "pull-status"] as const,
};

// ── Queries ──

/** Detect system hardware (GPU, RAM, CPU) — cached until manual refetch */
export function useSystemHardware() {
  return useQuery({
    queryKey: modelDownloadKeys.hardware(),
    queryFn: () => ipc.modelManagerDetectHardware(),
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

/** Full model catalog (not filtered by hardware) */
export function useModelCatalog() {
  return useQuery({
    queryKey: modelDownloadKeys.catalog(),
    queryFn: () => ipc.modelManagerGetCatalog(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Model catalog annotated with hardware fit information */
export function useFilteredModelCatalog() {
  return useQuery({
    queryKey: modelDownloadKeys.filteredCatalog(),
    queryFn: () => ipc.modelManagerGetFilteredCatalog(),
    staleTime: 5 * 60 * 1000,
  });
}

/** List of locally-installed Ollama models */
export function useInstalledModels() {
  return useQuery({
    queryKey: modelDownloadKeys.installed(),
    queryFn: () => ipc.modelManagerListInstalled(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Mutations ──

/** Pull (download) a model from Ollama */
export function usePullModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelId: string) => ipc.modelManagerPullModel(modelId),
    onSuccess: (_data, modelId) => {
      toast.success(`Model "${modelId}" downloaded successfully`);
      queryClient.invalidateQueries({
        queryKey: modelDownloadKeys.installed(),
      });
    },
    onError: (error: Error, modelId) => {
      toast.error(`Failed to download "${modelId}": ${error.message}`);
    },
  });
}

/** Delete a model from Ollama */
export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelId: string) => ipc.modelManagerDeleteModel(modelId),
    onSuccess: (_data, modelId) => {
      toast.success(`Model "${modelId}" deleted`);
      queryClient.invalidateQueries({
        queryKey: modelDownloadKeys.installed(),
      });
    },
    onError: (error: Error, modelId) => {
      toast.error(`Failed to delete "${modelId}": ${error.message}`);
    },
  });
}

// ── Real-time Progress Hook ──

export interface PullProgress {
  modelId: string;
  progress: number;
  status: string;
  total?: number;
  completed?: number;
}

/**
 * Subscribe to real-time model pull progress events.
 * Returns a map of modelId → progress info, updated live.
 */
export function useModelPullProgress() {
  const [progressMap, setProgressMap] = useState<Record<string, PullProgress>>(
    {},
  );
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubProgress = ipc.onModelPullProgress((data) => {
      setProgressMap((prev) => ({
        ...prev,
        [data.modelId]: data,
      }));
    });

    const unsubComplete = ipc.onModelPullComplete((data) => {
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[data.modelId];
        return next;
      });
      queryClient.invalidateQueries({
        queryKey: modelDownloadKeys.installed(),
      });
    });

    return () => {
      unsubProgress();
      unsubComplete();
    };
  }, [queryClient]);

  const isDownloading = useCallback(
    (modelId: string) => modelId in progressMap,
    [progressMap],
  );

  const getProgress = useCallback(
    (modelId: string) => progressMap[modelId] ?? null,
    [progressMap],
  );

  return {
    progressMap,
    isDownloading,
    getProgress,
    activeDownloadCount: Object.keys(progressMap).length,
  };
}
