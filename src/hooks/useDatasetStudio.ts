/**
 * Dataset Studio Hooks
 * TanStack Query hooks for Dataset Studio operations
 * Integrates with the dataset studio IPC client for local-first dataset creation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDatasetStudioClient } from "@/ipc/dataset_studio_client";
import type {
  DatasetItem,
  DatasetManifest,
  ProvenanceRecord,
  GenerationJob,
  P2pSyncState,
  StudioDataset,
} from "@/ipc/dataset_studio_client";
import { toast } from "sonner";

// Get the client instance
const client = () => getDatasetStudioClient();

// Query Keys
export const datasetStudioKeys = {
  all: ["dataset-studio"] as const,
  datasets: () => [...datasetStudioKeys.all, "datasets"] as const,
  dataset: (id: string) => [...datasetStudioKeys.all, "dataset", id] as const,
  items: (datasetId: string) => [...datasetStudioKeys.all, "items", datasetId] as const,
  item: (itemId: string) => [...datasetStudioKeys.all, "item", itemId] as const,
  manifest: (datasetId: string) => [...datasetStudioKeys.all, "manifest", datasetId] as const,
  jobs: (datasetId: string) => [...datasetStudioKeys.all, "jobs", datasetId] as const,
  jobStatus: (jobId: string) => [...datasetStudioKeys.all, "job-status", jobId] as const,
  p2pStatus: (datasetId: string) => [...datasetStudioKeys.all, "p2p-status", datasetId] as const,
  content: (contentHash: string) => [...datasetStudioKeys.all, "content", contentHash] as const,
};

// ==================== DATASET QUERIES ====================

/**
 * Hook to list all Studio datasets
 */
export function useStudioDatasets(options?: {
  datasetType?: string;
  publishStatus?: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: datasetStudioKeys.datasets(),
    queryFn: () => client().listDatasets({
      datasetType: options?.datasetType,
      publishStatus: options?.publishStatus,
    }),
    enabled: options?.enabled ?? true,
  });
}

/**
 * Hook to get a single dataset by ID
 */
export function useStudioDataset(datasetId: string, enabled = true) {
  return useQuery({
    queryKey: datasetStudioKeys.dataset(datasetId),
    queryFn: () => client().getDataset(datasetId),
    enabled,
  });
}

// ==================== DATASET MUTATIONS ====================

/**
 * Hook to create a new dataset
 */
export function useCreateDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      description?: string;
      datasetType?: "custom" | "training" | "evaluation" | "fine_tuning" | "rag" | "mixed";
      license?: string;
      tags?: string[];
      supportedModalities?: string[];
    }) => {
      return client().createDataset(params);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: datasetStudioKeys.datasets() });
      toast.success(`Dataset "${variables.name}" created`);
    },
    onError: (error) => {
      toast.error(`Failed to create dataset: ${error.message}`);
    },
  });
}

/**
 * Hook to update a dataset
 */
export function useUpdateDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      datasetId: string;
      name?: string;
      description?: string;
      license?: string;
      tags?: string[];
    }) => {
      return client().updateDataset(params);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: datasetStudioKeys.datasets() });
      queryClient.invalidateQueries({ queryKey: datasetStudioKeys.dataset(variables.datasetId) });
      toast.success("Dataset updated");
    },
    onError: (error) => {
      toast.error(`Failed to update dataset: ${error.message}`);
    },
  });
}

/**
 * Hook to delete a dataset
 */
export function useDeleteDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (datasetId: string) => {
      return client().deleteDataset(datasetId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: datasetStudioKeys.datasets() });
      toast.success("Dataset deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete dataset: ${error.message}`);
    },
  });
}

/**
 * Hook to refresh dataset statistics
 */
export function useRefreshDatasetStats() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (datasetId: string) => {
      return client().refreshStats(datasetId);
    },
    onSuccess: (_, datasetId) => {
      queryClient.invalidateQueries({ queryKey: datasetStudioKeys.datasets() });
      queryClient.invalidateQueries({ queryKey: datasetStudioKeys.dataset(datasetId) });
    },
    onError: (error) => {
      toast.error(`Failed to refresh stats: ${error.message}`);
    },
  });
}

// ==================== ITEM QUERIES ====================

/**
 * Hook to list dataset items with optional filtering
 */
export function useDatasetItems(
  datasetId: string,
  options?: {
    modality?: string;
    split?: string;
    limit?: number;
    offset?: number;
    enabled?: boolean;
  }
) {
  return useQuery({
    queryKey: datasetStudioKeys.items(datasetId),
    queryFn: () =>
      client().listItems({
        datasetId,
        modality: options?.modality,
        split: options?.split,
        limit: options?.limit,
        offset: options?.offset,
      }),
    enabled: options?.enabled ?? true,
  });
}

/**
 * Hook to get a single dataset item by ID
 */
export function useDatasetItem(itemId: string, enabled = true) {
  return useQuery({
    queryKey: datasetStudioKeys.item(itemId),
    queryFn: () => client().getItem(itemId),
    enabled,
  });
}

// ==================== ITEM MUTATIONS ====================

/**
 * Hook to add a new item from a file
 */
export function useAddItemFromFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      datasetId: string;
      filePath: string;
      mimeType?: string;
      sourceType?: "captured" | "imported" | "generated" | "api" | "scraped";
      labels?: Record<string, unknown>;
      license?: string;
    }) => {
      return client().addItemFromFile({
        datasetId: params.datasetId,
        filePath: params.filePath,
        mimeType: params.mimeType,
        sourceType: params.sourceType,
        labels: params.labels,
        license: params.license,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.items(variables.datasetId),
      });
      toast.success("Item added to dataset");
    },
    onError: (error) => {
      toast.error(`Failed to add item: ${error.message}`);
    },
  });
}

/**
 * Hook to add a generated item (from local AI model)
 */
export function useAddGeneratedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      datasetId: string;
      content: string | ArrayBuffer;
      mimeType: string;
      generator: "local_model" | "provider_api" | "hybrid";
      lineage: {
        model?: string;
        modelVersion?: string;
        prompt?: string;
        systemPrompt?: string;
        seed?: number;
        temperature?: number;
        parameters?: Record<string, unknown>;
        parentItemIds?: string[];
        transformations?: string[];
      };
      labels?: Record<string, unknown>;
    }) => {
      return client().addGeneratedItem({
        datasetId: params.datasetId,
        content: params.content,
        mimeType: params.mimeType,
        generator: params.generator,
        lineage: params.lineage,
        labels: params.labels,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.items(variables.datasetId),
      });
      toast.success("Generated item added to dataset");
    },
    onError: (error) => {
      toast.error(`Failed to add generated item: ${error.message}`);
    },
  });
}

/**
 * Hook to update item labels (annotations)
 */
export function useUpdateItemLabels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      labels: Record<string, unknown>;
      merge?: boolean;
    }) => {
      return client().updateItemLabels({
        itemId: params.itemId,
        labels: params.labels,
        merge: params.merge,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.item(variables.itemId),
      });
      toast.success("Labels updated");
    },
    onError: (error) => {
      toast.error(`Failed to update labels: ${error.message}`);
    },
  });
}

/**
 * Hook to update quality signals for an item
 */
export function useUpdateQualitySignals() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      signals: {
        // Image quality
        blurScore?: number;
        aestheticScore?: number;
        resolution?: { width: number; height: number };
        // Content safety
        nsfwScore?: number;
        toxicityScore?: number;
        // Text quality
        languageConfidence?: number;
        readabilityScore?: number;
        // Audio quality
        signalToNoiseRatio?: number;
        // General
        duplicateScore?: number;
        overallQuality?: number;
        customSignals?: Record<string, number>;
      };
    }) => {
      return client().updateQualitySignals({
        itemId: params.itemId,
        signals: params.signals,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.item(variables.itemId),
      });
      toast.success("Quality signals updated");
    },
    onError: (error) => {
      toast.error(`Failed to update quality signals: ${error.message}`);
    },
  });
}

/**
 * Hook to delete a dataset item
 */
export function useDeleteDatasetItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) => client().deleteItem(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.all,
      });
      toast.success("Item deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete item: ${error.message}`);
    },
  });
}

// ==================== MANIFEST OPERATIONS ====================

/**
 * Hook to get the current manifest for a dataset
 */
export function useDatasetManifest(datasetId: string, enabled = true) {
  return useQuery({
    queryKey: datasetStudioKeys.manifest(datasetId),
    queryFn: () => client().getManifest({ datasetId }),
    enabled,
  });
}

/**
 * Hook to build a new manifest from dataset items
 */
export function useBuildManifest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { datasetId: string; version: string; license: string }) => {
      return client().buildManifest({
        datasetId: params.datasetId,
        version: params.version,
        license: params.license,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.manifest(variables.datasetId),
      });
      toast.success("Manifest built successfully");
    },
    onError: (error) => {
      toast.error(`Failed to build manifest: ${error.message}`);
    },
  });
}

/**
 * Hook to create train/val/test splits
 */
export function useCreateSplits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      datasetId: string;
      ratios: { train: number; val: number; test: number };
      seed?: number;
    }) => {
      return client().createSplits({
        datasetId: params.datasetId,
        ratios: params.ratios,
        seed: params.seed,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.items(variables.datasetId),
      });
      toast.success("Splits created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create splits: ${error.message}`);
    },
  });
}

/**
 * Hook to sign a manifest with the user's key
 */
export function useSignManifest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (manifestId: string) => client().signManifest(manifestId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.all,
      });
      toast.success("Manifest signed");
    },
    onError: (error) => {
      toast.error(`Failed to sign manifest: ${error.message}`);
    },
  });
}

// ==================== GENERATION JOBS ====================

/**
 * Hook to list generation jobs for a dataset
 */
export function useGenerationJobs(datasetId: string, enabled = true) {
  return useQuery({
    queryKey: datasetStudioKeys.jobs(datasetId),
    queryFn: () => client().listJobs(datasetId),
    enabled,
    refetchInterval: 5000, // Poll for job updates
  });
}

/**
 * Hook to get status of a specific generation job
 */
export function useJobStatus(jobId: string, enabled = true) {
  return useQuery({
    queryKey: datasetStudioKeys.jobStatus(jobId),
    queryFn: () => client().getJobStatus(jobId),
    enabled,
    refetchInterval: (query) => {
      // Poll more frequently while job is running
      const status = query.state.data?.status;
      if (status === "running" || status === "pending") {
        return 2000;
      }
      return false; // Stop polling when done
    },
  });
}

/**
 * Hook to create a new generation job
 */
export function useCreateGenerationJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      datasetId: string;
      jobType: "text_generation" | "image_generation" | "audio_transcription" | "labeling" | "augmentation" | "embedding";
      config: {
        prompt?: string;
        systemPrompt?: string;
        templateVariables?: Record<string, string[]>;
        targetCount?: number;
        batchSize?: number;
        temperature?: number;
        maxTokens?: number;
        imageSize?: string;
        augmentationTypes?: string[];
      };
      providerType: "local" | "remote";
      providerId: string;
      modelId: string;
    }) => {
      return client().createGenerationJob({
        datasetId: params.datasetId,
        jobType: params.jobType,
        config: params.config,
        providerType: params.providerType,
        providerId: params.providerId,
        modelId: params.modelId,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.jobs(variables.datasetId),
      });
      toast.success("Generation job started");
    },
    onError: (error) => {
      toast.error(`Failed to start generation job: ${error.message}`);
    },
  });
}

// ==================== P2P SYNC ====================

/**
 * Hook to get P2P sync status for a dataset
 */
export function useP2pSyncStatus(datasetId: string, enabled = true) {
  return useQuery({
    queryKey: datasetStudioKeys.p2pStatus(datasetId),
    queryFn: () => client().getP2pSyncStatus(datasetId),
    enabled,
    refetchInterval: 10000, // Poll for sync updates
  });
}

/**
 * Hook to initialize P2P sync for a dataset
 */
export function useInitP2pSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      datasetId: string;
      peerId: string;
      peerName?: string;
      direction: "push" | "pull" | "bidirectional";
    }) => {
      return client().initP2pSync({
        datasetId: params.datasetId,
        peerId: params.peerId,
        peerName: params.peerName,
        direction: params.direction,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.p2pStatus(variables.datasetId),
      });
      toast.success("P2P sync initialized");
    },
    onError: (error) => {
      toast.error(`Failed to initialize P2P sync: ${error.message}`);
    },
  });
}

// ==================== CONTENT RETRIEVAL ====================

/**
 * Hook to get content by hash (for displaying items)
 */
export function useContent(contentHash: string, enabled = true) {
  return useQuery({
    queryKey: datasetStudioKeys.content(contentHash),
    queryFn: () => client().getContent(contentHash),
    enabled: enabled && !!contentHash,
    staleTime: Number.POSITIVE_INFINITY, // Content is immutable by hash
  });
}

// ==================== EXPORT ====================

/**
 * Hook to export a dataset
 */
export function useExportDataset() {
  return useMutation({
    mutationFn: async (params: {
      datasetId: string;
      manifestId: string;
      outputDir: string;
      format: "jsonl" | "parquet" | "huggingface";
      includeMedia?: boolean;
    }) => {
      return client().exportDataset({
        datasetId: params.datasetId,
        manifestId: params.manifestId,
        outputDir: params.outputDir,
        format: params.format,
        includeMedia: params.includeMedia,
      });
    },
    onSuccess: (result) => {
      toast.success(`Dataset exported to ${result.outputDir}`);
    },
    onError: (error) => {
      toast.error(`Failed to export dataset: ${error.message}`);
    },
  });
}

// ==================== BATCH OPERATIONS ====================

/**
 * Hook for batch adding multiple items (e.g., from folder upload)
 */
export function useBatchAddItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      datasetId: string;
      items: Array<{
        filePath: string;
        mimeType?: string;
        labels?: Record<string, unknown>;
      }>;
    }) => {
      const results: Array<{ success: boolean; itemId?: string; error?: string }> = [];
      
      for (const item of params.items) {
        try {
          const result = await client().addItemFromFile({
            datasetId: params.datasetId,
            filePath: item.filePath,
            mimeType: item.mimeType,
            labels: item.labels,
          });
          results.push({ success: result.success, itemId: result.itemId });
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
      
      return results;
    },
    onSuccess: (results, variables) => {
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;
      
      queryClient.invalidateQueries({
        queryKey: datasetStudioKeys.items(variables.datasetId),
      });
      
      if (failCount === 0) {
        toast.success(`${successCount} items added to dataset`);
      } else if (successCount === 0) {
        toast.error(`Failed to add all ${failCount} items`);
      } else {
        toast.warning(`Added ${successCount} items, ${failCount} failed`);
      }
    },
    onError: (error) => {
      toast.error(`Batch add failed: ${error.message}`);
    },
  });
}

// Re-export types for convenience
export type { DatasetItem, DatasetManifest, ProvenanceRecord, GenerationJob, P2pSyncState, StudioDataset };
