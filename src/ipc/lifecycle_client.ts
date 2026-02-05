/**
 * Creator Lifecycle IPC Client
 *
 * Renderer-side client for the lifecycle engine, exposing all 7 stages:
 *   Create → Verify → Use → Receipts → Rewards → Reputation → Better Create
 */

import type { IpcRenderer } from "electron";

// Re-export types for renderer consumers
export type {
  AssetType,
  UsageEventType,
  VerificationType,
  RewardTrigger,
  RewardCurrency,
  TrustTier,
  FeedbackType,
  UsageEventInput,
  VerificationInput,
  RewardInput,
  FeedbackInput,
  LifecycleSummary,
  ReputationSnapshot,
  LifecycleStats,
} from "../lib/lifecycle_engine";

import type {
  AssetType,
  UsageEventInput,
  VerificationInput,
  RewardInput,
  FeedbackInput,
  LifecycleSummary,
  ReputationSnapshot,
  LifecycleStats,
} from "../lib/lifecycle_engine";

// =============================================================================
// CLIENT
// =============================================================================

class LifecycleClient {
  private ipc: IpcRenderer;

  constructor() {
    this.ipc = (window as unknown as { electron: { ipcRenderer: IpcRenderer } })
      .electron.ipcRenderer;
  }

  // ---------------------------------------------------------------------------
  // 1. CREATE
  // ---------------------------------------------------------------------------

  async recordCreation(
    assetId: string,
    assetType: AssetType,
    actorId: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ eventId: string }> {
    return this.ipc.invoke("lifecycle:create", {
      assetId,
      assetType,
      actorId,
      metadata,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. VERIFY
  // ---------------------------------------------------------------------------

  async recordVerification(
    input: VerificationInput,
  ): Promise<{ recordId: string }> {
    return this.ipc.invoke("lifecycle:verify", input);
  }

  // ---------------------------------------------------------------------------
  // 3. USE
  // ---------------------------------------------------------------------------

  async recordUsage(
    input: UsageEventInput,
  ): Promise<{ eventId: string }> {
    return this.ipc.invoke("lifecycle:use", input);
  }

  // ---------------------------------------------------------------------------
  // 4. RECEIPTS
  // ---------------------------------------------------------------------------

  async recordReceipt(params: {
    assetId: string;
    assetType: AssetType;
    actorId: string;
    receiptCid: string;
    celestiaBlobHash?: string;
    relatedUsageEventId?: string;
  }): Promise<{ eventId: string }> {
    return this.ipc.invoke("lifecycle:receipt", params);
  }

  // ---------------------------------------------------------------------------
  // 5. REWARDS
  // ---------------------------------------------------------------------------

  async issueReward(
    input: RewardInput,
  ): Promise<{ rewardId: string }> {
    return this.ipc.invoke("lifecycle:reward:issue", input);
  }

  async getRewardsSummary(
    recipientId: string,
  ): Promise<{
    total: Record<string, string>;
    pending: Record<string, string>;
    count: number;
  }> {
    return this.ipc.invoke("lifecycle:reward:summary", { recipientId });
  }

  // ---------------------------------------------------------------------------
  // 6. REPUTATION
  // ---------------------------------------------------------------------------

  async getReputation(
    actorId: string,
  ): Promise<ReputationSnapshot | null> {
    return this.ipc.invoke("lifecycle:reputation:get", { actorId });
  }

  async recomputeReputation(
    actorId: string,
  ): Promise<ReputationSnapshot> {
    return this.ipc.invoke("lifecycle:reputation:recompute", { actorId });
  }

  // ---------------------------------------------------------------------------
  // 7. BETTER CREATE — Feedback
  // ---------------------------------------------------------------------------

  async createFeedback(
    input: FeedbackInput,
  ): Promise<{ feedbackId: string }> {
    return this.ipc.invoke("lifecycle:feedback:create", input);
  }

  async listFeedback(
    assetId: string,
    limit?: number,
  ): Promise<Array<Record<string, unknown>>> {
    return this.ipc.invoke("lifecycle:feedback:list", { assetId, limit });
  }

  async resolveFeedback(
    feedbackId: string,
    note: string,
  ): Promise<{ success: boolean }> {
    return this.ipc.invoke("lifecycle:feedback:resolve", { feedbackId, note });
  }

  async autoGenerateFeedback(
    assetId: string,
    assetType: AssetType,
  ): Promise<{ feedbackIds: string[] }> {
    return this.ipc.invoke("lifecycle:feedback:auto", { assetId, assetType });
  }

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  async getAssetLifecycle(
    assetId: string,
  ): Promise<LifecycleSummary | null> {
    return this.ipc.invoke("lifecycle:asset:summary", { assetId });
  }

  async getLifecycleStats(): Promise<LifecycleStats> {
    return this.ipc.invoke("lifecycle:stats");
  }

  async updateStreak(actorId: string): Promise<{ success: boolean }> {
    return this.ipc.invoke("lifecycle:streak:update", { actorId });
  }
}

// Singleton export
export const lifecycleClient = new LifecycleClient();
export default lifecycleClient;
