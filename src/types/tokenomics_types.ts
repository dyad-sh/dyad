/**
 * Token Economics & Incentive System Types
 * 
 * The economic foundation of the Sovereign AI platform.
 * JOY token utility: staking, fees, governance, access, rewards.
 * 
 * Design principles:
 * - Creators earn from every use of their assets
 * - Compute providers earn from inference jobs
 * - Validators earn from quality assurance
 * - Curators earn from discovering good content
 * - Users benefit from lower costs through decentralization
 */

// =============================================================================
// TOKEN FUNDAMENTALS
// =============================================================================

export type TokenSymbol = "JOY" | "TIA" | "USDC" | "MATIC" | "points";
export type TokenNetwork = "polygon" | "polygon-amoy" | "ethereum" | "base" | "arbitrum" | "celestia";

export interface TokenConfig {
  symbol: TokenSymbol;
  name: string;
  decimals: number;
  contractAddress?: string;
  network: TokenNetwork;
  totalSupply?: string; // Wei-format string for precision
}

export interface TokenBalance {
  symbol: TokenSymbol;
  balance: string; // Wei-format
  balanceFormatted: string; // Human-readable
  network: TokenNetwork;
  lastUpdated: number; // Unix timestamp
}

// =============================================================================
// STAKING
// =============================================================================

export type StakeType =
  | "compute_provider"  // Stake to offer compute
  | "validator"         // Stake to validate inference/assets
  | "creator"           // Stake to boost visibility of assets
  | "curator"           // Stake to curate marketplace content
  | "governance";       // Stake for voting power

export type StakeStatus = "active" | "unbonding" | "withdrawn" | "slashed";

export interface StakePosition {
  id: string;
  stakerId: string; // Wallet address or DID
  stakeType: StakeType;
  amount: string; // Wei
  currency: TokenSymbol;
  status: StakeStatus;
  
  // Rewards
  accumulatedRewards: string;
  lastRewardClaimAt: number | null;
  rewardRate: number; // APY basis points (e.g., 500 = 5%)
  
  // Unbonding
  unbondingPeriodMs: number;
  unbondingStartedAt: number | null;
  unbondingEndsAt: number | null;
  
  // Slashing
  slashEvents: SlashEvent[];
  
  // Metadata
  createdAt: number;
  updatedAt: number;
}

export interface SlashEvent {
  id: string;
  reason: SlashReason;
  amount: string; // Amount slashed
  percentage: number; // Slash percentage (e.g., 10 = 10%)
  evidence: string;
  timestamp: number;
}

export type SlashReason =
  | "downtime"               // Compute provider offline too long
  | "invalid_inference"      // Served incorrect/malicious output
  | "data_theft"             // Attempted to exfiltrate user data
  | "sybil_attack"           // Created fake identities
  | "censorship"             // Refused valid requests based on content
  | "collusion"              // Coordinated with others to game system
  | "spam"                   // Flooded network with junk
  | "governance_violation";  // Violated DAO rules

export interface StakeConfig {
  minimumStake: Record<StakeType, string>; // Minimum stake per type
  unbondingPeriodMs: Record<StakeType, number>;
  slashPercentage: Record<SlashReason, number>;
  rewardRates: Record<StakeType, number>; // APY in basis points
}

// =============================================================================
// REWARDS & INCENTIVES
// =============================================================================

export type RewardTrigger =
  | "inference_served"       // Compute provider served an inference
  | "model_used"             // Creator's model was used
  | "dataset_used"           // Creator's dataset was used
  | "agent_invoked"          // Creator's agent was called
  | "workflow_executed"      // Creator's workflow ran
  | "asset_verified"         // Validator verified an asset
  | "asset_curated"          // Curator recommended an asset
  | "quality_bonus"          // Extra reward for high-quality output
  | "streak_bonus"           // Consecutive days active
  | "referral"               // Brought a new user
  | "compute_uptime"         // Maintained compute availability
  | "governance_participation" // Voted on proposals
  | "bug_bounty"             // Found and reported a bug
  | "community_contribution"; // Open source contribution

export interface RewardRule {
  id: string;
  trigger: RewardTrigger;
  amount: string; // Base reward amount
  currency: TokenSymbol;
  multiplier: number; // Applied based on reputation tier
  maxPerDay: number; // Rate limit
  enabled: boolean;
  description: string;
}

export interface RewardDistribution {
  id: string;
  trigger: RewardTrigger;
  triggerEventId: string;
  
  // Distribution splits
  splits: RewardSplit[];
  totalAmount: string;
  currency: TokenSymbol;
  
  // Status
  status: "calculated" | "pending" | "distributed" | "failed";
  txHash?: string;
  
  timestamp: number;
}

export interface RewardSplit {
  recipientId: string;
  recipientRole: "creator" | "compute_provider" | "validator" | "curator" | "platform" | "treasury";
  amount: string;
  percentage: number; // Basis points (e.g., 7000 = 70%)
}

// =============================================================================
// FEE STRUCTURE
// =============================================================================

export interface FeeSchedule {
  // Marketplace fees
  marketplaceListingFee: string;       // One-time fee to list
  marketplaceSaleFee: number;          // Basis points on sale (e.g., 250 = 2.5%)
  
  // Inference fees
  inferenceBaseFee: string;            // Base fee per inference
  inferencePerTokenFee: string;        // Per-token fee (input + output)
  
  // API fees
  apiCallFee: string;                  // Per API call
  apiSubscriptionMonthly: string;      // Monthly subscription
  
  // Split ratios (basis points, must total 10000)
  creatorShare: number;                // To asset creator
  computeProviderShare: number;        // To compute provider
  validatorShare: number;              // To validators
  platformShare: number;               // To platform treasury
  burnShare: number;                   // Burned (deflationary)
}

// =============================================================================
// METERING & BILLING
// =============================================================================

export interface MeterReading {
  id: string;
  consumerId: string;
  assetId: string;
  assetType: string;
  
  // Usage metrics
  units: number;
  inputTokens: number;
  outputTokens: number;
  computeMs: number;
  dataBytesProcessed: number;
  
  // Cost calculation
  baseCost: string;
  tokenCost: string;
  computeCost: string;
  totalCost: string;
  currency: TokenSymbol;
  
  // Billing period
  periodStart: number;
  periodEnd: number;
  
  timestamp: number;
}

export interface BillingAccount {
  id: string;
  walletAddress: string;
  did?: string;
  
  // Balances
  creditBalance: string; // Pre-paid credits
  currency: TokenSymbol;
  
  // Usage limits
  dailyLimit: string;
  monthlyLimit: string;
  currentDailyUsage: string;
  currentMonthlyUsage: string;
  
  // Auto-replenish
  autoReplenish: boolean;
  autoReplenishAmount: string;
  autoReplenishThreshold: string;
  
  // Status
  status: "active" | "suspended" | "closed";
  suspendedReason?: string;
  
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// TOKEN VESTING
// =============================================================================

export interface VestingSchedule {
  id: string;
  recipientId: string;
  
  totalAmount: string;
  vestedAmount: string;
  claimedAmount: string;
  currency: TokenSymbol;
  
  // Schedule
  startAt: number;
  cliffAt: number;      // No tokens until cliff
  endAt: number;         // Fully vested
  vestingIntervalMs: number; // How often tokens vest (e.g., monthly)
  
  // Status
  status: "pending" | "active" | "completed" | "revoked";
  
  createdAt: number;
}

// =============================================================================
// SERVICE INTERFACE
// =============================================================================

export interface TokenomicsServiceConfig {
  defaultNetwork: TokenNetwork;
  feeSchedule: FeeSchedule;
  stakeConfig: StakeConfig;
  rewardRules: RewardRule[];
  vestingEnabled: boolean;
  burnEnabled: boolean;
}

export interface TokenomicsStats {
  totalStaked: string;
  totalRewardsDistributed: string;
  totalBurned: string;
  totalFeesCollected: string;
  activeStakers: number;
  activeRewardRecipients: number;
  currentAPY: Record<StakeType, number>;
  dailyRewardsRate: string;
}

export interface EarningsSummary {
  userId: string;
  period: "daily" | "weekly" | "monthly" | "all_time";
  
  totalEarnings: string;
  currency: TokenSymbol;
  
  bySource: Record<RewardTrigger, string>;
  byAsset: { assetId: string; assetType: string; earnings: string }[];
  
  pendingRewards: string;
  claimableRewards: string;
  
  stakeIncome: string;
  creatorIncome: string;
  computeIncome: string;
  validatorIncome: string;
  curatorIncome: string;
}
