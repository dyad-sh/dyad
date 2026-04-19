/**
 * Governance IPC Client
 * Typed client for renderer → main process communication.
 */

import type {
  ProposalType,
  ProposalStatus,
  VoteChoice,
  Proposal,
  ProposalExecution,
  Vote,
  VotingPower,
  Delegation,
  TreasuryStats,
  TreasuryTransaction,
  GovernanceConfig,
  GovernanceStats,
} from "@/types/governance_types";

const invoke = window.electron.ipcRenderer.invoke;

// ── Proposals ────────────────────────────────────────────────────────────────

export function createProposal(params: {
  title: string;
  summary: string;
  description: string;
  proposalType: ProposalType;
  proposerId: string;
  proposerName?: string;
  executionPayload?: ProposalExecution;
  tags?: string[];
  discussionUrl?: string;
}): Promise<Proposal> {
  return invoke("governance:create-proposal", params);
}

export function getProposal(proposalId: string): Promise<Proposal | null> {
  return invoke("governance:get-proposal", proposalId);
}

export function listProposals(filters?: {
  status?: ProposalStatus;
  proposalType?: ProposalType;
  proposerId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ proposals: Proposal[]; total: number }> {
  return invoke("governance:list-proposals", filters);
}

export function cancelProposal(proposalId: string, cancelerId: string): Promise<Proposal> {
  return invoke("governance:cancel-proposal", proposalId, cancelerId);
}

export function executeProposal(proposalId: string): Promise<Proposal> {
  return invoke("governance:execute-proposal", proposalId);
}

export function vetoProposal(proposalId: string, guardianId: string): Promise<Proposal> {
  return invoke("governance:veto-proposal", proposalId, guardianId);
}

// ── Voting ───────────────────────────────────────────────────────────────────

export function castVote(params: {
  proposalId: string;
  voterId: string;
  voterName?: string;
  choice: VoteChoice;
  reason?: string;
}): Promise<Vote> {
  return invoke("governance:cast-vote", params);
}

export function getProposalVotes(proposalId: string): Promise<Vote[]> {
  return invoke("governance:get-proposal-votes", proposalId);
}

export function getVotingPower(userId: string): Promise<VotingPower> {
  return invoke("governance:get-voting-power", userId);
}

// ── Delegation ───────────────────────────────────────────────────────────────

export function delegate(params: {
  delegatorId: string;
  delegateId: string;
  amount: string;
  scope?: "all" | "category";
  categories?: ProposalType[];
}): Promise<Delegation> {
  return invoke("governance:delegate", params);
}

export function revokeDelegation(delegationId: string, delegatorId: string): Promise<void> {
  return invoke("governance:revoke-delegation", delegationId, delegatorId);
}

export function getDelegations(userId: string): Promise<{ delegated: Delegation[]; received: Delegation[] }> {
  return invoke("governance:get-delegations", userId);
}

// ── Treasury ─────────────────────────────────────────────────────────────────

export function getTreasuryStats(): Promise<TreasuryStats> {
  return invoke("governance:get-treasury-stats");
}

export function depositToTreasury(amount: string, currency: string, description: string, network?: string): Promise<TreasuryTransaction> {
  return invoke("governance:deposit-to-treasury", amount, currency, description, network);
}

export function withdrawFromTreasury(amount: string, currency: string, description: string, toAddress: string, proposalId?: string): Promise<TreasuryTransaction> {
  return invoke("governance:withdraw-from-treasury", amount, currency, description, toAddress, proposalId);
}

// ── Config & Stats ───────────────────────────────────────────────────────────

export function getGovernanceStats(): Promise<GovernanceStats> {
  return invoke("governance:get-stats");
}

export function getGovernanceConfig(): Promise<GovernanceConfig> {
  return invoke("governance:get-config");
}

export function updateGovernanceConfig(updates: Partial<GovernanceConfig>): Promise<GovernanceConfig> {
  return invoke("governance:update-config", updates);
}
