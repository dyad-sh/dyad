/**
 * Token Economics & Incentive Engine
 * 
 * The economic heartbeat of Sovereign AI. This service:
 * - Tracks all value flows (usage → fees → rewards → creators)
 * - Manages staking positions (compute, validator, creator, curator)
 * - Calculates and distributes rewards
 * - Enforces fee schedules
 * - Manages billing accounts and metering
 * - Handles token vesting for early contributors
 * 
 * "Data becomes owned by the users again. Their models will rot. Ours will prevail."
 */

import { v4 as uuidv4 } from "uuid";
import log from "electron-log";
import { db } from "@/db";
import { rewardsLedger, reputationScores, usageEvents, lifecycleEvents } from "@/db/schema";
import { eq, and, gte, lte, desc, sql, sum, count } from "drizzle-orm";
import * as fs from "fs-extra";
import * as path from "path";
import { getUserDataPath } from "@/paths/paths";

import type {
  TokenSymbol,
  TokenNetwork,
  TokenConfig,
  TokenBalance,
  StakeType,
  StakeStatus,
  StakePosition,
  SlashEvent,
  SlashReason,
  StakeConfig,
  RewardTrigger,
  RewardRule,
  RewardDistribution,
  RewardSplit,
  FeeSchedule,
  MeterReading,
  BillingAccount,
  VestingSchedule,
  TokenomicsServiceConfig,
  TokenomicsStats,
  EarningsSummary,
} from "@/types/tokenomics_types";

const logger = log.scope("tokenomics");

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  marketplaceListingFee: "0",           // Free to list (democratize access)
  marketplaceSaleFee: 250,              // 2.5% on sales
  inferenceBaseFee: "1000",             // 0.001 JOY base
  inferencePerTokenFee: "10",           // 0.00001 JOY per token
  apiCallFee: "5000",                   // 0.005 JOY per API call
  apiSubscriptionMonthly: "100000000",  // 100 JOY monthly
  
  // Revenue split (basis points, total = 10000)
  creatorShare: 7000,       // 70% to creator
  computeProviderShare: 1500, // 15% to compute
  validatorShare: 500,      // 5% to validators
  platformShare: 500,       // 5% to platform treasury
  burnShare: 500,           // 5% burned (deflationary)
};

const DEFAULT_STAKE_CONFIG: StakeConfig = {
  minimumStake: {
    compute_provider: "100000000000", // 100,000 JOY
    validator: "50000000000",          // 50,000 JOY
    creator: "1000000000",             // 1,000 JOY
    curator: "5000000000",             // 5,000 JOY
    governance: "10000000000",         // 10,000 JOY
  },
  unbondingPeriodMs: {
    compute_provider: 7 * 24 * 60 * 60 * 1000,  // 7 days
    validator: 14 * 24 * 60 * 60 * 1000,          // 14 days
    creator: 3 * 24 * 60 * 60 * 1000,             // 3 days
    curator: 3 * 24 * 60 * 60 * 1000,             // 3 days
    governance: 7 * 24 * 60 * 60 * 1000,           // 7 days
  },
  slashPercentage: {
    downtime: 5,
    invalid_inference: 25,
    data_theft: 100,
    sybil_attack: 50,
    censorship: 10,
    collusion: 50,
    spam: 15,
    governance_violation: 20,
  },
  rewardRates: {
    compute_provider: 1200, // 12% APY
    validator: 800,          // 8% APY
    creator: 500,            // 5% APY
    curator: 600,            // 6% APY
    governance: 400,         // 4% APY
  },
};

const DEFAULT_REWARD_RULES: RewardRule[] = [
  { id: "r1", trigger: "inference_served", amount: "100", currency: "JOY", multiplier: 1.0, maxPerDay: 10000, enabled: true, description: "Reward for serving inference" },
  { id: "r2", trigger: "model_used", amount: "50", currency: "JOY", multiplier: 1.0, maxPerDay: 50000, enabled: true, description: "Reward when your model is used" },
  { id: "r3", trigger: "dataset_used", amount: "30", currency: "JOY", multiplier: 1.0, maxPerDay: 50000, enabled: true, description: "Reward when your dataset is used" },
  { id: "r4", trigger: "agent_invoked", amount: "200", currency: "JOY", multiplier: 1.0, maxPerDay: 10000, enabled: true, description: "Reward when your agent is invoked" },
  { id: "r5", trigger: "workflow_executed", amount: "150", currency: "JOY", multiplier: 1.0, maxPerDay: 5000, enabled: true, description: "Reward when your workflow runs" },
  { id: "r6", trigger: "asset_verified", amount: "500", currency: "JOY", multiplier: 1.0, maxPerDay: 1000, enabled: true, description: "Reward for verifying an asset" },
  { id: "r7", trigger: "asset_curated", amount: "300", currency: "JOY", multiplier: 1.0, maxPerDay: 500, enabled: true, description: "Reward for curating quality content" },
  { id: "r8", trigger: "quality_bonus", amount: "1000", currency: "JOY", multiplier: 1.5, maxPerDay: 100, enabled: true, description: "Bonus for high-quality output" },
  { id: "r9", trigger: "streak_bonus", amount: "250", currency: "JOY", multiplier: 1.0, maxPerDay: 1, enabled: true, description: "Daily streak bonus" },
  { id: "r10", trigger: "referral", amount: "5000", currency: "JOY", multiplier: 1.0, maxPerDay: 10, enabled: true, description: "Referral bonus" },
  { id: "r11", trigger: "compute_uptime", amount: "50", currency: "JOY", multiplier: 1.0, maxPerDay: 24, enabled: true, description: "Hourly uptime reward" },
  { id: "r12", trigger: "governance_participation", amount: "1000", currency: "JOY", multiplier: 1.0, maxPerDay: 5, enabled: true, description: "Reward for voting" },
  { id: "r13", trigger: "bug_bounty", amount: "50000", currency: "JOY", multiplier: 1.0, maxPerDay: 3, enabled: true, description: "Bug bounty reward" },
  { id: "r14", trigger: "community_contribution", amount: "2000", currency: "JOY", multiplier: 1.0, maxPerDay: 10, enabled: true, description: "Open source contribution" },
];

// =============================================================================
// TOKENOMICS SERVICE
// =============================================================================

class TokenomicsService {
  private config: TokenomicsServiceConfig;
  private stakes: Map<string, StakePosition> = new Map();
  private billingAccounts: Map<string, BillingAccount> = new Map();
  private vestingSchedules: Map<string, VestingSchedule> = new Map();
  private dailyRewardCounts: Map<string, Map<RewardTrigger, number>> = new Map(); // userId -> trigger -> count
  private dataDir: string;
  private initialized = false;

  constructor(config?: Partial<TokenomicsServiceConfig>) {
    this.config = {
      defaultNetwork: "polygon-amoy",
      feeSchedule: DEFAULT_FEE_SCHEDULE,
      stakeConfig: DEFAULT_STAKE_CONFIG,
      rewardRules: DEFAULT_REWARD_RULES,
      vestingEnabled: true,
      burnEnabled: true,
      ...config,
    };
    this.dataDir = path.join(getUserDataPath(), "tokenomics");
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;
    logger.info("Initializing tokenomics engine...");

    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(path.join(this.dataDir, "stakes"));
    await fs.ensureDir(path.join(this.dataDir, "billing"));
    await fs.ensureDir(path.join(this.dataDir, "vesting"));
    await fs.ensureDir(path.join(this.dataDir, "meter-readings"));

    // Load persisted state
    await this.loadStakes();
    await this.loadBillingAccounts();
    await this.loadVestingSchedules();

    this.initialized = true;
    logger.info("Tokenomics engine initialized", {
      stakes: this.stakes.size,
      billingAccounts: this.billingAccounts.size,
      vestingSchedules: this.vestingSchedules.size,
    });
  }

  // ===========================================================================
  // STAKING
  // ===========================================================================

  async createStake(
    stakerId: string,
    stakeType: StakeType,
    amount: string,
    currency: TokenSymbol = "JOY",
  ): Promise<StakePosition> {
    await this.ensureInit();

    const minStake = this.config.stakeConfig.minimumStake[stakeType];
    if (BigInt(amount) < BigInt(minStake)) {
      throw new Error(
        `Minimum stake for ${stakeType} is ${minStake} ${currency}. Got ${amount}.`,
      );
    }

    const stake: StakePosition = {
      id: uuidv4(),
      stakerId,
      stakeType,
      amount,
      currency,
      status: "active",
      accumulatedRewards: "0",
      lastRewardClaimAt: null,
      rewardRate: this.config.stakeConfig.rewardRates[stakeType],
      unbondingPeriodMs: this.config.stakeConfig.unbondingPeriodMs[stakeType],
      unbondingStartedAt: null,
      unbondingEndsAt: null,
      slashEvents: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.stakes.set(stake.id, stake);
    await this.persistStake(stake);

    // Record lifecycle event
    await this.recordLifecycleEvent(stake.id, "staking", "created", stakerId, { stakeType, amount });

    logger.info("Stake created", { stakeId: stake.id, stakeType, amount });
    return stake;
  }

  async unstake(stakeId: string): Promise<StakePosition> {
    await this.ensureInit();

    const stake = this.stakes.get(stakeId);
    if (!stake) throw new Error(`Stake not found: ${stakeId}`);
    if (stake.status !== "active") throw new Error(`Stake is ${stake.status}, cannot unstake`);

    stake.status = "unbonding";
    stake.unbondingStartedAt = Date.now();
    stake.unbondingEndsAt = Date.now() + stake.unbondingPeriodMs;
    stake.updatedAt = Date.now();

    await this.persistStake(stake);
    logger.info("Unstake initiated", { stakeId, endsAt: new Date(stake.unbondingEndsAt).toISOString() });
    return stake;
  }

  async withdrawStake(stakeId: string): Promise<StakePosition> {
    await this.ensureInit();

    const stake = this.stakes.get(stakeId);
    if (!stake) throw new Error(`Stake not found: ${stakeId}`);
    if (stake.status !== "unbonding") throw new Error(`Stake must be unbonding to withdraw`);
    if (stake.unbondingEndsAt && Date.now() < stake.unbondingEndsAt) {
      throw new Error(`Unbonding period not complete. Ends at ${new Date(stake.unbondingEndsAt).toISOString()}`);
    }

    stake.status = "withdrawn";
    stake.updatedAt = Date.now();

    await this.persistStake(stake);
    logger.info("Stake withdrawn", { stakeId });
    return stake;
  }

  async slashStake(stakeId: string, reason: SlashReason, evidence: string): Promise<StakePosition> {
    await this.ensureInit();

    const stake = this.stakes.get(stakeId);
    if (!stake) throw new Error(`Stake not found: ${stakeId}`);

    const percentage = this.config.stakeConfig.slashPercentage[reason];
    const slashAmount = (BigInt(stake.amount) * BigInt(percentage)) / BigInt(100);

    const event: SlashEvent = {
      id: uuidv4(),
      reason,
      amount: slashAmount.toString(),
      percentage,
      evidence,
      timestamp: Date.now(),
    };

    stake.amount = (BigInt(stake.amount) - slashAmount).toString();
    stake.slashEvents.push(event);
    stake.status = stake.amount === "0" ? "slashed" : stake.status;
    stake.updatedAt = Date.now();

    await this.persistStake(stake);
    logger.warn("Stake slashed", { stakeId, reason, amount: slashAmount.toString(), percentage });
    return stake;
  }

  async getStakes(stakerId?: string): Promise<StakePosition[]> {
    await this.ensureInit();
    const all = Array.from(this.stakes.values());
    return stakerId ? all.filter((s) => s.stakerId === stakerId) : all;
  }

  async getStake(stakeId: string): Promise<StakePosition | null> {
    await this.ensureInit();
    return this.stakes.get(stakeId) ?? null;
  }

  // ===========================================================================
  // REWARDS
  // ===========================================================================

  async calculateReward(
    trigger: RewardTrigger,
    userId: string,
    eventId: string,
    metadata?: Record<string, unknown>,
  ): Promise<RewardDistribution | null> {
    await this.ensureInit();

    const rule = this.config.rewardRules.find((r) => r.trigger === trigger && r.enabled);
    if (!rule) {
      logger.debug(`No active reward rule for trigger: ${trigger}`);
      return null;
    }

    // Check daily rate limit
    const dailyKey = `${userId}-${new Date().toISOString().slice(0, 10)}`;
    if (!this.dailyRewardCounts.has(dailyKey)) {
      this.dailyRewardCounts.set(dailyKey, new Map());
    }
    const userDailyCounts = this.dailyRewardCounts.get(dailyKey)!;
    const currentCount = userDailyCounts.get(trigger) ?? 0;
    if (currentCount >= rule.maxPerDay) {
      logger.debug(`Daily reward limit reached for ${trigger} by ${userId}`);
      return null;
    }

    // Get reputation multiplier
    const repMultiplier = await this.getReputationMultiplier(userId);
    const finalAmount = BigInt(rule.amount) * BigInt(Math.floor(rule.multiplier * repMultiplier * 100)) / BigInt(100);

    // Calculate splits
    const fee = this.config.feeSchedule;
    const splits: RewardSplit[] = [
      {
        recipientId: userId,
        recipientRole: "creator",
        amount: (finalAmount * BigInt(fee.creatorShare) / BigInt(10000)).toString(),
        percentage: fee.creatorShare,
      },
    ];

    // Add compute provider split if applicable
    if (metadata?.computeProviderId) {
      splits.push({
        recipientId: metadata.computeProviderId as string,
        recipientRole: "compute_provider",
        amount: (finalAmount * BigInt(fee.computeProviderShare) / BigInt(10000)).toString(),
        percentage: fee.computeProviderShare,
      });
    }

    // Treasury/platform split
    splits.push({
      recipientId: "treasury",
      recipientRole: "platform",
      amount: (finalAmount * BigInt(fee.platformShare) / BigInt(10000)).toString(),
      percentage: fee.platformShare,
    });

    const distribution: RewardDistribution = {
      id: uuidv4(),
      trigger,
      triggerEventId: eventId,
      splits,
      totalAmount: finalAmount.toString(),
      currency: rule.currency,
      status: "calculated",
      timestamp: Date.now(),
    };

    // Write to rewards ledger in DB
    for (const split of splits) {
      try {
        await db.insert(rewardsLedger).values({
          id: uuidv4(),
          recipientId: split.recipientId,
          recipientType: split.recipientRole as "creator" | "validator" | "curator" | "compute_provider",
          triggerType: trigger as any,
          triggerEventId: eventId,
          amount: split.amount,
          currency: rule.currency as any,
          status: "pending",
          assetId: metadata?.assetId as string | undefined,
          assetType: metadata?.assetType as any,
          metadataJson: metadata ?? null,
          createdAt: new Date(),
        });
      } catch (err) {
        logger.error("Failed to write reward to ledger", { error: err });
      }
    }

    // Update daily count
    userDailyCounts.set(trigger, currentCount + 1);

    // Update reputation
    await this.updateReputation(userId, trigger);

    distribution.status = "pending";
    logger.info("Reward calculated", { trigger, userId, amount: finalAmount.toString() });
    return distribution;
  }

  async distributeReward(distributionId: string, txHash?: string): Promise<void> {
    // Mark all associated ledger entries as confirmed/paid
    // In production this would trigger actual on-chain transfers
    logger.info("Reward distributed", { distributionId, txHash });
  }

  async getEarningsSummary(userId: string, period: "daily" | "weekly" | "monthly" | "all_time" = "all_time"): Promise<EarningsSummary> {
    await this.ensureInit();

    const now = Date.now();
    const periodStart = period === "daily" ? now - 86400000
      : period === "weekly" ? now - 604800000
      : period === "monthly" ? now - 2592000000
      : 0;

    const startDate = new Date(periodStart);

    // Query rewards from DB
    const rewards = await db
      .select()
      .from(rewardsLedger)
      .where(
        and(
          eq(rewardsLedger.recipientId, userId),
          gte(rewardsLedger.createdAt, startDate),
        ),
      );

    const bySource: Record<string, string> = {};
    const byAsset: { assetId: string; assetType: string; earnings: string }[] = [];
    let totalEarnings = BigInt(0);
    let pendingRewards = BigInt(0);
    let claimableRewards = BigInt(0);

    for (const r of rewards) {
      const amt = BigInt(r.amount);
      totalEarnings += amt;

      if (r.status === "pending") pendingRewards += amt;
      if (r.status === "confirmed") claimableRewards += amt;

      const trigger = r.triggerType ?? "unknown";
      bySource[trigger] = (BigInt(bySource[trigger] ?? "0") + amt).toString();

      if (r.assetId) {
        const existing = byAsset.find((a) => a.assetId === r.assetId);
        if (existing) {
          existing.earnings = (BigInt(existing.earnings) + amt).toString();
        } else {
          byAsset.push({ assetId: r.assetId, assetType: r.assetType ?? "unknown", earnings: amt.toString() });
        }
      }
    }

    return {
      userId,
      period,
      totalEarnings: totalEarnings.toString(),
      currency: "JOY",
      bySource: bySource as Record<RewardTrigger, string>,
      byAsset,
      pendingRewards: pendingRewards.toString(),
      claimableRewards: claimableRewards.toString(),
      stakeIncome: "0",
      creatorIncome: bySource["model_used"] ?? bySource["dataset_used"] ?? bySource["agent_invoked"] ?? "0",
      computeIncome: bySource["inference_served"] ?? "0",
      validatorIncome: bySource["asset_verified"] ?? "0",
      curatorIncome: bySource["asset_curated"] ?? "0",
    };
  }

  // ===========================================================================
  // REPUTATION (activates existing DB schema)
  // ===========================================================================

  async updateReputation(userId: string, trigger: RewardTrigger): Promise<void> {
    try {
      const existing = await db.select().from(reputationScores).where(eq(reputationScores.id, userId)).limit(1);

      if (existing.length === 0) {
        // Create new reputation entry
        await db.insert(reputationScores).values({
          id: userId,
          overallScore: 10,
          creationScore: trigger.includes("model") || trigger.includes("dataset") || trigger.includes("agent") ? 10 : 0,
          verificationScore: trigger === "asset_verified" ? 10 : 0,
          usageScore: trigger.includes("used") || trigger.includes("invoked") ? 10 : 0,
          rewardScore: 10,
          consistencyScore: 10,
          tier: "newcomer",
          totalAssetsCreated: 0,
          totalVerificationsPassed: 0,
          totalVerificationsFailed: 0,
          totalUsageEvents: 1,
          totalRewardsEarned: "1",
          totalReceiptsGenerated: 0,
          currentStreak: 1,
          longestStreak: 1,
          lastActiveAt: new Date(),
          averageQualityScore: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        const rep = existing[0];
        const newOverall = Math.min(1000, rep.overallScore + 1);
        const newTier = this.calculateTier(newOverall);

        await db.update(reputationScores)
          .set({
            overallScore: newOverall,
            totalUsageEvents: rep.totalUsageEvents + 1,
            tier: newTier,
            lastActiveAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reputationScores.id, userId));
      }
    } catch (err) {
      logger.error("Failed to update reputation", { userId, error: err });
    }
  }

  async getReputation(userId: string): Promise<{
    overallScore: number;
    tier: string;
    scores: Record<string, number>;
  } | null> {
    const rows = await db.select().from(reputationScores).where(eq(reputationScores.id, userId)).limit(1);
    if (rows.length === 0) return null;

    const r = rows[0];
    return {
      overallScore: r.overallScore,
      tier: r.tier,
      scores: {
        creation: r.creationScore,
        verification: r.verificationScore,
        usage: r.usageScore,
        reward: r.rewardScore,
        consistency: r.consistencyScore,
      },
    };
  }

  private calculateTier(score: number): "newcomer" | "contributor" | "trusted" | "verified" | "elite" {
    if (score >= 800) return "elite";
    if (score >= 600) return "verified";
    if (score >= 400) return "trusted";
    if (score >= 200) return "contributor";
    return "newcomer";
  }

  private async getReputationMultiplier(userId: string): Promise<number> {
    const rep = await this.getReputation(userId);
    if (!rep) return 1.0;

    switch (rep.tier) {
      case "elite": return 2.0;
      case "verified": return 1.5;
      case "trusted": return 1.25;
      case "contributor": return 1.1;
      default: return 1.0;
    }
  }

  // ===========================================================================
  // METERING
  // ===========================================================================

  async recordMeter(
    consumerId: string,
    assetId: string,
    assetType: string,
    usage: {
      units?: number;
      inputTokens?: number;
      outputTokens?: number;
      computeMs?: number;
      dataBytesProcessed?: number;
    },
  ): Promise<MeterReading> {
    await this.ensureInit();

    const fee = this.config.feeSchedule;
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const totalTokens = inputTokens + outputTokens;

    const baseCost = BigInt(fee.inferenceBaseFee);
    const tokenCost = BigInt(fee.inferencePerTokenFee) * BigInt(totalTokens);
    const computeCost = BigInt(usage.computeMs ?? 0) * BigInt(1); // 1 unit per ms
    const totalCost = baseCost + tokenCost + computeCost;

    const reading: MeterReading = {
      id: uuidv4(),
      consumerId,
      assetId,
      assetType,
      units: usage.units ?? 1,
      inputTokens,
      outputTokens,
      computeMs: usage.computeMs ?? 0,
      dataBytesProcessed: usage.dataBytesProcessed ?? 0,
      baseCost: baseCost.toString(),
      tokenCost: tokenCost.toString(),
      computeCost: computeCost.toString(),
      totalCost: totalCost.toString(),
      currency: "JOY",
      periodStart: Date.now(),
      periodEnd: Date.now(),
      timestamp: Date.now(),
    };

    // Record usage event in DB
    try {
      await db.insert(usageEvents).values({
        id: reading.id,
        assetId,
        assetType: assetType as any,
        eventType: "inference",
        consumerId,
        consumerType: "local",
        units: reading.units,
        computeMs: reading.computeMs,
        inputTokens: reading.inputTokens,
        outputTokens: reading.outputTokens,
        dataBytesProcessed: reading.dataBytesProcessed,
        metadataJson: { totalCost: reading.totalCost, currency: reading.currency },
        createdAt: new Date(),
      });
    } catch (err) {
      logger.error("Failed to record usage event", { error: err });
    }

    // Persist reading
    const readingPath = path.join(this.dataDir, "meter-readings", `${reading.id}.json`);
    await fs.writeJson(readingPath, reading);

    return reading;
  }

  // ===========================================================================
  // BILLING ACCOUNTS
  // ===========================================================================

  async createBillingAccount(walletAddress: string, did?: string): Promise<BillingAccount> {
    await this.ensureInit();

    const account: BillingAccount = {
      id: uuidv4(),
      walletAddress,
      did,
      creditBalance: "0",
      currency: "JOY",
      dailyLimit: "1000000000", // 1B JOY
      monthlyLimit: "30000000000",
      currentDailyUsage: "0",
      currentMonthlyUsage: "0",
      autoReplenish: false,
      autoReplenishAmount: "0",
      autoReplenishThreshold: "0",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.billingAccounts.set(account.id, account);
    await this.persistBillingAccount(account);
    return account;
  }

  async addCredits(accountId: string, amount: string): Promise<BillingAccount> {
    const account = this.billingAccounts.get(accountId);
    if (!account) throw new Error(`Billing account not found: ${accountId}`);

    account.creditBalance = (BigInt(account.creditBalance) + BigInt(amount)).toString();
    account.updatedAt = Date.now();

    await this.persistBillingAccount(account);
    return account;
  }

  async deductCredits(accountId: string, amount: string): Promise<BillingAccount> {
    const account = this.billingAccounts.get(accountId);
    if (!account) throw new Error(`Billing account not found: ${accountId}`);

    const currentBalance = BigInt(account.creditBalance);
    const deduction = BigInt(amount);
    if (deduction > currentBalance) throw new Error("Insufficient credits");

    account.creditBalance = (currentBalance - deduction).toString();
    account.currentDailyUsage = (BigInt(account.currentDailyUsage) + deduction).toString();
    account.currentMonthlyUsage = (BigInt(account.currentMonthlyUsage) + deduction).toString();
    account.updatedAt = Date.now();

    await this.persistBillingAccount(account);
    return account;
  }

  async getBillingAccount(accountId: string): Promise<BillingAccount | null> {
    await this.ensureInit();
    return this.billingAccounts.get(accountId) ?? null;
  }

  async getBillingAccounts(walletAddress?: string): Promise<BillingAccount[]> {
    await this.ensureInit();
    const all = Array.from(this.billingAccounts.values());
    return walletAddress ? all.filter((a) => a.walletAddress === walletAddress) : all;
  }

  // ===========================================================================
  // VESTING
  // ===========================================================================

  async createVestingSchedule(
    recipientId: string,
    totalAmount: string,
    startAt: number,
    cliffAt: number,
    endAt: number,
    intervalMs: number = 30 * 24 * 60 * 60 * 1000, // Monthly
  ): Promise<VestingSchedule> {
    await this.ensureInit();

    const schedule: VestingSchedule = {
      id: uuidv4(),
      recipientId,
      totalAmount,
      vestedAmount: "0",
      claimedAmount: "0",
      currency: "JOY",
      startAt,
      cliffAt,
      endAt,
      vestingIntervalMs: intervalMs,
      status: "pending",
      createdAt: Date.now(),
    };

    this.vestingSchedules.set(schedule.id, schedule);
    await this.persistVestingSchedule(schedule);
    return schedule;
  }

  async claimVestedTokens(scheduleId: string): Promise<{ claimed: string; remaining: string }> {
    const schedule = this.vestingSchedules.get(scheduleId);
    if (!schedule) throw new Error(`Vesting schedule not found: ${scheduleId}`);

    const now = Date.now();
    if (now < schedule.cliffAt) throw new Error("Cliff period not reached");

    // Calculate vested amount
    const totalDuration = schedule.endAt - schedule.startAt;
    const elapsed = Math.min(now - schedule.startAt, totalDuration);
    const vestedRatio = elapsed / totalDuration;
    const totalVested = BigInt(Math.floor(Number(BigInt(schedule.totalAmount)) * vestedRatio));
    const claimable = totalVested - BigInt(schedule.claimedAmount);

    if (claimable <= 0) throw new Error("No tokens available to claim");

    schedule.vestedAmount = totalVested.toString();
    schedule.claimedAmount = (BigInt(schedule.claimedAmount) + claimable).toString();
    if (schedule.claimedAmount === schedule.totalAmount) schedule.status = "completed";
    else schedule.status = "active";

    await this.persistVestingSchedule(schedule);

    return {
      claimed: claimable.toString(),
      remaining: (BigInt(schedule.totalAmount) - BigInt(schedule.claimedAmount)).toString(),
    };
  }

  // ===========================================================================
  // STATS
  // ===========================================================================

  async getStats(): Promise<TokenomicsStats> {
    await this.ensureInit();

    let totalStaked = BigInt(0);
    let activeStakers = 0;
    const activeRewardRecipients = new Set<string>();

    for (const stake of this.stakes.values()) {
      if (stake.status === "active") {
        totalStaked += BigInt(stake.amount);
        activeStakers++;
      }
    }

    // Count distinct reward recipients
    const rewards = await db.select({ recipientId: rewardsLedger.recipientId }).from(rewardsLedger);
    for (const r of rewards) {
      activeRewardRecipients.add(r.recipientId);
    }

    return {
      totalStaked: totalStaked.toString(),
      totalRewardsDistributed: "0", // Would aggregate from DB
      totalBurned: "0",
      totalFeesCollected: "0",
      activeStakers,
      activeRewardRecipients: activeRewardRecipients.size,
      currentAPY: this.config.stakeConfig.rewardRates,
      dailyRewardsRate: "0",
    };
  }

  async getFeeSchedule(): Promise<FeeSchedule> {
    return this.config.feeSchedule;
  }

  async updateFeeSchedule(updates: Partial<FeeSchedule>): Promise<FeeSchedule> {
    Object.assign(this.config.feeSchedule, updates);
    await this.persistConfig();
    return this.config.feeSchedule;
  }

  async getRewardRules(): Promise<RewardRule[]> {
    return this.config.rewardRules;
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  private async persistStake(stake: StakePosition): Promise<void> {
    const p = path.join(this.dataDir, "stakes", `${stake.id}.json`);
    await fs.writeJson(p, stake, { spaces: 2 });
  }

  private async persistBillingAccount(account: BillingAccount): Promise<void> {
    const p = path.join(this.dataDir, "billing", `${account.id}.json`);
    await fs.writeJson(p, account, { spaces: 2 });
  }

  private async persistVestingSchedule(schedule: VestingSchedule): Promise<void> {
    const p = path.join(this.dataDir, "vesting", `${schedule.id}.json`);
    await fs.writeJson(p, schedule, { spaces: 2 });
  }

  private async persistConfig(): Promise<void> {
    const p = path.join(this.dataDir, "config.json");
    await fs.writeJson(p, this.config, { spaces: 2 });
  }

  private async loadStakes(): Promise<void> {
    const dir = path.join(this.dataDir, "stakes");
    if (!(await fs.pathExists(dir))) return;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const stake: StakePosition = await fs.readJson(path.join(dir, f));
        this.stakes.set(stake.id, stake);
      } catch { /* skip corrupt */ }
    }
  }

  private async loadBillingAccounts(): Promise<void> {
    const dir = path.join(this.dataDir, "billing");
    if (!(await fs.pathExists(dir))) return;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const acct: BillingAccount = await fs.readJson(path.join(dir, f));
        this.billingAccounts.set(acct.id, acct);
      } catch { /* skip corrupt */ }
    }
  }

  private async loadVestingSchedules(): Promise<void> {
    const dir = path.join(this.dataDir, "vesting");
    if (!(await fs.pathExists(dir))) return;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const sched: VestingSchedule = await fs.readJson(path.join(dir, f));
        this.vestingSchedules.set(sched.id, sched);
      } catch { /* skip corrupt */ }
    }
  }

  private async recordLifecycleEvent(
    assetId: string,
    assetType: string,
    stage: string,
    actorId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.insert(lifecycleEvents).values({
        id: uuidv4(),
        assetId,
        assetType: assetType as any,
        stage: stage as any,
        actorId,
        metadataJson: metadata ?? null,
        createdAt: new Date(),
      });
    } catch (err) {
      logger.error("Failed to record lifecycle event", { error: err });
    }
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }
}

// Singleton
export const tokenomicsService = new TokenomicsService();
export { TokenomicsService };
