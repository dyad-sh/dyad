/**
 * Tokenomics IPC Client
 * Typed client for renderer → main process communication.
 */

import type {
  StakeType,
  StakePosition,
  SlashReason,
  RewardTrigger,
  RewardDistribution,
  MeterReading,
  BillingAccount,
  VestingSchedule,
  FeeSchedule,
  RewardRule,
  TokenomicsStats,
  EarningsSummary,
  TokenSymbol,
} from "@/types/tokenomics_types";

const invoke = window.electron.ipcRenderer.invoke;

// ── Staking ──────────────────────────────────────────────────────────────────

export function createStake(stakerId: string, stakeType: StakeType, amount: string, currency?: TokenSymbol): Promise<StakePosition> {
  return invoke("tokenomics:create-stake", stakerId, stakeType, amount, currency);
}

export function unstake(stakeId: string): Promise<StakePosition> {
  return invoke("tokenomics:unstake", stakeId);
}

export function withdrawStake(stakeId: string): Promise<StakePosition> {
  return invoke("tokenomics:withdraw-stake", stakeId);
}

export function slashStake(stakeId: string, reason: SlashReason, evidence: string): Promise<StakePosition> {
  return invoke("tokenomics:slash-stake", stakeId, reason, evidence);
}

export function getStakes(stakerId?: string): Promise<StakePosition[]> {
  return invoke("tokenomics:get-stakes", stakerId);
}

export function getStake(stakeId: string): Promise<StakePosition | null> {
  return invoke("tokenomics:get-stake", stakeId);
}

// ── Rewards ──────────────────────────────────────────────────────────────────

export function calculateReward(trigger: RewardTrigger, userId: string, eventId: string, metadata?: Record<string, unknown>): Promise<RewardDistribution | null> {
  return invoke("tokenomics:calculate-reward", trigger, userId, eventId, metadata);
}

export function getEarnings(userId: string, period?: "daily" | "weekly" | "monthly" | "all_time"): Promise<EarningsSummary> {
  return invoke("tokenomics:get-earnings", userId, period);
}

// ── Reputation ───────────────────────────────────────────────────────────────

export function getReputation(userId: string): Promise<{ overallScore: number; tier: string; scores: Record<string, number> } | null> {
  return invoke("tokenomics:get-reputation", userId);
}

export function updateReputation(userId: string, trigger: RewardTrigger): Promise<void> {
  return invoke("tokenomics:update-reputation", userId, trigger);
}

// ── Metering ─────────────────────────────────────────────────────────────────

export function recordMeter(consumerId: string, assetId: string, assetType: string, usage: { units?: number; inputTokens?: number; outputTokens?: number; computeMs?: number; dataBytesProcessed?: number }): Promise<MeterReading> {
  return invoke("tokenomics:record-meter", consumerId, assetId, assetType, usage);
}

// ── Billing ──────────────────────────────────────────────────────────────────

export function createBillingAccount(walletAddress: string, did?: string): Promise<BillingAccount> {
  return invoke("tokenomics:create-billing-account", walletAddress, did);
}

export function addCredits(accountId: string, amount: string): Promise<BillingAccount> {
  return invoke("tokenomics:add-credits", accountId, amount);
}

export function deductCredits(accountId: string, amount: string): Promise<BillingAccount> {
  return invoke("tokenomics:deduct-credits", accountId, amount);
}

export function getBillingAccount(accountId: string): Promise<BillingAccount | null> {
  return invoke("tokenomics:get-billing-account", accountId);
}

export function getBillingAccounts(walletAddress?: string): Promise<BillingAccount[]> {
  return invoke("tokenomics:get-billing-accounts", walletAddress);
}

// ── Vesting ──────────────────────────────────────────────────────────────────

export function createVesting(recipientId: string, totalAmount: string, startAt: number, cliffAt: number, endAt: number, intervalMs?: number): Promise<VestingSchedule> {
  return invoke("tokenomics:create-vesting", recipientId, totalAmount, startAt, cliffAt, endAt, intervalMs);
}

export function claimVested(scheduleId: string): Promise<{ claimed: string; remaining: string }> {
  return invoke("tokenomics:claim-vested", scheduleId);
}

// ── Stats & Config ───────────────────────────────────────────────────────────

export function getTokenomicsStats(): Promise<TokenomicsStats> {
  return invoke("tokenomics:get-stats");
}

export function getFeeSchedule(): Promise<FeeSchedule> {
  return invoke("tokenomics:get-fee-schedule");
}

export function updateFeeSchedule(updates: Partial<FeeSchedule>): Promise<FeeSchedule> {
  return invoke("tokenomics:update-fee-schedule", updates);
}

export function getRewardRules(): Promise<RewardRule[]> {
  return invoke("tokenomics:get-reward-rules");
}
