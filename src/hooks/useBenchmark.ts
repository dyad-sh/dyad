/**
 * useBenchmark Hook
 * React hook for model benchmarking
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { BenchmarkClient } from "@/ipc/benchmark_client";
import type {
  BenchmarkId,
  BenchmarkConfig,
  BenchmarkResult,
  BenchmarkEvent,
  BenchmarkDataset,
} from "@/ipc/benchmark_client";
import { toast } from "sonner";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const benchmarkKeys = {
  all: ["benchmarks"] as const,
  list: () => [...benchmarkKeys.all, "list"] as const,
  benchmark: (id: BenchmarkId) => [...benchmarkKeys.all, "benchmark", id] as const,
  datasets: () => [...benchmarkKeys.all, "datasets"] as const,
};

// =============================================================================
// INITIALIZATION HOOK
// =============================================================================

export function useBenchmarkSystem() {
  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [runningBenchmarks, setRunningBenchmarks] = useState<Set<BenchmarkId>>(new Set());
  const [progress, setProgress] = useState<Record<BenchmarkId, number>>({});
  const queryClient = useQueryClient();

  const initializeMutation = useMutation({
    mutationFn: () => BenchmarkClient.initialize(),
    onSuccess: () => {
      setIsReady(true);
    },
    onError: (error) => {
      toast.error(`Failed to initialize benchmark system: ${error}`);
    },
  });

  const shutdownMutation = useMutation({
    mutationFn: () => BenchmarkClient.shutdown(),
    onSuccess: () => {
      setIsReady(false);
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.all });
    },
  });

  const initialize = useCallback(async () => {
    if (isReady || isInitializing) return;
    setIsInitializing(true);
    try {
      await initializeMutation.mutateAsync();
      await BenchmarkClient.subscribe();
    } finally {
      setIsInitializing(false);
    }
  }, [isReady, isInitializing, initializeMutation]);

  // Event subscription
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = BenchmarkClient.onEvent((event: BenchmarkEvent) => {
      switch (event.type) {
        case "benchmark:started":
          setRunningBenchmarks((prev) => new Set(prev).add(event.benchmarkId));
          toast.info("Benchmark started");
          break;
        case "benchmark:progress":
          setProgress((prev) => ({
            ...prev,
            [event.benchmarkId]: event.data?.progress || 0,
          }));
          break;
        case "benchmark:model-complete":
          toast.info(`Completed benchmark for ${event.data?.modelId}`);
          break;
        case "benchmark:completed":
          setRunningBenchmarks((prev) => {
            const next = new Set(prev);
            next.delete(event.benchmarkId);
            return next;
          });
          setProgress((prev) => {
            const { [event.benchmarkId]: _, ...rest } = prev;
            return rest;
          });
          queryClient.invalidateQueries({ queryKey: benchmarkKeys.list() });
          queryClient.invalidateQueries({ queryKey: benchmarkKeys.benchmark(event.benchmarkId) });
          toast.success("Benchmark completed!");
          break;
        case "benchmark:failed":
          setRunningBenchmarks((prev) => {
            const next = new Set(prev);
            next.delete(event.benchmarkId);
            return next;
          });
          toast.error(`Benchmark failed: ${event.data?.error}`);
          break;
        case "benchmark:cancelled":
          setRunningBenchmarks((prev) => {
            const next = new Set(prev);
            next.delete(event.benchmarkId);
            return next;
          });
          toast.info("Benchmark cancelled");
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
    runningBenchmarks,
    progress,
  };
}

// =============================================================================
// BENCHMARK HOOKS
// =============================================================================

export function useBenchmarkList(enabled = true) {
  return useQuery({
    queryKey: benchmarkKeys.list(),
    queryFn: () => BenchmarkClient.listBenchmarks(50),
    enabled,
    staleTime: 30000,
  });
}

export function useBenchmark(id: BenchmarkId | null) {
  return useQuery({
    queryKey: id ? benchmarkKeys.benchmark(id) : benchmarkKeys.all,
    queryFn: () => (id ? BenchmarkClient.getBenchmark(id) : null),
    enabled: !!id,
    refetchInterval: (query) => {
      // Poll while running
      const data = query.state.data as BenchmarkResult | null;
      return data?.status === "running" ? 2000 : false;
    },
  });
}

export function useAvailableDatasets() {
  return useQuery({
    queryKey: benchmarkKeys.datasets(),
    queryFn: () => BenchmarkClient.getAvailableDatasets(),
    staleTime: Infinity, // Static data
  });
}

export function useRunBenchmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: BenchmarkConfig) => BenchmarkClient.runBenchmark(config),
    onSuccess: (benchmarkId) => {
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.list() });
    },
    onError: (error) => {
      toast.error(`Failed to start benchmark: ${error}`);
    },
  });
}

export function useCancelBenchmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: BenchmarkId) => BenchmarkClient.cancelBenchmark(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.benchmark(id) });
    },
    onError: (error) => {
      toast.error(`Failed to cancel benchmark: ${error}`);
    },
  });
}

export function useDeleteBenchmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: BenchmarkId) => BenchmarkClient.deleteBenchmark(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.list() });
      toast.info("Benchmark deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete benchmark: ${error}`);
    },
  });
}

// Re-export types
export type {
  BenchmarkId,
  BenchmarkConfig,
  BenchmarkResult,
  BenchmarkEvent,
  BenchmarkDataset,
};
