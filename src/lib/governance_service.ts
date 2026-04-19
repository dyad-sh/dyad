/**
 * DAO Governance Service
 * 
 * "By the people, for the people" — applied to AI infrastructure.
 * 
 * Enables community-driven decision making:
 * - Create and manage proposals
 * - Vote with token-weighted or quadratic voting
 * - Delegate voting power
 * - Manage treasury
 * - Execute passed proposals
 * - Guardian veto for emergency protection
 */

import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";
import { getUserDataPath } from "@/paths/paths";
import { EventEmitter } from "events";

import type {
  ProposalType,
  ProposalStatus,
  VoteChoice,
  Proposal,
  ProposalExecution,
  Vote,
  VotingPower,
  Delegation,
  TreasuryBalance,
  TreasuryTransaction,
  TreasuryStats,
  GovernanceConfig,
  GovernanceStats,
} from "@/types/governance_types";

const logger = log.scope("governance");

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  minProposalStake: "10000000000", // 10,000 JOY
  proposalDeposit: "5000000000",   // 5,000 JOY (returned if passed)
  
  votingPeriodMs: 7 * 24 * 60 * 60 * 1000,     // 7 days
  emergencyVotingPeriodMs: 24 * 60 * 60 * 1000,  // 24 hours
  reviewPeriodMs: 2 * 24 * 60 * 60 * 1000,       // 2 days before voting
  executionDelayMs: 2 * 24 * 60 * 60 * 1000,     // 2 day timelock
  
  defaultQuorum: 1000,              // 10% of total voting power
  defaultApprovalThreshold: 5000,   // 50%
  emergencyQuorum: 2000,            // 20%
  emergencyApprovalThreshold: 6700, // 67%
  
  maxDelegationDepth: 3,
  delegationEnabled: true,
  
  guardianAddress: undefined,
  guardianVetoEnabled: false,
  
  quadraticVotingEnabled: false,
};

// =============================================================================
// GOVERNANCE SERVICE
// =============================================================================

class GovernanceService extends EventEmitter {
  private config: GovernanceConfig;
  private dataDir: string;
  private proposals: Map<string, Proposal> = new Map();
  private votes: Map<string, Vote[]> = new Map(); // proposalId -> votes
  private delegations: Map<string, Delegation[]> = new Map(); // delegatorId -> delegations
  private treasury: TreasuryBalance[] = [];
  private treasuryTxns: TreasuryTransaction[] = [];
  private votingPower: Map<string, VotingPower> = new Map();
  private initialized = false;

  constructor(config?: Partial<GovernanceConfig>) {
    super();
    this.config = { ...DEFAULT_GOVERNANCE_CONFIG, ...config };
    this.dataDir = path.join(getUserDataPath(), "governance");
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;
    logger.info("Initializing governance service...");

    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(path.join(this.dataDir, "proposals"));
    await fs.ensureDir(path.join(this.dataDir, "votes"));
    await fs.ensureDir(path.join(this.dataDir, "delegations"));
    await fs.ensureDir(path.join(this.dataDir, "treasury"));

    await this.loadProposals();
    await this.loadTreasury();
    await this.loadDelegations();

    this.initialized = true;
    logger.info("Governance service initialized", {
      proposals: this.proposals.size,
      treasuryBalances: this.treasury.length,
    });
  }

  // ===========================================================================
  // PROPOSALS
  // ===========================================================================

  async createProposal(params: {
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
    await this.ensureInit();

    const now = Date.now();
    const isEmergency = params.proposalType === "emergency";
    const votingPeriod = isEmergency ? this.config.emergencyVotingPeriodMs : this.config.votingPeriodMs;
    const quorum = isEmergency ? this.config.emergencyQuorum : this.config.defaultQuorum;
    const threshold = isEmergency ? this.config.emergencyApprovalThreshold : this.config.defaultApprovalThreshold;

    const proposal: Proposal = {
      id: uuidv4(),
      title: params.title,
      summary: params.summary,
      description: params.description,
      proposalType: params.proposalType,
      proposerId: params.proposerId,
      proposerName: params.proposerName,
      votingStartsAt: now + this.config.reviewPeriodMs,
      votingEndsAt: now + this.config.reviewPeriodMs + votingPeriod,
      quorumRequired: quorum,
      approvalThreshold: threshold,
      votesFor: "0",
      votesAgainst: "0",
      votesAbstain: "0",
      totalVoters: 0,
      quorumReached: false,
      executionPayload: params.executionPayload,
      status: "pending_review",
      discussionUrl: params.discussionUrl,
      commentCount: 0,
      tags: params.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.proposals.set(proposal.id, proposal);
    await this.persistProposal(proposal);

    this.emit("proposal:created", proposal);
    logger.info("Proposal created", { id: proposal.id, title: proposal.title, type: proposal.proposalType });
    return proposal;
  }

  async getProposal(proposalId: string): Promise<Proposal | null> {
    await this.ensureInit();
    return this.proposals.get(proposalId) ?? null;
  }

  async listProposals(filters?: {
    status?: ProposalStatus;
    proposalType?: ProposalType;
    proposerId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ proposals: Proposal[]; total: number }> {
    await this.ensureInit();

    let results = Array.from(this.proposals.values());

    if (filters?.status) results = results.filter((p) => p.status === filters.status);
    if (filters?.proposalType) results = results.filter((p) => p.proposalType === filters.proposalType);
    if (filters?.proposerId) results = results.filter((p) => p.proposerId === filters.proposerId);

    // Auto-update statuses
    const now = Date.now();
    for (const p of results) {
      if (p.status === "pending_review" && now >= p.votingStartsAt) {
        p.status = "active";
        await this.persistProposal(p);
      }
      if (p.status === "active" && now >= p.votingEndsAt) {
        await this.finalizeProposal(p.id);
      }
    }

    results.sort((a, b) => b.createdAt - a.createdAt);
    const total = results.length;
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 20;

    return { proposals: results.slice(offset, offset + limit), total };
  }

  async cancelProposal(proposalId: string, cancelerId: string): Promise<Proposal> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.proposerId !== cancelerId) throw new Error("Only the proposer can cancel");
    if (!["draft", "pending_review"].includes(proposal.status)) {
      throw new Error(`Cannot cancel proposal in status: ${proposal.status}`);
    }

    proposal.status = "cancelled";
    proposal.updatedAt = Date.now();
    await this.persistProposal(proposal);

    this.emit("proposal:cancelled", proposal);
    return proposal;
  }

  // ===========================================================================
  // VOTING
  // ===========================================================================

  async castVote(params: {
    proposalId: string;
    voterId: string;
    voterName?: string;
    choice: VoteChoice;
    reason?: string;
  }): Promise<Vote> {
    await this.ensureInit();

    const proposal = this.proposals.get(params.proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${params.proposalId}`);

    // Check voting period
    const now = Date.now();
    if (now < proposal.votingStartsAt) throw new Error("Voting has not started yet");
    if (now > proposal.votingEndsAt) throw new Error("Voting period has ended");
    if (proposal.status !== "active") throw new Error(`Proposal is ${proposal.status}, not active`);

    // Check for duplicate vote
    const existingVotes = this.votes.get(params.proposalId) ?? [];
    const existing = existingVotes.find((v) => v.voterId === params.voterId);
    if (existing) throw new Error("You have already voted on this proposal");

    // Calculate voting power
    const power = await this.getVotingPower(params.voterId);
    const effectivePower = power.effectivePower;

    if (BigInt(effectivePower) <= 0) throw new Error("No voting power");

    // Apply quadratic voting if enabled
    let weight = effectivePower;
    if (this.config.quadraticVotingEnabled) {
      const sqrtPower = Math.floor(Math.sqrt(Number(BigInt(effectivePower))));
      weight = sqrtPower.toString();
    }

    const vote: Vote = {
      id: uuidv4(),
      proposalId: params.proposalId,
      voterId: params.voterId,
      voterName: params.voterName,
      choice: params.choice,
      weight,
      reason: params.reason,
      delegatedFrom: power.delegatedToMe !== "0" ? [] : undefined, // Simplified
      signature: crypto.createHash("sha256").update(`${params.voterId}:${params.proposalId}:${params.choice}`).digest("hex"),
      timestamp: now,
    };

    // Update vote tallies
    existingVotes.push(vote);
    this.votes.set(params.proposalId, existingVotes);

    switch (params.choice) {
      case "for":
        proposal.votesFor = (BigInt(proposal.votesFor) + BigInt(weight)).toString();
        break;
      case "against":
        proposal.votesAgainst = (BigInt(proposal.votesAgainst) + BigInt(weight)).toString();
        break;
      case "abstain":
        proposal.votesAbstain = (BigInt(proposal.votesAbstain) + BigInt(weight)).toString();
        break;
    }
    proposal.totalVoters++;
    proposal.updatedAt = now;

    await this.persistProposal(proposal);
    await this.persistVote(vote);

    // Update voter's power record
    power.votesParticipated++;
    power.lastVotedAt = now;
    this.votingPower.set(params.voterId, power);

    this.emit("vote:cast", vote);
    logger.info("Vote cast", { proposalId: params.proposalId, voterId: params.voterId, choice: params.choice, weight });
    return vote;
  }

  async getProposalVotes(proposalId: string): Promise<Vote[]> {
    return this.votes.get(proposalId) ?? [];
  }

  async getVotingPower(userId: string): Promise<VotingPower> {
    await this.ensureInit();

    const existing = this.votingPower.get(userId);
    if (existing) return existing;

    // Default voting power = staked tokens (would integrate with tokenomics)
    const power: VotingPower = {
      userId,
      ownStake: "1000000", // Default base power (would query tokenomics)
      delegatedToMe: "0",
      totalPower: "1000000",
      delegatedToOthers: "0",
      effectivePower: "1000000",
      votesParticipated: 0,
      proposalsCreated: 0,
    };

    // Add delegated power
    for (const [, delegations] of this.delegations.entries()) {
      for (const d of delegations) {
        if (d.delegateId === userId && d.active) {
          power.delegatedToMe = (BigInt(power.delegatedToMe) + BigInt(d.amount)).toString();
        }
      }
    }

    power.totalPower = (BigInt(power.ownStake) + BigInt(power.delegatedToMe)).toString();
    power.effectivePower = (BigInt(power.totalPower) - BigInt(power.delegatedToOthers)).toString();

    this.votingPower.set(userId, power);
    return power;
  }

  // ===========================================================================
  // DELEGATION
  // ===========================================================================

  async delegate(params: {
    delegatorId: string;
    delegateId: string;
    amount: string;
    scope?: "all" | "category";
    categories?: ProposalType[];
  }): Promise<Delegation> {
    await this.ensureInit();

    if (params.delegatorId === params.delegateId) throw new Error("Cannot delegate to yourself");

    // Check delegation depth
    const depth = await this.getDelegationDepth(params.delegateId);
    if (depth >= this.config.maxDelegationDepth) {
      throw new Error(`Max delegation depth (${this.config.maxDelegationDepth}) reached`);
    }

    const delegation: Delegation = {
      id: uuidv4(),
      delegatorId: params.delegatorId,
      delegateId: params.delegateId,
      scope: params.scope ?? "all",
      categories: params.categories,
      amount: params.amount,
      percentage: 100, // Full delegation by default
      active: true,
      createdAt: Date.now(),
    };

    const userDelegations = this.delegations.get(params.delegatorId) ?? [];
    userDelegations.push(delegation);
    this.delegations.set(params.delegatorId, userDelegations);

    await this.persistDelegation(delegation);

    // Invalidate cached voting power
    this.votingPower.delete(params.delegatorId);
    this.votingPower.delete(params.delegateId);

    this.emit("delegation:created", delegation);
    logger.info("Delegation created", { from: params.delegatorId, to: params.delegateId, amount: params.amount });
    return delegation;
  }

  async revokeDelegation(delegationId: string, delegatorId: string): Promise<void> {
    for (const [userId, delegations] of this.delegations.entries()) {
      const d = delegations.find((d) => d.id === delegationId);
      if (d) {
        if (d.delegatorId !== delegatorId) throw new Error("Only delegator can revoke");
        d.active = false;
        d.revokedAt = Date.now();
        await this.persistDelegation(d);

        // Invalidate cached voting power
        this.votingPower.delete(d.delegatorId);
        this.votingPower.delete(d.delegateId);

        this.emit("delegation:revoked", d);
        return;
      }
    }
    throw new Error(`Delegation not found: ${delegationId}`);
  }

  async getDelegations(userId: string): Promise<{ delegated: Delegation[]; received: Delegation[] }> {
    await this.ensureInit();

    const delegated = this.delegations.get(userId)?.filter((d) => d.active) ?? [];
    const received: Delegation[] = [];

    for (const [, delegations] of this.delegations.entries()) {
      received.push(...delegations.filter((d) => d.delegateId === userId && d.active));
    }

    return { delegated, received };
  }

  private async getDelegationDepth(userId: string, visited = new Set<string>()): Promise<number> {
    if (visited.has(userId)) return visited.size;
    visited.add(userId);

    const received: Delegation[] = [];
    for (const [, delegations] of this.delegations.entries()) {
      received.push(...delegations.filter((d) => d.delegateId === userId && d.active));
    }

    let maxDepth = 0;
    for (const d of received) {
      const depth = await this.getDelegationDepth(d.delegatorId, new Set(visited));
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth;
  }

  // ===========================================================================
  // TREASURY
  // ===========================================================================

  async getTreasuryStats(): Promise<TreasuryStats> {
    await this.ensureInit();

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const recentTxns = this.treasuryTxns.filter((t) => t.timestamp >= thirtyDaysAgo);

    let totalInflow = BigInt(0);
    let totalOutflow = BigInt(0);

    for (const txn of recentTxns) {
      if (txn.type === "deposit" || txn.type === "fee_collection") {
        totalInflow += BigInt(txn.amount);
      } else {
        totalOutflow += BigInt(txn.amount);
      }
    }

    return {
      totalValue: this.treasury.reduce((sum, b) => (BigInt(sum) + BigInt(b.balance)).toString(), "0"),
      balances: this.treasury,
      totalInflow30d: totalInflow.toString(),
      totalOutflow30d: totalOutflow.toString(),
      netFlow30d: (totalInflow - totalOutflow).toString(),
      allocations: [],
      recentTransactions: this.treasuryTxns.slice(-20),
    };
  }

  async depositToTreasury(amount: string, currency: string, description: string, network?: string): Promise<TreasuryTransaction> {
    await this.ensureInit();

    const txn: TreasuryTransaction = {
      id: uuidv4(),
      type: "deposit",
      amount,
      currency,
      description,
      network,
      timestamp: Date.now(),
    };

    this.treasuryTxns.push(txn);

    // Update balance
    const existing = this.treasury.find((b) => b.currency === currency);
    if (existing) {
      existing.balance = (BigInt(existing.balance) + BigInt(amount)).toString();
      existing.lastUpdated = Date.now();
    } else {
      this.treasury.push({
        currency,
        balance: amount,
        network: network ?? "polygon-amoy",
        lastUpdated: Date.now(),
      });
    }

    await this.persistTreasury();
    this.emit("treasury:deposit", txn);
    return txn;
  }

  async withdrawFromTreasury(
    amount: string,
    currency: string,
    description: string,
    toAddress: string,
    proposalId?: string,
  ): Promise<TreasuryTransaction> {
    await this.ensureInit();

    const balance = this.treasury.find((b) => b.currency === currency);
    if (!balance || BigInt(balance.balance) < BigInt(amount)) {
      throw new Error("Insufficient treasury balance");
    }

    const txn: TreasuryTransaction = {
      id: uuidv4(),
      type: "withdrawal",
      amount,
      currency,
      description,
      proposalId,
      toAddress,
      timestamp: Date.now(),
    };

    balance.balance = (BigInt(balance.balance) - BigInt(amount)).toString();
    balance.lastUpdated = Date.now();
    this.treasuryTxns.push(txn);

    await this.persistTreasury();
    this.emit("treasury:withdrawal", txn);
    return txn;
  }

  // ===========================================================================
  // PROPOSAL FINALIZATION
  // ===========================================================================

  async finalizeProposal(proposalId: string): Promise<Proposal> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.status !== "active") return proposal;

    const totalVotes = BigInt(proposal.votesFor) + BigInt(proposal.votesAgainst) + BigInt(proposal.votesAbstain);
    
    // Check quorum (simplified — in production would check against total supply)
    const quorumMet = totalVotes > BigInt(0); // Simplified for now
    proposal.quorumReached = quorumMet;

    if (!quorumMet) {
      proposal.status = "expired";
    } else {
      const forVotes = BigInt(proposal.votesFor);
      const totalDecisive = forVotes + BigInt(proposal.votesAgainst);
      const approvalBps = totalDecisive > 0
        ? Number((forVotes * BigInt(10000)) / totalDecisive)
        : 0;

      if (approvalBps >= proposal.approvalThreshold) {
        proposal.status = "passed";
      } else {
        proposal.status = "rejected";
      }
    }

    proposal.updatedAt = Date.now();
    await this.persistProposal(proposal);

    this.emit(`proposal:${proposal.status}`, proposal);
    logger.info("Proposal finalized", { id: proposalId, status: proposal.status });
    return proposal;
  }

  async executeProposal(proposalId: string): Promise<Proposal> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.status !== "passed") throw new Error(`Proposal must be passed to execute. Current: ${proposal.status}`);

    // Check timelock
    const timeSincePassed = Date.now() - proposal.updatedAt;
    if (timeSincePassed < this.config.executionDelayMs) {
      throw new Error(`Timelock not expired. ${Math.ceil((this.config.executionDelayMs - timeSincePassed) / 3600000)}h remaining`);
    }

    // Execute based on payload type
    if (proposal.executionPayload) {
      await this.executePayload(proposal.executionPayload);
    }

    proposal.status = "executed";
    proposal.executedAt = Date.now();
    proposal.updatedAt = Date.now();
    await this.persistProposal(proposal);

    this.emit("proposal:executed", proposal);
    logger.info("Proposal executed", { id: proposalId });
    return proposal;
  }

  async vetoProposal(proposalId: string, guardianId: string): Promise<Proposal> {
    if (!this.config.guardianVetoEnabled) throw new Error("Guardian veto is disabled");
    if (this.config.guardianAddress && guardianId !== this.config.guardianAddress) {
      throw new Error("Only the guardian can veto");
    }

    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);

    proposal.status = "vetoed";
    proposal.updatedAt = Date.now();
    await this.persistProposal(proposal);

    this.emit("proposal:vetoed", proposal);
    logger.warn("Proposal vetoed by guardian", { id: proposalId, guardian: guardianId });
    return proposal;
  }

  private async executePayload(payload: ProposalExecution): Promise<void> {
    switch (payload.type) {
      case "parameter_change":
        for (const change of payload.parameterChanges ?? []) {
          logger.info("Executing parameter change", { key: change.key, from: change.currentValue, to: change.proposedValue });
          // Would apply to governance/tokenomics config
        }
        break;

      case "treasury_transfer":
        if (payload.treasuryTransfer) {
          const t = payload.treasuryTransfer;
          await this.withdrawFromTreasury(t.amount, t.currency, t.reason, t.recipientId);
        }
        break;

      case "text_record":
        if (payload.textRecord) {
          logger.info("Executing text record", { key: payload.textRecord.key });
          // Would store policy/text on-chain or IPFS
        }
        break;

      default:
        logger.warn("Unknown execution payload type", { type: payload.type });
    }
  }

  // ===========================================================================
  // STATS
  // ===========================================================================

  async getStats(): Promise<GovernanceStats> {
    await this.ensureInit();

    const allProposals = Array.from(this.proposals.values());
    const totalVotesCast = Array.from(this.votes.values()).reduce((sum, v) => sum + v.length, 0);
    const uniqueVoters = new Set(
      Array.from(this.votes.values()).flatMap((v) => v.map((vote) => vote.voterId)),
    ).size;

    const treasuryValue = this.treasury.reduce((sum, b) => (BigInt(sum) + BigInt(b.balance)).toString(), "0");

    return {
      totalProposals: allProposals.length,
      activeProposals: allProposals.filter((p) => p.status === "active").length,
      passedProposals: allProposals.filter((p) => p.status === "passed" || p.status === "executed").length,
      rejectedProposals: allProposals.filter((p) => p.status === "rejected").length,
      executedProposals: allProposals.filter((p) => p.status === "executed").length,
      totalVotesCast,
      uniqueVoters,
      avgTurnoutPercent: 0, // Would calculate from total supply
      totalDelegations: Array.from(this.delegations.values()).reduce((sum, d) => sum + d.filter((x) => x.active).length, 0),
      treasuryValue,
      recentProposals: allProposals.slice(0, 5),
    };
  }

  async getConfig(): Promise<GovernanceConfig> {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<GovernanceConfig>): Promise<GovernanceConfig> {
    Object.assign(this.config, updates);
    await fs.writeJson(path.join(this.dataDir, "config.json"), this.config, { spaces: 2 });
    return this.config;
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  private async persistProposal(proposal: Proposal): Promise<void> {
    await fs.writeJson(path.join(this.dataDir, "proposals", `${proposal.id}.json`), proposal, { spaces: 2 });
  }

  private async persistVote(vote: Vote): Promise<void> {
    const dir = path.join(this.dataDir, "votes", vote.proposalId);
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, `${vote.id}.json`), vote, { spaces: 2 });
  }

  private async persistDelegation(delegation: Delegation): Promise<void> {
    await fs.writeJson(path.join(this.dataDir, "delegations", `${delegation.id}.json`), delegation, { spaces: 2 });
  }

  private async persistTreasury(): Promise<void> {
    await fs.writeJson(path.join(this.dataDir, "treasury", "balances.json"), this.treasury, { spaces: 2 });
    await fs.writeJson(path.join(this.dataDir, "treasury", "transactions.json"), this.treasuryTxns, { spaces: 2 });
  }

  private async loadProposals(): Promise<void> {
    const dir = path.join(this.dataDir, "proposals");
    if (!(await fs.pathExists(dir))) return;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const proposal: Proposal = await fs.readJson(path.join(dir, f));
        this.proposals.set(proposal.id, proposal);

        // Load votes
        const voteDir = path.join(this.dataDir, "votes", proposal.id);
        if (await fs.pathExists(voteDir)) {
          const voteFiles = await fs.readdir(voteDir);
          const votes: Vote[] = [];
          for (const vf of voteFiles) {
            if (!vf.endsWith(".json")) continue;
            try { votes.push(await fs.readJson(path.join(voteDir, vf))); } catch { }
          }
          this.votes.set(proposal.id, votes);
        }
      } catch { }
    }
  }

  private async loadTreasury(): Promise<void> {
    const balancesPath = path.join(this.dataDir, "treasury", "balances.json");
    const txnsPath = path.join(this.dataDir, "treasury", "transactions.json");
    if (await fs.pathExists(balancesPath)) {
      try { this.treasury = await fs.readJson(balancesPath); } catch { }
    }
    if (await fs.pathExists(txnsPath)) {
      try { this.treasuryTxns = await fs.readJson(txnsPath); } catch { }
    }
  }

  private async loadDelegations(): Promise<void> {
    const dir = path.join(this.dataDir, "delegations");
    if (!(await fs.pathExists(dir))) return;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const d: Delegation = await fs.readJson(path.join(dir, f));
        const existing = this.delegations.get(d.delegatorId) ?? [];
        existing.push(d);
        this.delegations.set(d.delegatorId, existing);
      } catch { }
    }
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }
}

// Singleton
export const governanceService = new GovernanceService();
export { GovernanceService };
