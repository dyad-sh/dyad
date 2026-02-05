/**
 * useCelestiaBlobs — React hook for Celestia blob operations
 *
 * Wraps the Celestia blob IPC client with TanStack Query for
 * caching, polling, and mutation management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  celestiaBlobClient,
  type BlobSubmission,
  type CelestiaStatus,
  type BlobStats,
} from "@/ipc/celestia_blob_client";
import { toast } from "sonner";

// =============================================================================
// QUERY KEYS
// =============================================================================

const CELESTIA_KEYS = {
  status: ["celestia", "status"] as const,
  blobs: ["celestia", "blobs"] as const,
  stats: ["celestia", "stats"] as const,
  config: ["celestia", "config"] as const,
  blob: (hash: string) => ["celestia", "blob", hash] as const,
};

// =============================================================================
// HOOK
// =============================================================================

export function useCelestiaBlobs() {
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  /** Celestia node availability + sync status (polls every 15s) */
  const statusQuery = useQuery<CelestiaStatus>({
    queryKey: CELESTIA_KEYS.status,
    queryFn: () => celestiaBlobClient.getStatus(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  /** All blob submissions from the local index */
  const blobsQuery = useQuery<BlobSubmission[]>({
    queryKey: CELESTIA_KEYS.blobs,
    queryFn: () => celestiaBlobClient.listBlobs({ limit: 200 }),
    staleTime: 5_000,
  });

  /** Aggregate stats */
  const statsQuery = useQuery<BlobStats>({
    queryKey: CELESTIA_KEYS.stats,
    queryFn: () => celestiaBlobClient.getStats(),
    staleTime: 10_000,
  });

  // ---------------------------------------------------------------------------
  // MUTATIONS
  // ---------------------------------------------------------------------------

  /** Submit raw base64 data as a hashed blob */
  const submitBlobMutation = useMutation({
    mutationFn: (params: {
      data: string;
      label?: string;
      dataType?: string;
      encrypt?: boolean;
    }) => celestiaBlobClient.submitBlob(params),
    onMutate: () => {
      toast.loading("Submitting blob to Celestia...", { id: "celestia-submit" });
    },
    onSuccess: (result) => {
      toast.success(
        `Blob submitted at height ${result.height} (${result.contentHash.slice(0, 12)}...)`,
        { id: "celestia-submit" },
      );
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.blobs });
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.stats });
    },
    onError: (error) => {
      toast.error(
        `Blob submission failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        { id: "celestia-submit" },
      );
    },
  });

  /** Submit JSON as a hashed blob */
  const submitJSONMutation = useMutation({
    mutationFn: (params: {
      json: unknown;
      label?: string;
      dataType?: string;
      encrypt?: boolean;
    }) => celestiaBlobClient.submitJSON(params),
    onSuccess: (result) => {
      toast.success(
        `JSON blob submitted (${result.contentHash.slice(0, 12)}...)`,
      );
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.blobs });
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.stats });
    },
    onError: (error) => {
      toast.error(
        `JSON blob failed: ${error instanceof Error ? error.message : "Unknown"}`,
      );
    },
  });

  /** Submit a file from disk */
  const submitFileMutation = useMutation({
    mutationFn: (params: {
      filePath: string;
      label?: string;
      dataType?: string;
      encrypt?: boolean;
    }) => celestiaBlobClient.submitFile(params),
    onSuccess: (result) => {
      toast.success(
        `File blob submitted (${result.contentHash.slice(0, 12)}...)`,
      );
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.blobs });
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.stats });
    },
    onError: (error) => {
      toast.error(
        `File blob failed: ${error instanceof Error ? error.message : "Unknown"}`,
      );
    },
  });

  /** Verify a blob's integrity */
  const verifyMutation = useMutation({
    mutationFn: (contentHash: string) =>
      celestiaBlobClient.verifyBlob(contentHash),
    onSuccess: (result) => {
      if (result.verified) {
        toast.success("Blob integrity verified ✅");
      } else {
        toast.warning(`Verification issue: ${result.error ?? "Unknown"}`);
      }
    },
    onError: (error) => {
      toast.error(
        `Verification failed: ${error instanceof Error ? error.message : "Unknown"}`,
      );
    },
  });

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  const isAvailable = statusQuery.data?.available ?? false;
  const nodeHeight = statusQuery.data?.height;
  const isSyncing = statusQuery.data?.syncing ?? false;
  const balance = statusQuery.data?.balance;
  const walletAddress = statusQuery.data?.walletAddress;
  const network = statusQuery.data?.network;

  return {
    // Status
    isAvailable,
    nodeHeight,
    isSyncing,
    balance,
    walletAddress,
    network,
    status: statusQuery.data,
    statusLoading: statusQuery.isLoading,

    // Blob list
    blobs: blobsQuery.data ?? [],
    blobsLoading: blobsQuery.isLoading,

    // Stats
    stats: statsQuery.data,
    statsLoading: statsQuery.isLoading,

    // Mutations
    submitBlob: submitBlobMutation.mutate,
    submitJSON: submitJSONMutation.mutate,
    submitFile: submitFileMutation.mutate,
    verifyBlob: verifyMutation.mutate,

    // Mutation states
    isSubmitting:
      submitBlobMutation.isPending ||
      submitJSONMutation.isPending ||
      submitFileMutation.isPending,
    isVerifying: verifyMutation.isPending,

    // Refresh
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.blobs });
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.stats });
      queryClient.invalidateQueries({ queryKey: CELESTIA_KEYS.status });
    },
  };
}

export default useCelestiaBlobs;
