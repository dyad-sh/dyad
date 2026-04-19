/**
 * Tokenomics IPC Handlers
 * 
 * Wires the token economics engine to the Electron renderer process.
 * Covers: staking, rewards, metering, billing, vesting, reputation, stats.
 */

import { ipcMain } from "electron";
import log from "electron-log";
import { tokenomicsService } from "@/lib/tokenomics_service";

const logger = log.scope("tokenomics-ipc");

export function registerTokenomicsHandlers(): void {
  logger.info("Registering tokenomics IPC handlers");

  // ==========================================================================
  // STAKING
  // ==========================================================================

  ipcMain.handle("tokenomics:create-stake", async (_e, stakerId: string, stakeType: string, amount: string, currency?: string) => {
    return tokenomicsService.createStake(stakerId, stakeType as any, amount, currency as any);
  });

  ipcMain.handle("tokenomics:unstake", async (_e, stakeId: string) => {
    return tokenomicsService.unstake(stakeId);
  });

  ipcMain.handle("tokenomics:withdraw-stake", async (_e, stakeId: string) => {
    return tokenomicsService.withdrawStake(stakeId);
  });

  ipcMain.handle("tokenomics:slash-stake", async (_e, stakeId: string, reason: string, evidence: string) => {
    return tokenomicsService.slashStake(stakeId, reason as any, evidence);
  });

  ipcMain.handle("tokenomics:get-stakes", async (_e, stakerId?: string) => {
    return tokenomicsService.getStakes(stakerId);
  });

  ipcMain.handle("tokenomics:get-stake", async (_e, stakeId: string) => {
    return tokenomicsService.getStake(stakeId);
  });

  // ==========================================================================
  // REWARDS
  // ==========================================================================

  ipcMain.handle("tokenomics:calculate-reward", async (_e, trigger: string, userId: string, eventId: string, metadata?: Record<string, unknown>) => {
    return tokenomicsService.calculateReward(trigger as any, userId, eventId, metadata);
  });

  ipcMain.handle("tokenomics:get-earnings", async (_e, userId: string, period?: string) => {
    return tokenomicsService.getEarningsSummary(userId, period as any);
  });

  // ==========================================================================
  // REPUTATION
  // ==========================================================================

  ipcMain.handle("tokenomics:get-reputation", async (_e, userId: string) => {
    return tokenomicsService.getReputation(userId);
  });

  ipcMain.handle("tokenomics:update-reputation", async (_e, userId: string, trigger: string) => {
    return tokenomicsService.updateReputation(userId, trigger as any);
  });

  // ==========================================================================
  // METERING
  // ==========================================================================

  ipcMain.handle("tokenomics:record-meter", async (_e, consumerId: string, assetId: string, assetType: string, usage: Record<string, unknown>) => {
    return tokenomicsService.recordMeter(consumerId, assetId, assetType, usage as any);
  });

  // ==========================================================================
  // BILLING
  // ==========================================================================

  ipcMain.handle("tokenomics:create-billing-account", async (_e, walletAddress: string, did?: string) => {
    return tokenomicsService.createBillingAccount(walletAddress, did);
  });

  ipcMain.handle("tokenomics:add-credits", async (_e, accountId: string, amount: string) => {
    return tokenomicsService.addCredits(accountId, amount);
  });

  ipcMain.handle("tokenomics:deduct-credits", async (_e, accountId: string, amount: string) => {
    return tokenomicsService.deductCredits(accountId, amount);
  });

  ipcMain.handle("tokenomics:get-billing-account", async (_e, accountId: string) => {
    return tokenomicsService.getBillingAccount(accountId);
  });

  ipcMain.handle("tokenomics:get-billing-accounts", async (_e, walletAddress?: string) => {
    return tokenomicsService.getBillingAccounts(walletAddress);
  });

  // ==========================================================================
  // VESTING
  // ==========================================================================

  ipcMain.handle("tokenomics:create-vesting", async (_e, recipientId: string, totalAmount: string, startAt: number, cliffAt: number, endAt: number, intervalMs?: number) => {
    return tokenomicsService.createVestingSchedule(recipientId, totalAmount, startAt, cliffAt, endAt, intervalMs);
  });

  ipcMain.handle("tokenomics:claim-vested", async (_e, scheduleId: string) => {
    return tokenomicsService.claimVestedTokens(scheduleId);
  });

  // ==========================================================================
  // STATS & CONFIG
  // ==========================================================================

  ipcMain.handle("tokenomics:get-stats", async () => {
    return tokenomicsService.getStats();
  });

  ipcMain.handle("tokenomics:get-fee-schedule", async () => {
    return tokenomicsService.getFeeSchedule();
  });

  ipcMain.handle("tokenomics:update-fee-schedule", async (_e, updates: Record<string, unknown>) => {
    return tokenomicsService.updateFeeSchedule(updates as any);
  });

  ipcMain.handle("tokenomics:get-reward-rules", async () => {
    return tokenomicsService.getRewardRules();
  });

  logger.info("Tokenomics IPC handlers registered (24 channels)");
}
