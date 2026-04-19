/**
 * DAO Governance Types
 * 
 * Community-driven decision making for the Sovereign AI platform.
 * Proposals, voting, treasury management, delegation.
 * 
 * "By the people, for the people" — applied to AI infrastructure.
 */

// =============================================================================
// PROPOSALS
// =============================================================================

export type ProposalType =
  | "parameter_change"    // Change platform parameters (fees, rates, thresholds)
  | "treasury_spend"      // Spend from treasury
  | "grant"               // Fund a project/contributor
  | "upgrade"             // Platform upgrade
  | "policy"              // Content/safety policy change
  | "model_approval"      // Approve a new model for the network
  | "slash_appeal"        // Appeal a slashing decision
  | "agent_certification" // Certify an agent for elevated trust
  | "feature_request"     // Request a new feature
  | "emergency"           // Emergency action (shorter voting period)
  | "general";            // General governance proposal

export type ProposalStatus =
  | "draft"
  | "pending_review"
  | "active"        // Voting is open
  | "passed"        // Passed but not yet executed
  | "rejected"
  | "executed"      // Successfully executed
  | "expired"       // Voting period ended without quorum
  | "cancelled"     // Cancelled by proposer
  | "vetoed";       // Vetoed by guardians

export type VoteChoice = "for" | "against" | "abstain";

export interface Proposal {
  id: string;
  
  // Content
  title: string;
  summary: string;
  description: string; // Markdown
  proposalType: ProposalType;
  
  // Author
  proposerId: string; // DID or wallet
  proposerName?: string;
  
  // Voting
  votingStartsAt: number;
  votingEndsAt: number;
  quorumRequired: number; // Basis points (e.g., 1000 = 10% of total supply)
  approvalThreshold: number; // Basis points needed to pass (e.g., 5000 = 50%)
  
  // Votes
  votesFor: string; // Weighted vote count
  votesAgainst: string;
  votesAbstain: string;
  totalVoters: number;
  quorumReached: boolean;
  
  // Execution
  executionPayload?: ProposalExecution;
  executedAt?: number;
  executionTxHash?: string;
  
  // Status
  status: ProposalStatus;
  
  // Discussion
  discussionUrl?: string;
  commentCount: number;
  
  // Metadata
  tags: string[];
  createdAt: number;
  updatedAt: number;
  
  // On-chain reference
  onChainId?: string;
  snapshotId?: string;
}

export interface ProposalExecution {
  type: "parameter_change" | "treasury_transfer" | "contract_call" | "text_record" | "custom";
  
  // For parameter changes
  parameterChanges?: {
    key: string;
    currentValue: string;
    proposedValue: string;
  }[];
  
  // For treasury transfers
  treasuryTransfer?: {
    recipientId: string;
    amount: string;
    currency: string;
    reason: string;
  };
  
  // For contract calls
  contractCall?: {
    contractAddress: string;
    functionName: string;
    args: unknown[];
    network: string;
  };
  
  // For text records (policies, etc.)
  textRecord?: {
    key: string;
    content: string;
    contentCid?: string; // IPFS CID
  };
}

// =============================================================================
// VOTING
// =============================================================================

export interface Vote {
  id: string;
  proposalId: string;
  voterId: string;
  voterName?: string;
  choice: VoteChoice;
  weight: string; // Voting power (based on staked tokens + delegation)
  reason?: string; // Optional reasoning
  
  // Delegation chain
  delegatedFrom?: string[];
  
  // On-chain
  txHash?: string;
  signature: string;
  
  timestamp: number;
}

export interface VotingPower {
  userId: string;
  
  // Sources of voting power
  ownStake: string;
  delegatedToMe: string;
  totalPower: string;
  
  // Delegation
  delegatedToOthers: string;
  effectivePower: string; // totalPower - delegatedToOthers
  
  // History
  votesParticipated: number;
  proposalsCreated: number;
  lastVotedAt?: number;
}

// =============================================================================
// DELEGATION
// =============================================================================

export interface Delegation {
  id: string;
  delegatorId: string;
  delegateId: string;
  
  // Scope
  scope: "all" | "category";
  categories?: ProposalType[]; // If scope is "category"
  
  // Amount
  amount: string; // Amount of voting power delegated
  percentage: number; // Or percentage of total power
  
  // Status
  active: boolean;
  revokedAt?: number;
  
  createdAt: number;
}

// =============================================================================
// TREASURY
// =============================================================================

export interface TreasuryBalance {
  currency: string;
  balance: string;
  network: string;
  lastUpdated: number;
}

export interface TreasuryTransaction {
  id: string;
  type: "deposit" | "withdrawal" | "fee_collection" | "grant" | "burn";
  amount: string;
  currency: string;
  
  // Context
  proposalId?: string; // If triggered by governance
  description: string;
  
  // On-chain
  txHash?: string;
  network?: string;
  
  // Parties
  fromAddress?: string;
  toAddress?: string;
  
  timestamp: number;
}

export interface TreasuryStats {
  totalValue: string; // Estimated total value in USD
  balances: TreasuryBalance[];
  
  // Flow stats
  totalInflow30d: string;
  totalOutflow30d: string;
  netFlow30d: string;
  
  // Allocation
  allocations: {
    category: string;
    amount: string;
    percentage: number;
  }[];
  
  // History
  recentTransactions: TreasuryTransaction[];
}

// =============================================================================
// GOVERNANCE CONFIG
// =============================================================================

export interface GovernanceConfig {
  // Proposal thresholds
  minProposalStake: string; // Minimum stake to create proposal
  proposalDeposit: string;  // Deposit returned if proposal passes
  
  // Voting periods (ms)
  votingPeriodMs: number;
  emergencyVotingPeriodMs: number;
  reviewPeriodMs: number; // Time before voting starts
  executionDelayMs: number; // Timelock after passing
  
  // Quorum & approval
  defaultQuorum: number; // Basis points
  defaultApprovalThreshold: number;
  emergencyQuorum: number;
  emergencyApprovalThreshold: number;
  
  // Delegation
  maxDelegationDepth: number; // Prevent infinite delegation chains
  delegationEnabled: boolean;
  
  // Guardian
  guardianAddress?: string; // Can veto malicious proposals
  guardianVetoEnabled: boolean;
  
  // Quadratic voting
  quadraticVotingEnabled: boolean;
}

// =============================================================================
// GOVERNANCE STATS
// =============================================================================

export interface GovernanceStats {
  totalProposals: number;
  activeProposals: number;
  passedProposals: number;
  rejectedProposals: number;
  executedProposals: number;
  
  totalVotesCast: number;
  uniqueVoters: number;
  avgTurnoutPercent: number;
  
  totalDelegations: number;
  treasuryValue: string;
  
  recentProposals: Proposal[];
}

// =============================================================================
// API GATEWAY TYPES (for API Marketplace)
// =============================================================================

export interface APIKey {
  id: string;
  ownerId: string; // DID or wallet
  name: string;
  keyHash: string; // SHA-256 hash (never store plaintext)
  keyPrefix: string; // First 8 chars for identification
  
  // Permissions
  permissions: APIPermission[];
  allowedAgents: string[]; // Agent IDs this key can access (empty = all)
  allowedCapabilities: string[]; // Capability IDs (empty = all)
  
  // Rate limits
  rateLimit: {
    requestsPerMinute: number;
    requestsPerDay: number;
    tokensPerMinute: number;
    tokensPerDay: number;
  };
  
  // Billing
  billingAccountId: string;
  
  // Status
  active: boolean;
  expiresAt?: number;
  lastUsedAt?: number;
  totalRequests: number;
  
  createdAt: number;
}

export type APIPermission =
  | "inference"
  | "agent-invoke"
  | "dataset-read"
  | "dataset-write"
  | "model-download"
  | "workflow-execute"
  | "marketplace-read"
  | "marketplace-write";

export interface APIUsageRecord {
  id: string;
  apiKeyId: string;
  agentId?: string;
  capabilityId?: string;
  
  // Request details
  method: string;
  path: string;
  statusCode: number;
  
  // Metering
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  
  // Cost
  cost: string;
  currency: string;
  
  timestamp: number;
}

export interface APIEndpointConfig {
  agentId: string;
  path: string;
  methods: string[];
  rateLimit: number;
  pricing: {
    model: PricingModel;
    amount: string;
    currency: string;
  };
  authentication: AuthMethod[];
  openApiSpec?: Record<string, unknown>;
  active: boolean;
}

type PricingModel = "free" | "per-call" | "per-token" | "subscription";
type AuthMethod = "api-key" | "did-auth" | "jwt" | "wallet-sig" | "none";
