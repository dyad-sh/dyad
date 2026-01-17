/**
 * Compute Network React Hooks
 * TanStack Query integration for decentralized compute network
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { computeNetworkClient } from "@/ipc/compute_network_client";
import type {
  ComputeNetworkConfig,
  NetworkStatus,
  PeerInfo,
  ConnectionInfo,
  FetchRequest,
  FetchProgress,
  InferenceJob,
  JobStats,
  SystemMetrics,
  NetworkMetrics,
  ComputeNetworkEvent,
} from "@/types/compute_network_types";

// ============================================================================
// Query Keys
// ============================================================================

export const computeNetworkKeys = {
  all: ["compute-network"] as const,
  status: () => [...computeNetworkKeys.all, "status"] as const,
  config: () => [...computeNetworkKeys.all, "config"] as const,
  peers: () => [...computeNetworkKeys.all, "peers"] as const,
  peer: (id: string) => [...computeNetworkKeys.peers(), id] as const,
  connections: () => [...computeNetworkKeys.all, "connections"] as const,
  jobs: () => [...computeNetworkKeys.all, "jobs"] as const,
  job: (id: string) => [...computeNetworkKeys.jobs(), id] as const,
  activeJobs: () => [...computeNetworkKeys.jobs(), "active"] as const,
  pendingJobs: () => [...computeNetworkKeys.jobs(), "pending"] as const,
  fetchProgress: () => [...computeNetworkKeys.all, "fetch-progress"] as const,
  validationRequests: () => [...computeNetworkKeys.all, "validation-requests"] as const,
  jobStats: () => [...computeNetworkKeys.all, "job-stats"] as const,
  systemMetrics: () => [...computeNetworkKeys.all, "system-metrics"] as const,
  networkMetrics: () => [...computeNetworkKeys.all, "network-metrics"] as const,
};

// ============================================================================
// Network Status Hook
// ============================================================================

export function useComputeNetworkStatus(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: computeNetworkKeys.status(),
    queryFn: () => computeNetworkClient.getStatus(),
    refetchInterval: options?.refetchInterval ?? 5000,
    staleTime: 2000,
  });
}

// ============================================================================
// Network Events Hook
// ============================================================================

export function useComputeNetworkEvents(
  eventTypes: ComputeNetworkEvent["type"][] | "*" = "*"
) {
  const [events, setEvents] = useState<ComputeNetworkEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<ComputeNetworkEvent | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    const handleEvent = (event: ComputeNetworkEvent) => {
      setLatestEvent(event);
      setEvents((prev) => [...prev.slice(-99), event]);

      // Invalidate relevant queries
      switch (event.type) {
        case "peer:discovered":
        case "peer:connected":
        case "peer:disconnected":
        case "peer:updated":
          queryClient.invalidateQueries({ queryKey: computeNetworkKeys.peers() });
          queryClient.invalidateQueries({ queryKey: computeNetworkKeys.connections() });
          break;
        case "job:created":
        case "job:assigned":
        case "job:started":
        case "job:completed":
        case "job:failed":
          queryClient.invalidateQueries({ queryKey: computeNetworkKeys.jobs() });
          queryClient.invalidateQueries({ queryKey: computeNetworkKeys.activeJobs() });
          queryClient.invalidateQueries({ queryKey: computeNetworkKeys.pendingJobs() });
          break;
        case "content:fetching":
        case "content:progress":
        case "content:fetched":
        case "content:failed":
          queryClient.invalidateQueries({ queryKey: computeNetworkKeys.fetchProgress() });
          break;
        case "validation:requested":
        case "validation:completed":
          queryClient.invalidateQueries({
            queryKey: computeNetworkKeys.validationRequests(),
          });
          break;
        case "network:status":
          queryClient.invalidateQueries({ queryKey: computeNetworkKeys.status() });
          break;
      }
    };

    if (eventTypes === "*") {
      unsubscribes.push(computeNetworkClient.on("*", handleEvent));
    } else {
      for (const type of eventTypes) {
        unsubscribes.push(computeNetworkClient.on(type, handleEvent));
      }
    }

    return () => {
      for (const unsub of unsubscribes) {
        unsub();
      }
    };
  }, [eventTypes, queryClient]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  return { events, latestEvent, clearEvents };
}

// ============================================================================
// Network Initialization Hook
// ============================================================================

export function useComputeNetworkInit() {
  const queryClient = useQueryClient();

  const initMutation = useMutation({
    mutationFn: (config: Partial<ComputeNetworkConfig>) =>
      computeNetworkClient.initialize(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.all });
    },
  });

  const shutdownMutation = useMutation({
    mutationFn: () => computeNetworkClient.shutdown(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.all });
    },
  });

  return {
    initialize: initMutation.mutateAsync,
    shutdown: shutdownMutation.mutateAsync,
    isInitializing: initMutation.isPending,
    isShuttingDown: shutdownMutation.isPending,
    initError: initMutation.error,
    shutdownError: shutdownMutation.error,
  };
}

// ============================================================================
// Config Hook
// ============================================================================

export function useComputeNetworkConfig() {
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: computeNetworkKeys.config(),
    queryFn: () => computeNetworkClient.getConfig(),
  });

  const updateMutation = useMutation({
    mutationFn: (config: Partial<ComputeNetworkConfig>) =>
      computeNetworkClient.updateConfig(config),
    onSuccess: (data) => {
      queryClient.setQueryData(computeNetworkKeys.config(), data);
    },
  });

  return {
    config: configQuery.data,
    isLoading: configQuery.isLoading,
    error: configQuery.error,
    updateConfig: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}

// ============================================================================
// Peers Hook
// ============================================================================

export function useComputePeers(options?: { refetchInterval?: number }) {
  const queryClient = useQueryClient();

  const peersQuery = useQuery({
    queryKey: computeNetworkKeys.peers(),
    queryFn: () => computeNetworkClient.getPeers(),
    refetchInterval: options?.refetchInterval ?? 10000,
  });

  const connectMutation = useMutation({
    mutationFn: (multiaddr: string) => computeNetworkClient.connectPeer(multiaddr),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.peers() });
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.connections() });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (peerId: string) => computeNetworkClient.disconnectPeer(peerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.peers() });
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.connections() });
    },
  });

  return {
    peers: peersQuery.data ?? [],
    isLoading: peersQuery.isLoading,
    error: peersQuery.error,
    refetch: peersQuery.refetch,
    connectPeer: connectMutation.mutateAsync,
    isConnecting: connectMutation.isPending,
    disconnectPeer: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,
  };
}

export function useComputePeer(peerId: string | null) {
  return useQuery({
    queryKey: computeNetworkKeys.peer(peerId || ""),
    queryFn: () => (peerId ? computeNetworkClient.getPeer(peerId) : null),
    enabled: !!peerId,
  });
}

export function useComputeConnections() {
  return useQuery({
    queryKey: computeNetworkKeys.connections(),
    queryFn: () => computeNetworkClient.getConnections(),
    refetchInterval: 5000,
  });
}

// ============================================================================
// Content Fetching Hook
// ============================================================================

export function useContentFetch() {
  const queryClient = useQueryClient();
  const [activeFetches, setActiveFetches] = useState<Map<string, FetchProgress>>(
    new Map()
  );

  const fetchMutation = useMutation({
    mutationFn: (request: FetchRequest) => computeNetworkClient.fetchContent(request),
    onMutate: (request) => {
      setActiveFetches((prev) => {
        const next = new Map(prev);
        next.set(request.id, {
          requestId: request.id,
          cid: request.cid,
          status: "pending",
          totalChunks: 0,
          completedChunks: 0,
          totalBytes: 0,
          downloadedBytes: 0,
          bytesPerSecond: 0,
          activeProviders: [],
          failedProviders: [],
          estimatedTimeRemaining: 0,
          errors: [],
          startedAt: Date.now(),
        });
        return next;
      });
    },
    onSuccess: (result) => {
      setActiveFetches((prev) => {
        const next = new Map(prev);
        next.delete(result.requestId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.fetchProgress() });
    },
    onError: (_, request) => {
      setActiveFetches((prev) => {
        const next = new Map(prev);
        next.delete(request.id);
        return next;
      });
    },
  });

  const pinMutation = useMutation({
    mutationFn: (cid: string) => computeNetworkClient.pinContent(cid),
  });

  const unpinMutation = useMutation({
    mutationFn: (cid: string) => computeNetworkClient.unpinContent(cid),
  });

  const storeMutation = useMutation({
    mutationFn: ({ data, pin }: { data: Uint8Array; pin?: boolean }) =>
      computeNetworkClient.storeContent(data, { pin }),
  });

  // Update fetch progress from events
  useEffect(() => {
    const unsub = computeNetworkClient.on("content:progress", (event) => {
      if (event.type === "content:progress") {
        setActiveFetches((prev) => {
          const next = new Map(prev);
          next.set(event.progress.requestId, event.progress);
          return next;
        });
      }
    });
    return unsub;
  }, []);

  return {
    fetchContent: fetchMutation.mutateAsync,
    isFetching: fetchMutation.isPending,
    fetchError: fetchMutation.error,
    activeFetches: Array.from(activeFetches.values()),
    pinContent: pinMutation.mutateAsync,
    isPinning: pinMutation.isPending,
    unpinContent: unpinMutation.mutateAsync,
    isUnpinning: unpinMutation.isPending,
    storeContent: storeMutation.mutateAsync,
    isStoring: storeMutation.isPending,
    fetchModel: (cid: string, priority?: number) =>
      computeNetworkClient.fetchModel(cid, priority),
    storeJSON: (data: unknown, pin?: boolean) =>
      computeNetworkClient.storeJSON(data, pin),
  };
}

// ============================================================================
// Jobs Hook
// ============================================================================

export function useComputeJobs(options?: { refetchInterval?: number }) {
  const queryClient = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: computeNetworkKeys.jobs(),
    queryFn: () => computeNetworkClient.getJobs(),
    refetchInterval: options?.refetchInterval ?? 5000,
  });

  const activeJobsQuery = useQuery({
    queryKey: computeNetworkKeys.activeJobs(),
    queryFn: () => computeNetworkClient.getActiveJobs(),
    refetchInterval: options?.refetchInterval ?? 2000,
  });

  const pendingJobsQuery = useQuery({
    queryKey: computeNetworkKeys.pendingJobs(),
    queryFn: () => computeNetworkClient.getPendingJobs(),
    refetchInterval: options?.refetchInterval ?? 5000,
  });

  const createMutation = useMutation({
    mutationFn: (params: Omit<InferenceJob, "id" | "status" | "createdAt">) =>
      computeNetworkClient.createJob(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.jobs() });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (jobId: string) => computeNetworkClient.acceptJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.jobs() });
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.activeJobs() });
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.pendingJobs() });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => computeNetworkClient.cancelJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: computeNetworkKeys.jobs() });
    },
  });

  return {
    jobs: jobsQuery.data ?? [],
    activeJobs: activeJobsQuery.data ?? [],
    pendingJobs: pendingJobsQuery.data ?? [],
    isLoading: jobsQuery.isLoading,
    error: jobsQuery.error,
    refetch: jobsQuery.refetch,
    createJob: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    acceptJob: acceptMutation.mutateAsync,
    isAccepting: acceptMutation.isPending,
    cancelJob: cancelMutation.mutateAsync,
    isCancelling: cancelMutation.isPending,
    createTextGeneration: (options: Parameters<typeof computeNetworkClient.createTextGenerationJob>[0]) =>
      computeNetworkClient.createTextGenerationJob(options),
  };
}

export function useComputeJob(jobId: string | null) {
  return useQuery({
    queryKey: computeNetworkKeys.job(jobId || ""),
    queryFn: () => (jobId ? computeNetworkClient.getJob(jobId) : null),
    enabled: !!jobId,
    refetchInterval: 2000,
  });
}

// ============================================================================
// Validation Hook
// ============================================================================

export function useComputeValidation() {
  const queryClient = useQueryClient();

  const validationRequestsQuery = useQuery({
    queryKey: computeNetworkKeys.validationRequests(),
    queryFn: () => computeNetworkClient.getValidationRequests(),
    refetchInterval: 5000,
  });

  const requestValidationMutation = useMutation({
    mutationFn: ({ jobId, resultIndex }: { jobId: string; resultIndex?: number }) =>
      computeNetworkClient.requestValidation(jobId, resultIndex),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: computeNetworkKeys.validationRequests(),
      });
    },
  });

  return {
    validationRequests: validationRequestsQuery.data ?? [],
    isLoading: validationRequestsQuery.isLoading,
    requestValidation: requestValidationMutation.mutateAsync,
    isRequesting: requestValidationMutation.isPending,
  };
}

// ============================================================================
// Telemetry Hooks
// ============================================================================

export function useComputeJobStats(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: computeNetworkKeys.jobStats(),
    queryFn: () => computeNetworkClient.getJobStats(),
    refetchInterval: options?.refetchInterval ?? 10000,
  });
}

export function useComputeSystemMetrics(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: computeNetworkKeys.systemMetrics(),
    queryFn: () => computeNetworkClient.getSystemMetrics(),
    refetchInterval: options?.refetchInterval ?? 5000,
  });
}

export function useComputeNetworkMetrics(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: computeNetworkKeys.networkMetrics(),
    queryFn: () => computeNetworkClient.getNetworkMetrics(),
    refetchInterval: options?.refetchInterval ?? 5000,
  });
}

// ============================================================================
// Combined Hook
// ============================================================================

export function useComputeNetwork(options?: {
  autoInit?: boolean;
  config?: Partial<ComputeNetworkConfig>;
}) {
  const { initialize, shutdown, isInitializing, isShuttingDown } =
    useComputeNetworkInit();
  const { data: status, isLoading: isLoadingStatus } = useComputeNetworkStatus();
  const { events, latestEvent, clearEvents } = useComputeNetworkEvents();
  const { peers, connectPeer, disconnectPeer } = useComputePeers();
  const { data: connections } = useComputeConnections();
  const { jobs, activeJobs, pendingJobs, createJob, acceptJob, cancelJob } =
    useComputeJobs();
  const { fetchContent, pinContent, unpinContent, storeContent, activeFetches } =
    useContentFetch();
  const { data: jobStats } = useComputeJobStats();
  const { data: systemMetrics } = useComputeSystemMetrics();
  const { data: networkMetrics } = useComputeNetworkMetrics();

  const hasInitialized = useRef(false);

  // Auto-initialize if requested
  useEffect(() => {
    if (
      options?.autoInit &&
      !hasInitialized.current &&
      !status?.initialized &&
      !isInitializing
    ) {
      hasInitialized.current = true;
      initialize(options.config || {});
    }
  }, [options?.autoInit, options?.config, status?.initialized, isInitializing, initialize]);

  return {
    // Status
    status,
    isInitialized: status?.initialized ?? false,
    isConnected: (status?.connectedPeers ?? 0) > 0,
    isLoadingStatus,

    // Lifecycle
    initialize,
    shutdown,
    isInitializing,
    isShuttingDown,

    // Events
    events,
    latestEvent,
    clearEvents,

    // Peers
    peers,
    connections: connections ?? [],
    connectPeer,
    disconnectPeer,

    // Jobs
    jobs,
    activeJobs,
    pendingJobs,
    createJob,
    acceptJob,
    cancelJob,

    // Content
    fetchContent,
    pinContent,
    unpinContent,
    storeContent,
    activeFetches,

    // Telemetry
    jobStats,
    systemMetrics,
    networkMetrics,
  };
}
