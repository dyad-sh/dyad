/**
 * Hyper Liquid React Hooks
 * TanStack Query integration for real-time data liquidity pipeline
 * 
 * Provides reactive hooks for managing data flow to joymarketplace.io
 */

import { useCallback, useEffect, useState, useRef } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { hyperLiquidClient } from "@/ipc/hyper_liquid_client";
import type {
  LiquidDataContainer,
  LiquidityPipelineConfig,
  FlowQueue,
  LiquidityStreamEvent,
  FlowProgressEvent,
  LiquidityStats,
  StartFlowRequest,
  StartFlowResponse,
  BatchFlowRequest,
  BatchFlowResponse,
  ContentDeduplication,
  FlowCheckpoint,
  FlowStatus,
  FlowPriority,
} from "@/types/hyper_liquid_types";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const hyperLiquidKeys = {
  all: ["hyper-liquid"] as const,
  status: () => [...hyperLiquidKeys.all, "status"] as const,
  pipelines: () => [...hyperLiquidKeys.all, "pipelines"] as const,
  pipeline: (id: string) => [...hyperLiquidKeys.all, "pipeline", id] as const,
  flows: () => [...hyperLiquidKeys.all, "flows"] as const,
  flowsByPipeline: (pipelineId: string) =>
    [...hyperLiquidKeys.all, "flows", pipelineId] as const,
  flow: (flowId: string) => [...hyperLiquidKeys.all, "flow", flowId] as const,
  queues: () => [...hyperLiquidKeys.all, "queues"] as const,
  queue: (pipelineId: string) =>
    [...hyperLiquidKeys.all, "queue", pipelineId] as const,
  stats: (period?: string) => [...hyperLiquidKeys.all, "stats", period] as const,
  dedup: (dataId: string) => [...hyperLiquidKeys.all, "dedup", dataId] as const,
  checkpoint: (flowId: string) =>
    [...hyperLiquidKeys.all, "checkpoint", flowId] as const,
} as const;

// =============================================================================
// STATUS & INITIALIZATION
// =============================================================================

/**
 * Hook to get overall hyper liquid status
 */
export function useHyperLiquidStatus(
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof hyperLiquidClient.getStatus>>>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.status(),
    queryFn: () => hyperLiquidClient.getStatus(),
    refetchInterval: 5000, // Refresh every 5 seconds
    ...options,
  });
}

/**
 * Hook to initialize hyper liquid client
 */
export function useHyperLiquidInit() {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hyperLiquidClient
      .initialize()
      .then(() => setInitialized(true))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to initialize");
      });
  }, []);

  return { initialized, error };
}

// =============================================================================
// PIPELINE HOOKS
// =============================================================================

/**
 * Hook to get all pipelines
 */
export function usePipelines(
  options?: Omit<UseQueryOptions<LiquidityPipelineConfig[]>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.pipelines(),
    queryFn: () => hyperLiquidClient.getPipelines(),
    ...options,
  });
}

/**
 * Hook to get a specific pipeline
 */
export function usePipeline(
  pipelineId: string,
  options?: Omit<UseQueryOptions<LiquidityPipelineConfig | null>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.pipeline(pipelineId),
    queryFn: () => hyperLiquidClient.getPipeline(pipelineId),
    enabled: !!pipelineId,
    ...options,
  });
}

/**
 * Hook to create a pipeline
 */
export function useCreatePipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: LiquidityPipelineConfig) =>
      hyperLiquidClient.createPipeline(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.pipelines() });
    },
  });
}

/**
 * Hook to update a pipeline
 */
export function useUpdatePipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: LiquidityPipelineConfig) =>
      hyperLiquidClient.updatePipeline(config),
    onSuccess: (_, config) => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.pipelines() });
      queryClient.invalidateQueries({
        queryKey: hyperLiquidKeys.pipeline(config.id),
      });
    },
  });
}

/**
 * Hook to delete a pipeline
 */
export function useDeletePipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pipelineId: string) =>
      hyperLiquidClient.deletePipeline(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.pipelines() });
    },
  });
}

/**
 * Hook to control pipeline execution
 */
export function usePipelineControl(pipelineId: string) {
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: () => hyperLiquidClient.startPipeline(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.status() });
      queryClient.invalidateQueries({
        queryKey: hyperLiquidKeys.pipeline(pipelineId),
      });
    },
  });

  const stop = useMutation({
    mutationFn: (graceful: boolean = true) =>
      hyperLiquidClient.stopPipeline(pipelineId, graceful),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.status() });
      queryClient.invalidateQueries({
        queryKey: hyperLiquidKeys.pipeline(pipelineId),
      });
    },
  });

  const pause = useMutation({
    mutationFn: () => hyperLiquidClient.pausePipeline(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: hyperLiquidKeys.queue(pipelineId),
      });
    },
  });

  const resume = useMutation({
    mutationFn: () => hyperLiquidClient.resumePipeline(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: hyperLiquidKeys.queue(pipelineId),
      });
    },
  });

  return { start, stop, pause, resume };
}

// =============================================================================
// FLOW HOOKS
// =============================================================================

/**
 * Hook to get all flows
 */
export function useFlows(
  pipelineId?: string,
  options?: Omit<UseQueryOptions<LiquidDataContainer[]>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: pipelineId
      ? hyperLiquidKeys.flowsByPipeline(pipelineId)
      : hyperLiquidKeys.flows(),
    queryFn: () => hyperLiquidClient.getFlows(pipelineId),
    refetchInterval: 2000, // Refresh frequently for real-time updates
    ...options,
  });
}

/**
 * Hook to get a specific flow
 */
export function useFlow(
  flowId: string,
  options?: Omit<UseQueryOptions<LiquidDataContainer | null>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.flow(flowId),
    queryFn: () => hyperLiquidClient.getFlow(flowId),
    enabled: !!flowId,
    refetchInterval: 1000, // Fast refresh for active flows
    ...options,
  });
}

/**
 * Hook to start a flow
 */
export function useStartFlow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: StartFlowRequest) =>
      hyperLiquidClient.startFlow(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flows() });
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.queues() });
    },
  });
}

/**
 * Hook to start a batch flow
 */
export function useBatchFlow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: BatchFlowRequest) =>
      hyperLiquidClient.batchFlow(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flows() });
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.queues() });
    },
  });
}

/**
 * Hook to cancel a flow
 */
export function useCancelFlow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (flowId: string) => hyperLiquidClient.cancelFlow(flowId),
    onSuccess: (_, flowId) => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flow(flowId) });
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flows() });
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.queues() });
    },
  });
}

/**
 * Hook to retry a failed flow
 */
export function useRetryFlow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (flowId: string) => hyperLiquidClient.retryFlow(flowId),
    onSuccess: (_, flowId) => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flow(flowId) });
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flows() });
    },
  });
}

// =============================================================================
// QUEUE HOOKS
// =============================================================================

/**
 * Hook to get all queues
 */
export function useQueues(
  options?: Omit<UseQueryOptions<FlowQueue[]>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.queues(),
    queryFn: () => hyperLiquidClient.getQueues(),
    refetchInterval: 2000,
    ...options,
  });
}

/**
 * Hook to get a specific queue
 */
export function useQueue(
  pipelineId: string,
  options?: Omit<UseQueryOptions<FlowQueue | null>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.queue(pipelineId),
    queryFn: () => hyperLiquidClient.getQueue(pipelineId),
    enabled: !!pipelineId,
    refetchInterval: 2000,
    ...options,
  });
}

// =============================================================================
// STATS HOOKS
// =============================================================================

/**
 * Hook to get liquidity statistics
 */
export function useLiquidityStats(
  period?: "hour" | "day" | "week" | "month" | "all",
  options?: Omit<UseQueryOptions<LiquidityStats>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.stats(period),
    queryFn: () => hyperLiquidClient.getStats(period),
    refetchInterval: 10000,
    ...options,
  });
}

/**
 * Hook to reset statistics
 */
export function useResetStats() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => hyperLiquidClient.resetStats(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.stats() });
    },
  });
}

// =============================================================================
// DEDUPLICATION HOOKS
// =============================================================================

/**
 * Hook to check content deduplication
 */
export function useDeduplication(
  dataId: string,
  options?: Omit<UseQueryOptions<ContentDeduplication>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.dedup(dataId),
    queryFn: () => hyperLiquidClient.checkDeduplication(dataId),
    enabled: !!dataId,
    staleTime: 60000, // Cache for 1 minute
    ...options,
  });
}

// =============================================================================
// CHECKPOINT HOOKS
// =============================================================================

/**
 * Hook to get flow checkpoint
 */
export function useCheckpoint(
  flowId: string,
  options?: Omit<UseQueryOptions<FlowCheckpoint | null>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: hyperLiquidKeys.checkpoint(flowId),
    queryFn: () => hyperLiquidClient.getCheckpoint(flowId),
    enabled: !!flowId,
    ...options,
  });
}

/**
 * Hook to resume from checkpoint
 */
export function useResumeFromCheckpoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (flowId: string) =>
      hyperLiquidClient.resumeFromCheckpoint(flowId),
    onSuccess: (_, flowId) => {
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flow(flowId) });
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flows() });
    },
  });
}

// =============================================================================
// EVENT HOOKS
// =============================================================================

/**
 * Hook to listen to all liquidity events
 */
export function useLiquidityEvents(
  callback: (event: LiquidityStreamEvent) => void
) {
  useEffect(() => {
    const unsubscribe = hyperLiquidClient.onEvent(callback);
    return () => unsubscribe();
  }, [callback]);
}

/**
 * Hook to listen to events for a specific flow
 */
export function useFlowEvents(
  flowId: string,
  callback: (event: LiquidityStreamEvent) => void
) {
  useEffect(() => {
    if (!flowId) return;
    const unsubscribe = hyperLiquidClient.onFlowEvent(flowId, callback);
    return () => unsubscribe();
  }, [flowId, callback]);
}

/**
 * Hook to listen to events for a specific pipeline
 */
export function usePipelineEvents(
  pipelineId: string,
  callback: (event: LiquidityStreamEvent) => void
) {
  useEffect(() => {
    if (!pipelineId) return;
    const unsubscribe = hyperLiquidClient.onPipelineEvent(pipelineId, callback);
    return () => unsubscribe();
  }, [pipelineId, callback]);
}

// =============================================================================
// PROGRESS HOOKS
// =============================================================================

/**
 * Hook to track progress for all flows
 */
export function useAllFlowProgress() {
  const [progress, setProgress] = useState<Map<string, FlowProgressEvent>>(
    new Map()
  );

  useEffect(() => {
    const unsubscribe = hyperLiquidClient.onProgress((event) => {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(event.flowId, event);
        return next;
      });
    });
    return () => unsubscribe();
  }, []);

  return progress;
}

/**
 * Hook to track progress for a specific flow
 */
export function useFlowProgress(flowId: string) {
  const [progress, setProgress] = useState<FlowProgressEvent | null>(null);

  useEffect(() => {
    if (!flowId) return;
    const unsubscribe = hyperLiquidClient.onFlowProgress(flowId, setProgress);
    return () => unsubscribe();
  }, [flowId]);

  return progress;
}

// =============================================================================
// STREAMING HOOKS
// =============================================================================

/**
 * Hook for streaming data with real-time progress
 */
export function useStreamData() {
  const queryClient = useQueryClient();
  const [activeStream, setActiveStream] = useState<{
    flowId: string;
    progress: FlowProgressEvent | null;
    status: "streaming" | "completed" | "failed" | "cancelled" | null;
  } | null>(null);

  const cancelRef = useRef<(() => Promise<void>) | null>(null);

  const stream = useCallback(
    async (
      dataId: string,
      options?: {
        priority?: FlowPriority;
        pipelineId?: string;
      }
    ) => {
      // Cancel any existing stream
      if (cancelRef.current) {
        await cancelRef.current();
      }

      const { cancel, promise } = hyperLiquidClient.streamData(
        dataId,
        {
          onProgress: (progress) => {
            setActiveStream((prev) => prev ? { ...prev, progress } : null);
          },
          onComplete: (flow) => {
            setActiveStream((prev) =>
              prev ? { ...prev, status: "completed" } : null
            );
            queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flows() });
            queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.stats() });
          },
          onError: () => {
            setActiveStream((prev) =>
              prev ? { ...prev, status: "failed" } : null
            );
          },
        },
        options
      );

      cancelRef.current = cancel;

      // Get flow ID from starting the stream
      const response = await hyperLiquidClient.startFlow({
        dataId,
        ...options,
      });

      if (response.flowId) {
        setActiveStream({
          flowId: response.flowId,
          progress: null,
          status: "streaming",
        });
      }

      return promise;
    },
    [queryClient]
  );

  const cancel = useCallback(async () => {
    if (cancelRef.current) {
      await cancelRef.current();
      setActiveStream((prev) =>
        prev ? { ...prev, status: "cancelled" } : null
      );
      cancelRef.current = null;
    }
  }, []);

  return { stream, cancel, activeStream };
}

// =============================================================================
// BULK UPLOAD HOOK
// =============================================================================

/**
 * Hook for bulk uploading multiple items
 */
export function useBulkUpload() {
  const queryClient = useQueryClient();
  const [uploadState, setUploadState] = useState<{
    inProgress: boolean;
    total: number;
    successful: number;
    failed: number;
    currentBatch: number;
    totalBatches: number;
  }>({
    inProgress: false,
    total: 0,
    successful: 0,
    failed: 0,
    currentBatch: 0,
    totalBatches: 0,
  });

  const upload = useCallback(
    async (
      dataIds: string[],
      options?: {
        batchSize?: number;
        priority?: FlowPriority;
        pipelineId?: string;
      }
    ) => {
      const batchSize = options?.batchSize || 10;
      const totalBatches = Math.ceil(dataIds.length / batchSize);

      setUploadState({
        inProgress: true,
        total: dataIds.length,
        successful: 0,
        failed: 0,
        currentBatch: 0,
        totalBatches,
      });

      const result = await hyperLiquidClient.bulkUpload(dataIds, {
        ...options,
        onBatchComplete: (batchIndex, total) => {
          setUploadState((prev) => ({
            ...prev,
            currentBatch: batchIndex,
          }));
        },
      });

      setUploadState({
        inProgress: false,
        total: result.total,
        successful: result.successful,
        failed: result.failed,
        currentBatch: totalBatches,
        totalBatches,
      });

      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.flows() });
      queryClient.invalidateQueries({ queryKey: hyperLiquidKeys.stats() });

      return result;
    },
    [queryClient]
  );

  return { upload, ...uploadState };
}

// =============================================================================
// COMBINED DASHBOARD HOOK
// =============================================================================

/**
 * Hook for a complete hyper liquid dashboard view
 */
export function useHyperLiquidDashboard() {
  const { data: status } = useHyperLiquidStatus();
  const { data: pipelines } = usePipelines();
  const { data: flows } = useFlows();
  const { data: queues } = useQueues();
  const { data: stats } = useLiquidityStats();
  const progressMap = useAllFlowProgress();

  // Derived stats
  const activeFlows = flows?.filter((f) => f.status === "streaming") || [];
  const pendingFlows =
    flows?.filter((f) => f.status === "preparing" || f.status === "idle") || [];
  const completedFlows = flows?.filter((f) => f.status === "completed") || [];
  const failedFlows = flows?.filter((f) => f.status === "failed") || [];

  const totalQueuedItems =
    queues?.reduce((sum, q) => sum + q.totalItems, 0) || 0;
  const totalTransferredBytes =
    queues?.reduce((sum, q) => sum + q.transferredBytes, 0) || 0;

  return {
    status,
    pipelines: pipelines || [],
    flows: flows || [],
    queues: queues || [],
    stats,
    progressMap,
    activeFlows,
    pendingFlows,
    completedFlows,
    failedFlows,
    totalQueuedItems,
    totalTransferredBytes,
    isRunning: status?.running || false,
    activePipeline: status?.activePipeline,
  };
}
