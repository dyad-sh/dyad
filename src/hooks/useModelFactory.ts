/**
 * Model Factory React Hooks
 * TanStack Query hooks for model training with LoRA/QLoRA
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import type {
  ModelFactorySystemInfo,
  CreateTrainingJobParams,
  TrainingJobInfo,
  TrainingProgressEvent,
  ExportModelParams,
  ImportAdapterParams,
  AdapterInfo,
} from "@/ipc/ipc_types";
import { showError, showSuccess } from "@/lib/toast";

const ipc = IpcClient.getInstance();

// =============================================================================
// Query Keys
// =============================================================================

export const modelFactoryKeys = {
  all: ["model-factory"] as const,
  systemInfo: () => [...modelFactoryKeys.all, "system-info"] as const,
  jobs: () => [...modelFactoryKeys.all, "jobs"] as const,
  job: (jobId: string) => [...modelFactoryKeys.all, "job", jobId] as const,
  adapters: () => [...modelFactoryKeys.all, "adapters"] as const,
  adapter: (adapterId: string) => [...modelFactoryKeys.all, "adapter", adapterId] as const,
};

// =============================================================================
// Hooks
// =============================================================================

/**
 * Get system capabilities for model training
 */
export function useModelFactorySystemInfo() {
  return useQuery({
    queryKey: modelFactoryKeys.systemInfo(),
    queryFn: async (): Promise<ModelFactorySystemInfo> => {
      return ipc.getModelFactorySystemInfo();
    },
    staleTime: 60 * 1000, // Cache for 1 minute
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * List all training jobs
 */
export function useTrainingJobs() {
  return useQuery({
    queryKey: modelFactoryKeys.jobs(),
    queryFn: async (): Promise<TrainingJobInfo[]> => {
      return ipc.listTrainingJobs();
    },
    refetchInterval: 5000, // Refetch every 5 seconds while training
  });
}

/**
 * Get a specific training job
 */
export function useTrainingJob(jobId: string | null) {
  return useQuery({
    queryKey: modelFactoryKeys.job(jobId || ""),
    queryFn: async (): Promise<TrainingJobInfo | null> => {
      if (!jobId) return null;
      return ipc.getTrainingJob(jobId);
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      // Refetch frequently while training
      if (query.state.data?.status === "training" || query.state.data?.status === "initializing") {
        return 2000;
      }
      return false;
    },
  });
}

/**
 * Create a new training job
 */
export function useCreateTrainingJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateTrainingJobParams): Promise<TrainingJobInfo> => {
      return ipc.createTrainingJob(params);
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.jobs() });
      showSuccess(`Training job "${job.name}" created`);
    },
    onError: (error: Error) => {
      showError(`Failed to create training job: ${error.message}`);
    },
  });
}

/**
 * Start a training job
 */
export function useStartTraining() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string): Promise<void> => {
      return ipc.startTraining(jobId);
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.job(jobId) });
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.jobs() });
      showSuccess("Training started");
    },
    onError: (error: Error) => {
      showError(`Failed to start training: ${error.message}`);
    },
  });
}

/**
 * Cancel a training job
 */
export function useCancelTraining() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string): Promise<void> => {
      return ipc.cancelTraining(jobId);
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.job(jobId) });
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.jobs() });
      showSuccess("Training cancelled");
    },
    onError: (error: Error) => {
      showError(`Failed to cancel training: ${error.message}`);
    },
  });
}

/**
 * Export a trained model
 */
export function useExportModel() {
  return useMutation({
    mutationFn: async (params: ExportModelParams): Promise<string> => {
      return ipc.exportTrainedModel(params);
    },
    onSuccess: (outputPath) => {
      showSuccess(`Model exported to: ${outputPath}`);
    },
    onError: (error: Error) => {
      showError(`Failed to export model: ${error.message}`);
    },
  });
}

/**
 * List all adapters
 */
export function useAdapters() {
  return useQuery({
    queryKey: modelFactoryKeys.adapters(),
    queryFn: async (): Promise<AdapterInfo[]> => {
      return ipc.listAdapters();
    },
  });
}

/**
 * Import an adapter
 */
export function useImportAdapter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ImportAdapterParams): Promise<AdapterInfo> => {
      return ipc.importAdapter(params);
    },
    onSuccess: (adapter) => {
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.adapters() });
      showSuccess(`Adapter "${adapter.name}" imported`);
    },
    onError: (error: Error) => {
      showError(`Failed to import adapter: ${error.message}`);
    },
  });
}

/**
 * Delete an adapter
 */
export function useDeleteAdapter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (adapterId: string): Promise<void> => {
      return ipc.deleteAdapter(adapterId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.adapters() });
      showSuccess("Adapter deleted");
    },
    onError: (error: Error) => {
      showError(`Failed to delete adapter: ${error.message}`);
    },
  });
}

/**
 * Subscribe to training progress events
 */
export function useTrainingProgressSubscription(
  onProgress?: (event: TrainingProgressEvent) => void,
  onCompleted?: (event: { jobId: string; status: string; outputPath?: string; error?: string }) => void
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubProgress = ipc.onTrainingProgress((event) => {
      // Update cache
      queryClient.setQueryData<TrainingJobInfo | null>(
        modelFactoryKeys.job(event.jobId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            status: event.status,
            progress: event.progress,
            currentEpoch: event.currentEpoch,
            totalEpochs: event.totalEpochs,
            currentStep: event.currentStep,
            totalSteps: event.totalSteps,
            currentLoss: event.loss,
            gpuMemoryUsed: event.gpuMemoryUsed,
          };
        }
      );
      
      onProgress?.(event);
    });

    const unsubCompleted = ipc.onTrainingCompleted((event) => {
      // Invalidate queries to get fresh data
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.job(event.jobId) });
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.jobs() });
      queryClient.invalidateQueries({ queryKey: modelFactoryKeys.adapters() });
      
      if (event.status === "completed") {
        showSuccess("Training completed successfully!");
      } else if (event.status === "failed") {
        showError(`Training failed: ${event.error}`);
      }
      
      onCompleted?.(event);
    });

    return () => {
      unsubProgress();
      unsubCompleted();
    };
  }, [queryClient, onProgress, onCompleted]);
}

// =============================================================================
// Recommended Settings Hook
// =============================================================================

export interface RecommendedTrainingSettings {
  method: "lora" | "qlora" | "dora" | "full";
  batchSize: number;
  gradientAccumulation: number;
  use4bit: boolean;
  use8bit: boolean;
  loraRank: number;
  loraAlpha: number;
  learningRate: number;
  epochs: number;
  gradientCheckpointing: boolean;
  flashAttention: boolean;
}

/**
 * Get recommended training settings based on system capabilities
 */
export function useRecommendedTrainingSettings(): {
  settings: RecommendedTrainingSettings | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { data: systemInfo, isLoading, error } = useModelFactorySystemInfo();

  const settings: RecommendedTrainingSettings | null = systemInfo
    ? {
        method: systemInfo.recommendedMethod as "lora" | "qlora" | "dora" | "full",
        batchSize: systemInfo.maxBatchSize,
        gradientAccumulation: Math.max(1, Math.ceil(4 / systemInfo.maxBatchSize)),
        use4bit: systemInfo.recommendedQuantization === "4bit",
        use8bit: systemInfo.recommendedQuantization === "8bit",
        loraRank: systemInfo.gpuVRAM && systemInfo.gpuVRAM >= 16000 ? 32 : 16,
        loraAlpha: systemInfo.gpuVRAM && systemInfo.gpuVRAM >= 16000 ? 64 : 32,
        learningRate: 2e-4,
        epochs: 3,
        gradientCheckpointing: true,
        flashAttention: systemInfo.hasGPU && !!systemInfo.cudaVersion,
      }
    : null;

  return { settings, isLoading, error: error as Error | null };
}
