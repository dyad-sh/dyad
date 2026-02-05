/**
 * Creator Lifecycle Engine
 *
 * Orchestrates the full loop:
 *   Create → Verify → Use → Receipts → Rewards → Reputation → Better Create
 *
 * Each stage records a lifecycle event, updates reputation, and triggers
 * the next applicable stage when conditions are met.
 *
 * Usage:
 *   lifecycleEngine.recordCreation(assetId, assetType, actorId)
 *   lifecycleEngine.recordVerification(assetId, ...)
 *   lifecycleEngine.recordUsage(assetId, ...)
 *   lifecycleEngine.recordReceipt(assetId, ...)
 *   lifecycleEngine.issueReward(recipientId, ...)
 *   lifecycleEngine.recomputeReputation(actorId)
 *   lifecycleEngine.generateFeedback(assetId, ...)
 */

import { v4 as uuidv4 } from "uuid";
import { eq, desc, and, gte, sql, count } from "drizzle-orm";
import log from "electron-log";
import { getDb } from "../db";
import {
  usageEvents,
  verificationRecords,
  rewardsLedger,
  reputationScores,
  lifecycleEvents,
  creatorFeedback,
  type LifecycleStage,
} from "../db/schema";

const logger = log.scope("lifecycle_engine");

// =============================================================================
// TYPES
// =============================================================================

export type AssetType =
  | "model"
  | "dataset"
  | "agent"
  | "workflow"
  | "prompt"
  | "template"
  | "plugin"
  | "api";

export type UsageEventType =
  | "inference"
  | "download"
  | "fork"
  | "reference"
  | "api_call"
  | "embed"
  | "fine_tune";

export type VerificationType =
  | "quality_check"
  | "integrity_hash"
  | "celestia_anchor"
  | "peer_review"
  | "license_compliance"
  | "safety_scan"
  | "benchmark"
  | "format_validation";

export type RewardTrigger =
  | "usage_fee"
  | "verification_reward"
  | "curation_reward"
  | "compute_reward"
  | "quality_bonus"
  | "streak_bonus"
  | "referral";

export type RewardCurrency = "JOY" | "TIA" | "USDC" | "MATIC" | "points";

export type TrustTier = "newcomer" | "contributor" | "trusted" | "verified" | "elite";

export type FeedbackType =
  | "quality_suggestion"
  | "usage_insight"
  | "improvement_tip"
  | "peer_review_note"
  | "auto_recommendation"
  | "benchmark_result";

export interface UsageEventInput {
  assetId: string;
  assetType: AssetType;
  eventType: UsageEventType;
  consumerId?: string;
  consumerType?: "local" | "network" | "marketplace";
  units?: number;
  computeMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  dataBytesProcessed?: number;
  sessionId?: string;
  modelId?: string;
  metadata?: Record<string, unknown>;
}

export interface VerificationInput {
  assetId: string;
  assetType: AssetType;
  verifierId: string;
  verifierType: "automated" | "peer" | "self" | "system";
  verificationType: VerificationType;
  passed: boolean;
  score?: number;
  details?: string;
  evidenceCid?: string;
  evidence?: Record<string, unknown>;
}

export interface RewardInput {
  recipientId: string;
  recipientType: "creator" | "validator" | "curator" | "compute_provider";
  triggerType: RewardTrigger;
  triggerEventId?: string;
  amount: string;
  currency: RewardCurrency;
  assetId?: string;
  assetType?: string;
  metadata?: Record<string, unknown>;
}

export interface FeedbackInput {
  assetId: string;
  assetType: AssetType;
  feedbackType: FeedbackType;
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
  sourceType: "system" | "peer" | "analytics" | "quality_engine" | "user";
  sourceId?: string;
  data?: Record<string, unknown>;
}

export interface LifecycleSummary {
  assetId: string;
  assetType: string;
  currentStage: LifecycleStage;
  stages: {
    created: boolean;
    verified: boolean;
    published: boolean;
    inUse: boolean;
    receipted: boolean;
    rewarded: boolean;
  };
  usageCount: number;
  verificationCount: number;
  rewardTotal: string;
  feedbackCount: number;
  events: Array<{
    id: string;
    stage: string;
    createdAt: Date;
    metadata?: Record<string, unknown> | null;
  }>;
}

export interface ReputationSnapshot {
  id: string;
  overallScore: number;
  tier: TrustTier;
  creationScore: number;
  verificationScore: number;
  usageScore: number;
  rewardScore: number;
  consistencyScore: number;
  totalAssetsCreated: number;
  totalVerificationsPassed: number;
  totalVerificationsFailed: number;
  totalUsageEvents: number;
  totalRewardsEarned: string;
  totalReceiptsGenerated: number;
  currentStreak: number;
  longestStreak: number;
  averageQualityScore: number | null;
}

export interface LifecycleStats {
  totalAssets: number;
  totalUsageEvents: number;
  totalVerifications: number;
  totalRewards: number;
  totalFeedback: number;
  stageDistribution: Record<string, number>;
  recentActivity: Array<{
    id: string;
    stage: string;
    assetId: string;
    assetType: string;
    createdAt: Date;
  }>;
}

// =============================================================================
// TIER THRESHOLDS
// =============================================================================

const TIER_THRESHOLDS: Array<{ tier: TrustTier; minScore: number }> = [
  { tier: "elite", minScore: 800 },
  { tier: "verified", minScore: 600 },
  { tier: "trusted", minScore: 400 },
  { tier: "contributor", minScore: 150 },
  { tier: "newcomer", minScore: 0 },
];

// =============================================================================
// REWARD RATES
// =============================================================================

const REWARD_RATES: Record<string, { amount: string; currency: RewardCurrency }> = {
  inference:        { amount: "1",  currency: "points" },
  download:         { amount: "2",  currency: "points" },
  fork:             { amount: "5",  currency: "points" },
  fine_tune:        { amount: "10", currency: "points" },
  verification_pass:{ amount: "3",  currency: "points" },
  quality_bonus:    { amount: "15", currency: "points" },
  streak_7:         { amount: "25", currency: "points" },
  streak_30:        { amount: "100", currency: "points" },
};

// =============================================================================
// ENGINE
// =============================================================================

class LifecycleEngine {
  // ---------------------------------------------------------------------------
  // 1. CREATE
  // ---------------------------------------------------------------------------

  async recordCreation(
    assetId: string,
    assetType: AssetType,
    actorId: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const db = getDb();
    const eventId = uuidv4();

    await db.insert(lifecycleEvents).values({
      id: eventId,
      assetId,
      assetType,
      stage: "created",
      previousStage: null,
      actorId,
      metadataJson: metadata ?? null,
    });

    // Bump reputation creation count
    await this.incrementReputationStat(actorId, "totalAssetsCreated", 1);

    logger.info(`CREATE: asset=${assetId} type=${assetType} actor=${actorId}`);
    return eventId;
  }

  // ---------------------------------------------------------------------------
  // 2. VERIFY
  // ---------------------------------------------------------------------------

  async recordVerification(input: VerificationInput): Promise<string> {
    const db = getDb();
    const recordId = uuidv4();

    await db.insert(verificationRecords).values({
      id: recordId,
      assetId: input.assetId,
      assetType: input.assetType,
      verifierId: input.verifierId,
      verifierType: input.verifierType,
      verificationType: input.verificationType,
      passed: input.passed,
      score: input.score ?? null,
      details: input.details ?? null,
      errorMessage: null,
      evidenceJson: input.evidence ?? null,
      evidenceCid: input.evidenceCid ?? null,
    });

    // Record lifecycle event
    const eventId = uuidv4();
    await db.insert(lifecycleEvents).values({
      id: eventId,
      assetId: input.assetId,
      assetType: input.assetType,
      stage: "verified",
      previousStage: "created",
      actorId: input.verifierId,
      relatedEventId: recordId,
      relatedEventType: "verification",
    });

    // Bump reputation
    if (input.passed) {
      await this.incrementReputationStat(input.verifierId, "totalVerificationsPassed", 1);

      // Auto-reward verifiers
      await this.issueReward({
        recipientId: input.verifierId,
        recipientType: "validator",
        triggerType: "verification_reward",
        triggerEventId: recordId,
        amount: REWARD_RATES.verification_pass.amount,
        currency: REWARD_RATES.verification_pass.currency,
        assetId: input.assetId,
        assetType: input.assetType,
      });
    } else {
      await this.incrementReputationStat(input.verifierId, "totalVerificationsFailed", 1);
    }

    logger.info(
      `VERIFY: asset=${input.assetId} type=${input.verificationType} passed=${input.passed} score=${input.score}`,
    );
    return recordId;
  }

  // ---------------------------------------------------------------------------
  // 3. USE
  // ---------------------------------------------------------------------------

  async recordUsage(input: UsageEventInput): Promise<string> {
    const db = getDb();
    const eventId = uuidv4();

    await db.insert(usageEvents).values({
      id: eventId,
      assetId: input.assetId,
      assetType: input.assetType,
      eventType: input.eventType,
      consumerId: input.consumerId ?? null,
      consumerType: input.consumerType ?? null,
      units: input.units ?? 1,
      computeMs: input.computeMs ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      dataBytesProcessed: input.dataBytesProcessed ?? null,
      sessionId: input.sessionId ?? null,
      requestId: null,
      modelId: input.modelId ?? null,
      receiptId: null,
      receiptCid: null,
      metadataJson: input.metadata ?? null,
    });

    // Lifecycle event
    const lcEventId = uuidv4();
    await db.insert(lifecycleEvents).values({
      id: lcEventId,
      assetId: input.assetId,
      assetType: input.assetType,
      stage: "in_use",
      previousStage: "verified",
      actorId: input.consumerId ?? "anonymous",
      relatedEventId: eventId,
      relatedEventType: "usage",
    });

    // Bump reputation for the consumer
    if (input.consumerId) {
      await this.incrementReputationStat(input.consumerId, "totalUsageEvents", 1);
    }

    // Auto-reward the asset creator (usage fee)
    const rate = REWARD_RATES[input.eventType] ?? REWARD_RATES.inference;
    // We store a reward for the asset itself — the creator resolves via assetId
    await this.issueReward({
      recipientId: input.assetId, // creator looks up by assetId
      recipientType: "creator",
      triggerType: "usage_fee",
      triggerEventId: eventId,
      amount: rate.amount,
      currency: rate.currency,
      assetId: input.assetId,
      assetType: input.assetType,
    });

    logger.info(
      `USE: asset=${input.assetId} event=${input.eventType} units=${input.units ?? 1}`,
    );
    return eventId;
  }

  // ---------------------------------------------------------------------------
  // 4. RECEIPTS
  // ---------------------------------------------------------------------------

  async recordReceipt(
    assetId: string,
    assetType: AssetType,
    actorId: string,
    receiptCid: string,
    celestiaBlobHash?: string,
    relatedUsageEventId?: string,
  ): Promise<string> {
    const db = getDb();
    const eventId = uuidv4();

    await db.insert(lifecycleEvents).values({
      id: eventId,
      assetId,
      assetType,
      stage: "receipted",
      previousStage: "in_use",
      actorId,
      relatedEventId: relatedUsageEventId ?? null,
      relatedEventType: relatedUsageEventId ? "usage" : null,
      receiptCid,
      celestiaBlobHash: celestiaBlobHash ?? null,
    });

    // Link receipt to usage event if provided
    if (relatedUsageEventId) {
      await db
        .update(usageEvents)
        .set({ receiptId: eventId, receiptCid })
        .where(eq(usageEvents.id, relatedUsageEventId));
    }

    // Bump reputation
    await this.incrementReputationStat(actorId, "totalReceiptsGenerated", 1);

    logger.info(
      `RECEIPT: asset=${assetId} cid=${receiptCid} celestia=${celestiaBlobHash ?? "none"}`,
    );
    return eventId;
  }

  // ---------------------------------------------------------------------------
  // 5. REWARDS
  // ---------------------------------------------------------------------------

  async issueReward(input: RewardInput): Promise<string> {
    const db = getDb();
    const rewardId = uuidv4();

    await db.insert(rewardsLedger).values({
      id: rewardId,
      recipientId: input.recipientId,
      recipientType: input.recipientType,
      triggerType: input.triggerType,
      triggerEventId: input.triggerEventId ?? null,
      amount: input.amount,
      currency: input.currency,
      status: "confirmed", // points are instant; on-chain starts as "pending"
      txHash: null,
      network: null,
      assetId: input.assetId ?? null,
      assetType: input.assetType ?? null,
      metadataJson: input.metadata ?? null,
      paidOutAt: null,
    });

    // Lifecycle event
    if (input.assetId && input.assetType) {
      const eventId = uuidv4();
      await db.insert(lifecycleEvents).values({
        id: eventId,
        assetId: input.assetId,
        assetType: input.assetType as AssetType,
        stage: "rewarded",
        previousStage: "receipted",
        actorId: input.recipientId,
        relatedEventId: rewardId,
        relatedEventType: "reward",
      });
    }

    logger.info(
      `REWARD: recipient=${input.recipientId} amount=${input.amount} ${input.currency} trigger=${input.triggerType}`,
    );
    return rewardId;
  }

  async getRewardsForRecipient(
    recipientId: string,
    limit = 50,
  ): Promise<Array<typeof rewardsLedger.$inferSelect>> {
    const db = getDb();
    return db
      .select()
      .from(rewardsLedger)
      .where(eq(rewardsLedger.recipientId, recipientId))
      .orderBy(desc(rewardsLedger.createdAt))
      .limit(limit);
  }

  async getRewardsSummary(recipientId: string): Promise<{
    total: Record<string, string>;
    pending: Record<string, string>;
    count: number;
  }> {
    const db = getDb();
    const rewards = await db
      .select()
      .from(rewardsLedger)
      .where(eq(rewardsLedger.recipientId, recipientId));

    const total: Record<string, number> = {};
    const pending: Record<string, number> = {};
    for (const r of rewards) {
      const amt = parseFloat(r.amount);
      total[r.currency] = (total[r.currency] ?? 0) + amt;
      if (r.status === "pending") {
        pending[r.currency] = (pending[r.currency] ?? 0) + amt;
      }
    }

    const fmt = (m: Record<string, number>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)]));

    return { total: fmt(total), pending: fmt(pending), count: rewards.length };
  }

  // ---------------------------------------------------------------------------
  // 6. REPUTATION
  // ---------------------------------------------------------------------------

  async recomputeReputation(actorId: string): Promise<ReputationSnapshot> {
    const db = getDb();

    // Get or create reputation record
    let [rep] = await db
      .select()
      .from(reputationScores)
      .where(eq(reputationScores.id, actorId))
      .limit(1);

    if (!rep) {
      await db.insert(reputationScores).values({
        id: actorId,
        overallScore: 0,
        creationScore: 0,
        verificationScore: 0,
        usageScore: 0,
        rewardScore: 0,
        consistencyScore: 0,
        tier: "newcomer",
        totalAssetsCreated: 0,
        totalVerificationsPassed: 0,
        totalVerificationsFailed: 0,
        totalUsageEvents: 0,
        totalRewardsEarned: "0",
        totalReceiptsGenerated: 0,
        currentStreak: 0,
        longestStreak: 0,
        averageQualityScore: null,
      });
      [rep] = await db
        .select()
        .from(reputationScores)
        .where(eq(reputationScores.id, actorId))
        .limit(1);
    }

    // Compute component scores (each 0-1000)
    const creationScore = Math.min(1000, rep.totalAssetsCreated * 50);

    const verifyTotal = rep.totalVerificationsPassed + rep.totalVerificationsFailed;
    const verifyRate = verifyTotal > 0 ? rep.totalVerificationsPassed / verifyTotal : 0;
    const verificationScore = Math.min(1000, Math.round(verifyRate * 500 + verifyTotal * 10));

    const usageScore = Math.min(1000, rep.totalUsageEvents * 5);

    const totalRewardsNum = parseFloat(rep.totalRewardsEarned) || 0;
    const rewardScore = Math.min(1000, Math.round(totalRewardsNum * 2));

    // Consistency: streak-based
    const consistencyScore = Math.min(
      1000,
      rep.currentStreak * 15 + rep.longestStreak * 5,
    );

    // Overall = weighted average
    const overallScore = Math.round(
      creationScore * 0.2 +
      verificationScore * 0.25 +
      usageScore * 0.25 +
      rewardScore * 0.15 +
      consistencyScore * 0.15,
    );

    // Determine tier
    const tier = TIER_THRESHOLDS.find((t) => overallScore >= t.minScore)?.tier ?? "newcomer";

    await db
      .update(reputationScores)
      .set({
        overallScore,
        creationScore,
        verificationScore,
        usageScore,
        rewardScore,
        consistencyScore,
        tier,
        updatedAt: new Date(),
      })
      .where(eq(reputationScores.id, actorId));

    logger.info(`REPUTATION: actor=${actorId} score=${overallScore} tier=${tier}`);

    return {
      id: actorId,
      overallScore,
      tier: tier as TrustTier,
      creationScore,
      verificationScore,
      usageScore,
      rewardScore,
      consistencyScore,
      totalAssetsCreated: rep.totalAssetsCreated,
      totalVerificationsPassed: rep.totalVerificationsPassed,
      totalVerificationsFailed: rep.totalVerificationsFailed,
      totalUsageEvents: rep.totalUsageEvents,
      totalRewardsEarned: rep.totalRewardsEarned,
      totalReceiptsGenerated: rep.totalReceiptsGenerated,
      currentStreak: rep.currentStreak,
      longestStreak: rep.longestStreak,
      averageQualityScore: rep.averageQualityScore,
    };
  }

  async getReputation(actorId: string): Promise<ReputationSnapshot | null> {
    const db = getDb();
    const [rep] = await db
      .select()
      .from(reputationScores)
      .where(eq(reputationScores.id, actorId))
      .limit(1);

    if (!rep) return null;

    return {
      id: rep.id,
      overallScore: rep.overallScore,
      tier: rep.tier as TrustTier,
      creationScore: rep.creationScore,
      verificationScore: rep.verificationScore,
      usageScore: rep.usageScore,
      rewardScore: rep.rewardScore,
      consistencyScore: rep.consistencyScore,
      totalAssetsCreated: rep.totalAssetsCreated,
      totalVerificationsPassed: rep.totalVerificationsPassed,
      totalVerificationsFailed: rep.totalVerificationsFailed,
      totalUsageEvents: rep.totalUsageEvents,
      totalRewardsEarned: rep.totalRewardsEarned,
      totalReceiptsGenerated: rep.totalReceiptsGenerated,
      currentStreak: rep.currentStreak,
      longestStreak: rep.longestStreak,
      averageQualityScore: rep.averageQualityScore,
    };
  }

  // ---------------------------------------------------------------------------
  // 7. BETTER CREATE — Feedback
  // ---------------------------------------------------------------------------

  async generateFeedback(input: FeedbackInput): Promise<string> {
    const db = getDb();
    const feedbackId = uuidv4();

    await db.insert(creatorFeedback).values({
      id: feedbackId,
      assetId: input.assetId,
      assetType: input.assetType,
      feedbackType: input.feedbackType,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "medium",
      status: "new",
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      dataJson: input.data ?? null,
      resolvedAt: null,
      resolutionNote: null,
    });

    logger.info(
      `FEEDBACK: asset=${input.assetId} type=${input.feedbackType} title="${input.title}"`,
    );
    return feedbackId;
  }

  async getFeedbackForAsset(
    assetId: string,
    limit = 20,
  ): Promise<Array<typeof creatorFeedback.$inferSelect>> {
    const db = getDb();
    return db
      .select()
      .from(creatorFeedback)
      .where(eq(creatorFeedback.assetId, assetId))
      .orderBy(desc(creatorFeedback.createdAt))
      .limit(limit);
  }

  async resolveFeedback(feedbackId: string, note: string): Promise<void> {
    const db = getDb();
    await db
      .update(creatorFeedback)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolutionNote: note,
        updatedAt: new Date(),
      })
      .where(eq(creatorFeedback.id, feedbackId));
  }

  /**
   * Auto-generate feedback based on usage patterns and quality data.
   * Called periodically or after significant events.
   */
  async autoGenerateFeedback(assetId: string, assetType: AssetType): Promise<string[]> {
    const db = getDb();
    const feedbackIds: string[] = [];

    // Check usage volume
    const [usageCount] = await db
      .select({ count: count() })
      .from(usageEvents)
      .where(eq(usageEvents.assetId, assetId));

    if (usageCount && usageCount.count > 100) {
      const id = await this.generateFeedback({
        assetId,
        assetType,
        feedbackType: "usage_insight",
        title: `High demand: ${usageCount.count} total uses`,
        description: "This asset is popular. Consider creating derivatives or improved versions.",
        sourceType: "analytics",
        data: { usageCount: usageCount.count },
      });
      feedbackIds.push(id);
    }

    // Check verification failure rate
    const verifications = await db
      .select()
      .from(verificationRecords)
      .where(eq(verificationRecords.assetId, assetId));

    const failed = verifications.filter((v) => !v.passed);
    if (failed.length > 0 && failed.length / verifications.length > 0.2) {
      const id = await this.generateFeedback({
        assetId,
        assetType,
        feedbackType: "quality_suggestion",
        title: `${Math.round((failed.length / verifications.length) * 100)}% verification failure rate`,
        description: "Multiple verification checks have failed. Review quality and fix issues.",
        priority: "high",
        sourceType: "quality_engine",
        data: { totalChecks: verifications.length, failedChecks: failed.length },
      });
      feedbackIds.push(id);
    }

    // Check for low-quality average
    const passedWithScore = verifications.filter((v) => v.passed && v.score != null);
    if (passedWithScore.length >= 3) {
      const avgScore =
        passedWithScore.reduce((s, v) => s + (v.score ?? 0), 0) / passedWithScore.length;
      if (avgScore < 60) {
        const id = await this.generateFeedback({
          assetId,
          assetType,
          feedbackType: "quality_suggestion",
          title: `Average quality score: ${Math.round(avgScore)}/100`,
          description: "Quality is below threshold. Consider improving data, retraining, or revising.",
          priority: avgScore < 40 ? "critical" : "high",
          sourceType: "quality_engine",
          data: { averageScore: avgScore, sampleSize: passedWithScore.length },
        });
        feedbackIds.push(id);
      }
    }

    return feedbackIds;
  }

  // ---------------------------------------------------------------------------
  // LIFECYCLE QUERIES
  // ---------------------------------------------------------------------------

  async getAssetLifecycle(assetId: string): Promise<LifecycleSummary | null> {
    const db = getDb();

    const events = await db
      .select()
      .from(lifecycleEvents)
      .where(eq(lifecycleEvents.assetId, assetId))
      .orderBy(desc(lifecycleEvents.createdAt));

    if (events.length === 0) return null;

    const stagesHit = new Set(events.map((e) => e.stage));

    const [usageCountResult] = await db
      .select({ count: count() })
      .from(usageEvents)
      .where(eq(usageEvents.assetId, assetId));

    const [verifyCountResult] = await db
      .select({ count: count() })
      .from(verificationRecords)
      .where(eq(verificationRecords.assetId, assetId));

    const rewards = await db
      .select()
      .from(rewardsLedger)
      .where(eq(rewardsLedger.assetId, assetId));

    const rewardTotal = rewards.reduce((s, r) => s + parseFloat(r.amount), 0);

    const [feedbackCountResult] = await db
      .select({ count: count() })
      .from(creatorFeedback)
      .where(eq(creatorFeedback.assetId, assetId));

    const currentStage = events[0].stage as LifecycleStage;

    return {
      assetId,
      assetType: events[0].assetType,
      currentStage,
      stages: {
        created: stagesHit.has("created"),
        verified: stagesHit.has("verified"),
        published: stagesHit.has("published"),
        inUse: stagesHit.has("in_use"),
        receipted: stagesHit.has("receipted"),
        rewarded: stagesHit.has("rewarded"),
      },
      usageCount: usageCountResult?.count ?? 0,
      verificationCount: verifyCountResult?.count ?? 0,
      rewardTotal: String(rewardTotal),
      feedbackCount: feedbackCountResult?.count ?? 0,
      events: events.slice(0, 20).map((e) => ({
        id: e.id,
        stage: e.stage,
        createdAt: e.createdAt,
        metadata: e.metadataJson as Record<string, unknown> | null,
      })),
    };
  }

  async getLifecycleStats(): Promise<LifecycleStats> {
    const db = getDb();

    // Count unique assets in lifecycle
    const allEvents = await db.select().from(lifecycleEvents);
    const uniqueAssets = new Set(allEvents.map((e) => e.assetId));

    const [usageCount] = await db.select({ count: count() }).from(usageEvents);
    const [verifyCount] = await db.select({ count: count() }).from(verificationRecords);
    const [rewardCount] = await db.select({ count: count() }).from(rewardsLedger);
    const [feedbackCount] = await db.select({ count: count() }).from(creatorFeedback);

    // Stage distribution
    const stageDistribution: Record<string, number> = {};
    for (const e of allEvents) {
      stageDistribution[e.stage] = (stageDistribution[e.stage] ?? 0) + 1;
    }

    // Recent activity
    const recent = allEvents
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map((e) => ({
        id: e.id,
        stage: e.stage,
        assetId: e.assetId,
        assetType: e.assetType,
        createdAt: e.createdAt,
      }));

    return {
      totalAssets: uniqueAssets.size,
      totalUsageEvents: usageCount?.count ?? 0,
      totalVerifications: verifyCount?.count ?? 0,
      totalRewards: rewardCount?.count ?? 0,
      totalFeedback: feedbackCount?.count ?? 0,
      stageDistribution,
      recentActivity: recent,
    };
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private async incrementReputationStat(
    actorId: string,
    field:
      | "totalAssetsCreated"
      | "totalVerificationsPassed"
      | "totalVerificationsFailed"
      | "totalUsageEvents"
      | "totalReceiptsGenerated",
    increment: number,
  ): Promise<void> {
    const db = getDb();

    // Ensure record exists
    const [existing] = await db
      .select()
      .from(reputationScores)
      .where(eq(reputationScores.id, actorId))
      .limit(1);

    if (!existing) {
      await db.insert(reputationScores).values({
        id: actorId,
        overallScore: 0,
        creationScore: 0,
        verificationScore: 0,
        usageScore: 0,
        rewardScore: 0,
        consistencyScore: 0,
        tier: "newcomer",
        totalAssetsCreated: 0,
        totalVerificationsPassed: 0,
        totalVerificationsFailed: 0,
        totalUsageEvents: 0,
        totalRewardsEarned: "0",
        totalReceiptsGenerated: 0,
        currentStreak: 0,
        longestStreak: 0,
        averageQualityScore: null,
      });
    }

    // Map field to column
    const columnMap = {
      totalAssetsCreated: reputationScores.totalAssetsCreated,
      totalVerificationsPassed: reputationScores.totalVerificationsPassed,
      totalVerificationsFailed: reputationScores.totalVerificationsFailed,
      totalUsageEvents: reputationScores.totalUsageEvents,
      totalReceiptsGenerated: reputationScores.totalReceiptsGenerated,
    };

    const column = columnMap[field];
    await db
      .update(reputationScores)
      .set({
        [field]: sql`${column} + ${increment}`,
        updatedAt: new Date(),
      })
      .where(eq(reputationScores.id, actorId));
  }

  /**
   * Update streak tracking — call once per day when the actor is active.
   */
  async updateStreak(actorId: string): Promise<void> {
    const db = getDb();
    const [rep] = await db
      .select()
      .from(reputationScores)
      .where(eq(reputationScores.id, actorId))
      .limit(1);

    if (!rep) return;

    const now = new Date();
    const lastActive = rep.lastActiveAt ? new Date(rep.lastActiveAt) : null;
    const dayMs = 86_400_000;

    let newStreak = rep.currentStreak;
    if (!lastActive) {
      newStreak = 1;
    } else {
      const diffDays = Math.floor((now.getTime() - lastActive.getTime()) / dayMs);
      if (diffDays === 1) {
        newStreak = rep.currentStreak + 1;
      } else if (diffDays > 1) {
        newStreak = 1; // streak broken
      }
      // diffDays === 0 means same day, no change
    }

    const longestStreak = Math.max(rep.longestStreak, newStreak);

    // Check for streak rewards
    if (newStreak === 7 && rep.currentStreak < 7) {
      await this.issueReward({
        recipientId: actorId,
        recipientType: "creator",
        triggerType: "streak_bonus",
        amount: REWARD_RATES.streak_7.amount,
        currency: REWARD_RATES.streak_7.currency,
      });
    }
    if (newStreak === 30 && rep.currentStreak < 30) {
      await this.issueReward({
        recipientId: actorId,
        recipientType: "creator",
        triggerType: "streak_bonus",
        amount: REWARD_RATES.streak_30.amount,
        currency: REWARD_RATES.streak_30.currency,
      });
    }

    await db
      .update(reputationScores)
      .set({
        currentStreak: newStreak,
        longestStreak,
        lastActiveAt: now,
        updatedAt: now,
      })
      .where(eq(reputationScores.id, actorId));
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const lifecycleEngine = new LifecycleEngine();
export default LifecycleEngine;
