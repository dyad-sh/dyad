/**
 * useCreatorLifecycle — React hook for the full creator lifecycle loop
 *
 * Wraps lifecycle IPC client with TanStack Query for caching, polling,
 * invalidation, and optimistic updates.
 *
 * Provides:
 *   - Asset lifecycle summary
 *   - Reputation display
 *   - Rewards summary
 *   - Feedback list + mutations
 *   - Global lifecycle stats
 *   - Action mutations (create, verify, use, receipt, reward)
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  lifecycleClient,
  type AssetType,
  type UsageEventInput,
  type VerificationInput,
  type RewardInput,
  type FeedbackInput,
  type LifecycleSummary,
  type ReputationSnapshot,
  type LifecycleStats,
} from "@/ipc/lifecycle_client";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const LIFECYCLE_KEYS = {
  all: ["lifecycle"] as const,
  asset: (id: string) => ["lifecycle", "asset", id] as const,
  reputation: (actorId: string) => ["lifecycle", "reputation", actorId] as const,
  rewards: (actorId: string) => ["lifecycle", "rewards", actorId] as const,
  feedback: (assetId: string) => ["lifecycle", "feedback", assetId] as const,
  stats: ["lifecycle", "stats"] as const,
};

// =============================================================================
// HOOK
// =============================================================================

export function useCreatorLifecycle(opts?: {
  /** Asset ID to watch — enables asset-level queries */
  assetId?: string;
  /** Actor ID — enables reputation + rewards queries */
  actorId?: string;
  /** Poll interval for stats (default 30s) */
  statsInterval?: number;
  /** Disable automatic polling */
  disablePolling?: boolean;
}) {
  const qc = useQueryClient();
  const { assetId, actorId, statsInterval = 30_000, disablePolling } = opts ?? {};

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  /** Full lifecycle summary for an asset */
  const lifecycleQuery = useQuery<LifecycleSummary | null>({
    queryKey: LIFECYCLE_KEYS.asset(assetId ?? ""),
    queryFn: () => lifecycleClient.getAssetLifecycle(assetId!),
    enabled: !!assetId,
    staleTime: 10_000,
  });

  /** Reputation snapshot for an actor */
  const reputationQuery = useQuery<ReputationSnapshot | null>({
    queryKey: LIFECYCLE_KEYS.reputation(actorId ?? ""),
    queryFn: () => lifecycleClient.getReputation(actorId!),
    enabled: !!actorId,
    staleTime: 15_000,
  });

  /** Rewards summary for an actor */
  const rewardsQuery = useQuery<{
    total: Record<string, string>;
    pending: Record<string, string>;
    count: number;
  }>({
    queryKey: LIFECYCLE_KEYS.rewards(actorId ?? ""),
    queryFn: () => lifecycleClient.getRewardsSummary(actorId!),
    enabled: !!actorId,
    staleTime: 15_000,
  });

  /** Feedback entries for an asset */
  const feedbackQuery = useQuery<Array<Record<string, unknown>>>({
    queryKey: LIFECYCLE_KEYS.feedback(assetId ?? ""),
    queryFn: () => lifecycleClient.listFeedback(assetId!, 50),
    enabled: !!assetId,
    staleTime: 10_000,
  });

  /** Global lifecycle stats (polls periodically) */
  const statsQuery = useQuery<LifecycleStats>({
    queryKey: LIFECYCLE_KEYS.stats,
    queryFn: () => lifecycleClient.getLifecycleStats(),
    staleTime: 20_000,
    refetchInterval: disablePolling ? false : statsInterval,
  });

  // ---------------------------------------------------------------------------
  // HELPER — invalidate everything related to an asset or actor
  // ---------------------------------------------------------------------------

  function invalidateAsset(id: string) {
    qc.invalidateQueries({ queryKey: LIFECYCLE_KEYS.asset(id) });
    qc.invalidateQueries({ queryKey: LIFECYCLE_KEYS.feedback(id) });
    qc.invalidateQueries({ queryKey: LIFECYCLE_KEYS.stats });
  }

  function invalidateActor(id: string) {
    qc.invalidateQueries({ queryKey: LIFECYCLE_KEYS.reputation(id) });
    qc.invalidateQueries({ queryKey: LIFECYCLE_KEYS.rewards(id) });
  }

  // ---------------------------------------------------------------------------
  // MUTATIONS — 1. CREATE
  // ---------------------------------------------------------------------------

  const recordCreation = useMutation({
    mutationFn: (params: {
      assetId: string;
      assetType: AssetType;
      actorId: string;
      metadata?: Record<string, unknown>;
    }) =>
      lifecycleClient.recordCreation(
        params.assetId,
        params.assetType,
        params.actorId,
        params.metadata,
      ),
    onSuccess: (_data, vars) => {
      invalidateAsset(vars.assetId);
      invalidateActor(vars.actorId);
      toast.success("Creation recorded in lifecycle");
    },
    onError: (err: Error) => {
      toast.error(`Failed to record creation: ${err.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // MUTATIONS — 2. VERIFY
  // ---------------------------------------------------------------------------

  const recordVerification = useMutation({
    mutationFn: (input: VerificationInput) =>
      lifecycleClient.recordVerification(input),
    onSuccess: (_data, vars) => {
      invalidateAsset(vars.assetId);
      invalidateActor(vars.verifierId);
      toast.success(
        vars.passed ? "✅ Verification passed" : "⚠️ Verification failed",
      );
    },
    onError: (err: Error) => {
      toast.error(`Verification error: ${err.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // MUTATIONS — 3. USE
  // ---------------------------------------------------------------------------

  const recordUsage = useMutation({
    mutationFn: (input: UsageEventInput) =>
      lifecycleClient.recordUsage(input),
    onSuccess: (_data, vars) => {
      invalidateAsset(vars.assetId);
      qc.invalidateQueries({ queryKey: LIFECYCLE_KEYS.stats });
    },
    onError: (err: Error) => {
      toast.error(`Failed to record usage: ${err.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // MUTATIONS — 4. RECEIPT
  // ---------------------------------------------------------------------------

  const recordReceipt = useMutation({
    mutationFn: (params: {
      assetId: string;
      assetType: AssetType;
      actorId: string;
      receiptCid: string;
      celestiaBlobHash?: string;
      relatedUsageEventId?: string;
    }) => lifecycleClient.recordReceipt(params),
    onSuccess: (_data, vars) => {
      invalidateAsset(vars.assetId);
      invalidateActor(vars.actorId);
      toast.success("Receipt anchored");
    },
    onError: (err: Error) => {
      toast.error(`Receipt failed: ${err.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // MUTATIONS — 5. REWARD
  // ---------------------------------------------------------------------------

  const issueReward = useMutation({
    mutationFn: (input: RewardInput) =>
      lifecycleClient.issueReward(input),
    onSuccess: (_data, vars) => {
      invalidateActor(vars.recipientId);
      qc.invalidateQueries({ queryKey: LIFECYCLE_KEYS.stats });
      toast.success(`Reward issued: ${vars.amount} ${vars.currency}`);
    },
    onError: (err: Error) => {
      toast.error(`Reward failed: ${err.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // MUTATIONS — 6. REPUTATION RECOMPUTE
  // ---------------------------------------------------------------------------

  const recomputeReputation = useMutation({
    mutationFn: (params: { actorId: string }) =>
      lifecycleClient.recomputeReputation(params.actorId),
    onSuccess: (_data, vars) => {
      invalidateActor(vars.actorId);
      toast.success("Reputation recomputed");
    },
    onError: (err: Error) => {
      toast.error(`Reputation recompute failed: ${err.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // MUTATIONS — 7. FEEDBACK (Better Create)
  // ---------------------------------------------------------------------------

  const createFeedback = useMutation({
    mutationFn: (input: FeedbackInput) =>
      lifecycleClient.createFeedback(input),
    onSuccess: (_data, vars) => {
      invalidateAsset(vars.assetId);
      toast.success("Feedback submitted");
    },
    onError: (err: Error) => {
      toast.error(`Feedback failed: ${err.message}`);
    },
  });

  const resolveFeedback = useMutation({
    mutationFn: (params: { feedbackId: string; note: string; assetId: string }) =>
      lifecycleClient.resolveFeedback(params.feedbackId, params.note),
    onSuccess: (_data, vars) => {
      invalidateAsset(vars.assetId);
      toast.success("Feedback resolved");
    },
    onError: (err: Error) => {
      toast.error(`Resolve failed: ${err.message}`);
    },
  });

  const autoGenerateFeedback = useMutation({
    mutationFn: (params: { assetId: string; assetType: AssetType }) =>
      lifecycleClient.autoGenerateFeedback(params.assetId, params.assetType),
    onSuccess: (data, vars) => {
      invalidateAsset(vars.assetId);
      if (data.feedbackIds.length > 0) {
        toast.success(
          `Generated ${data.feedbackIds.length} feedback item(s)`,
        );
      } else {
        toast.info("No feedback to generate — looking good!");
      }
    },
    onError: (err: Error) => {
      toast.error(`Auto-feedback failed: ${err.message}`);
    },
  });

  // ---------------------------------------------------------------------------
  // STREAK
  // ---------------------------------------------------------------------------

  const updateStreak = useMutation({
    mutationFn: (params: { actorId: string }) =>
      lifecycleClient.updateStreak(params.actorId),
    onSuccess: (_data, vars) => {
      invalidateActor(vars.actorId);
    },
  });

  // ---------------------------------------------------------------------------
  // RETURN
  // ---------------------------------------------------------------------------

  return {
    // Queries
    lifecycle: lifecycleQuery.data ?? null,
    lifecycleLoading: lifecycleQuery.isLoading,

    reputation: reputationQuery.data ?? null,
    reputationLoading: reputationQuery.isLoading,

    rewards: rewardsQuery.data ?? null,
    rewardsLoading: rewardsQuery.isLoading,

    feedback: feedbackQuery.data ?? [],
    feedbackLoading: feedbackQuery.isLoading,

    stats: statsQuery.data ?? null,
    statsLoading: statsQuery.isLoading,

    // Mutations
    recordCreation,
    recordVerification,
    recordUsage,
    recordReceipt,
    issueReward,
    recomputeReputation,
    createFeedback,
    resolveFeedback,
    autoGenerateFeedback,
    updateStreak,

    // Helpers
    invalidateAsset,
    invalidateActor,
    refetchAll: () => {
      qc.invalidateQueries({ queryKey: LIFECYCLE_KEYS.all });
    },
  };
}

export default useCreatorLifecycle;
