/**
 * Governance IPC Handlers
 * 
 * Wires the DAO governance service to the Electron renderer.
 * Covers: proposals, voting, delegation, treasury, config, stats.
 */

import { ipcMain } from "electron";
import log from "electron-log";
import { governanceService } from "@/lib/governance_service";

const logger = log.scope("governance-ipc");

export function registerGovernanceHandlers(): void {
  logger.info("Registering governance IPC handlers");

  // ==========================================================================
  // PROPOSALS
  // ==========================================================================

  ipcMain.handle("governance:create-proposal", async (_e, params: Record<string, unknown>) => {
    return governanceService.createProposal(params as any);
  });

  ipcMain.handle("governance:get-proposal", async (_e, proposalId: string) => {
    return governanceService.getProposal(proposalId);
  });

  ipcMain.handle("governance:list-proposals", async (_e, filters?: Record<string, unknown>) => {
    return governanceService.listProposals(filters as any);
  });

  ipcMain.handle("governance:cancel-proposal", async (_e, proposalId: string, cancelerId: string) => {
    return governanceService.cancelProposal(proposalId, cancelerId);
  });

  ipcMain.handle("governance:execute-proposal", async (_e, proposalId: string) => {
    return governanceService.executeProposal(proposalId);
  });

  ipcMain.handle("governance:veto-proposal", async (_e, proposalId: string, guardianId: string) => {
    return governanceService.vetoProposal(proposalId, guardianId);
  });

  // ==========================================================================
  // VOTING
  // ==========================================================================

  ipcMain.handle("governance:cast-vote", async (_e, params: Record<string, unknown>) => {
    return governanceService.castVote(params as any);
  });

  ipcMain.handle("governance:get-proposal-votes", async (_e, proposalId: string) => {
    return governanceService.getProposalVotes(proposalId);
  });

  ipcMain.handle("governance:get-voting-power", async (_e, userId: string) => {
    return governanceService.getVotingPower(userId);
  });

  // ==========================================================================
  // DELEGATION
  // ==========================================================================

  ipcMain.handle("governance:delegate", async (_e, params: Record<string, unknown>) => {
    return governanceService.delegate(params as any);
  });

  ipcMain.handle("governance:revoke-delegation", async (_e, delegationId: string, delegatorId: string) => {
    return governanceService.revokeDelegation(delegationId, delegatorId);
  });

  ipcMain.handle("governance:get-delegations", async (_e, userId: string) => {
    return governanceService.getDelegations(userId);
  });

  // ==========================================================================
  // TREASURY
  // ==========================================================================

  ipcMain.handle("governance:get-treasury-stats", async () => {
    return governanceService.getTreasuryStats();
  });

  ipcMain.handle("governance:deposit-to-treasury", async (_e, amount: string, currency: string, description: string, network?: string) => {
    return governanceService.depositToTreasury(amount, currency, description, network);
  });

  ipcMain.handle("governance:withdraw-from-treasury", async (_e, amount: string, currency: string, description: string, toAddress: string, proposalId?: string) => {
    return governanceService.withdrawFromTreasury(amount, currency, description, toAddress, proposalId);
  });

  // ==========================================================================
  // CONFIG & STATS
  // ==========================================================================

  ipcMain.handle("governance:get-stats", async () => {
    return governanceService.getStats();
  });

  ipcMain.handle("governance:get-config", async () => {
    return governanceService.getConfig();
  });

  ipcMain.handle("governance:update-config", async (_e, updates: Record<string, unknown>) => {
    return governanceService.updateConfig(updates as any);
  });

  logger.info("Governance IPC handlers registered (18 channels)");
}
