/**
 * Creator Lifecycle IPC Handlers
 *
 * Exposes the lifecycle engine to the renderer for the full loop:
 *   Create → Verify → Use → Receipts → Rewards → Reputation → Better Create
 *
 * IPC channels:
 *   lifecycle:create            – Record asset creation
 *   lifecycle:verify            – Record verification
 *   lifecycle:use               – Record usage event
 *   lifecycle:receipt           – Record receipt/proof
 *   lifecycle:reward:issue      – Issue a reward
 *   lifecycle:reward:summary    – Get reward summary
 *   lifecycle:reputation:get    – Get reputation snapshot
 *   lifecycle:reputation:recompute – Recompute reputation
 *   lifecycle:feedback:create   – Submit feedback
 *   lifecycle:feedback:list     – Get feedback for asset
 *   lifecycle:feedback:resolve  – Resolve feedback
 *   lifecycle:feedback:auto     – Auto-generate feedback
 *   lifecycle:asset:summary     – Full lifecycle summary for an asset
 *   lifecycle:stats             – Global lifecycle stats
 *   lifecycle:streak:update     – Update daily streak
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import {
  lifecycleEngine,
  type AssetType,
  type UsageEventInput,
  type VerificationInput,
  type RewardInput,
  type FeedbackInput,
  type LifecycleSummary,
  type ReputationSnapshot,
  type LifecycleStats,
} from "../../lib/lifecycle_engine";

const logger = log.scope("lifecycle_handlers");

export function registerLifecycleHandlers(): void {
  logger.info("Registering lifecycle handlers...");

  // ---------------------------------------------------------------------------
  // 1. CREATE
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "lifecycle:create",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        assetId: string;
        assetType: AssetType;
        actorId: string;
        metadata?: Record<string, unknown>;
      },
    ): Promise<{ eventId: string }> => {
      const eventId = await lifecycleEngine.recordCreation(
        params.assetId,
        params.assetType,
        params.actorId,
        params.metadata,
      );
      return { eventId };
    },
  );

  // ---------------------------------------------------------------------------
  // 2. VERIFY
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "lifecycle:verify",
    async (
      _event: IpcMainInvokeEvent,
      params: VerificationInput,
    ): Promise<{ recordId: string }> => {
      const recordId = await lifecycleEngine.recordVerification(params);
      return { recordId };
    },
  );

  // ---------------------------------------------------------------------------
  // 3. USE
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "lifecycle:use",
    async (
      _event: IpcMainInvokeEvent,
      params: UsageEventInput,
    ): Promise<{ eventId: string }> => {
      const eventId = await lifecycleEngine.recordUsage(params);
      return { eventId };
    },
  );

  // ---------------------------------------------------------------------------
  // 4. RECEIPTS
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "lifecycle:receipt",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        assetId: string;
        assetType: AssetType;
        actorId: string;
        receiptCid: string;
        celestiaBlobHash?: string;
        relatedUsageEventId?: string;
      },
    ): Promise<{ eventId: string }> => {
      const eventId = await lifecycleEngine.recordReceipt(
        params.assetId,
        params.assetType,
        params.actorId,
        params.receiptCid,
        params.celestiaBlobHash,
        params.relatedUsageEventId,
      );
      return { eventId };
    },
  );

  // ---------------------------------------------------------------------------
  // 5. REWARDS
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "lifecycle:reward:issue",
    async (
      _event: IpcMainInvokeEvent,
      params: RewardInput,
    ): Promise<{ rewardId: string }> => {
      const rewardId = await lifecycleEngine.issueReward(params);
      return { rewardId };
    },
  );

  ipcMain.handle(
    "lifecycle:reward:summary",
    async (
      _event: IpcMainInvokeEvent,
      params: { recipientId: string },
    ): Promise<{
      total: Record<string, string>;
      pending: Record<string, string>;
      count: number;
    }> => {
      return lifecycleEngine.getRewardsSummary(params.recipientId);
    },
  );

  // ---------------------------------------------------------------------------
  // 6. REPUTATION
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "lifecycle:reputation:get",
    async (
      _event: IpcMainInvokeEvent,
      params: { actorId: string },
    ): Promise<ReputationSnapshot | null> => {
      return lifecycleEngine.getReputation(params.actorId);
    },
  );

  ipcMain.handle(
    "lifecycle:reputation:recompute",
    async (
      _event: IpcMainInvokeEvent,
      params: { actorId: string },
    ): Promise<ReputationSnapshot> => {
      return lifecycleEngine.recomputeReputation(params.actorId);
    },
  );

  // ---------------------------------------------------------------------------
  // 7. BETTER CREATE — Feedback
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "lifecycle:feedback:create",
    async (
      _event: IpcMainInvokeEvent,
      params: FeedbackInput,
    ): Promise<{ feedbackId: string }> => {
      const feedbackId = await lifecycleEngine.generateFeedback(params);
      return { feedbackId };
    },
  );

  ipcMain.handle(
    "lifecycle:feedback:list",
    async (
      _event: IpcMainInvokeEvent,
      params: { assetId: string; limit?: number },
    ): Promise<Array<Record<string, unknown>>> => {
      const items = await lifecycleEngine.getFeedbackForAsset(
        params.assetId,
        params.limit,
      );
      return items as unknown as Array<Record<string, unknown>>;
    },
  );

  ipcMain.handle(
    "lifecycle:feedback:resolve",
    async (
      _event: IpcMainInvokeEvent,
      params: { feedbackId: string; note: string },
    ): Promise<{ success: boolean }> => {
      await lifecycleEngine.resolveFeedback(params.feedbackId, params.note);
      return { success: true };
    },
  );

  ipcMain.handle(
    "lifecycle:feedback:auto",
    async (
      _event: IpcMainInvokeEvent,
      params: { assetId: string; assetType: AssetType },
    ): Promise<{ feedbackIds: string[] }> => {
      const feedbackIds = await lifecycleEngine.autoGenerateFeedback(
        params.assetId,
        params.assetType,
      );
      return { feedbackIds };
    },
  );

  // ---------------------------------------------------------------------------
  // LIFECYCLE QUERIES
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "lifecycle:asset:summary",
    async (
      _event: IpcMainInvokeEvent,
      params: { assetId: string },
    ): Promise<LifecycleSummary | null> => {
      return lifecycleEngine.getAssetLifecycle(params.assetId);
    },
  );

  ipcMain.handle(
    "lifecycle:stats",
    async (): Promise<LifecycleStats> => {
      return lifecycleEngine.getLifecycleStats();
    },
  );

  ipcMain.handle(
    "lifecycle:streak:update",
    async (
      _event: IpcMainInvokeEvent,
      params: { actorId: string },
    ): Promise<{ success: boolean }> => {
      await lifecycleEngine.updateStreak(params.actorId);
      return { success: true };
    },
  );

  logger.info("✅ Lifecycle handlers registered");
}

export default registerLifecycleHandlers;
