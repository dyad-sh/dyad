/**
 * Deployed Contract Types
 * Types for managing deployed marketplace contracts and NFT-gated inference access.
 * 
 * The contract system provides:
 * - NFT-based access control for inference
 * - Data protection through hashing and encryption
 * - License management stored on-chain
 * - Agent access to protected data with owner consent
 */

import type { WalletAddress, Cid, LicenseId, StoreId } from "./jcn_types";
import type { BlockchainNetwork, NFTLicenseType } from "./nft_types";

// =============================================================================
// CONTRACT IDENTIFIERS
// =============================================================================

/** Contract address on-chain */
export type ContractAddress = WalletAddress;

/** Token ID (NFT identifier) */
export type TokenId = string;

/** Contract deployment transaction hash */
export type DeploymentTxHash = string;

// =============================================================================
// CONTRACT TYPES
// =============================================================================

/** Types of contracts deployed on the marketplace */
export type ContractType =
  | "inference_access"       // NFT-gated inference access
  | "data_license"           // Data licensing contract
  | "model_registry"         // Model registration & tracking
  | "agent_permissions"      // Agent permission management
  | "revenue_split"          // Revenue distribution
  | "usage_tracking"         // Usage metering on-chain
  | "encryption_keys"        // Key escrow for encrypted data
  | "governance";            // DAO governance contract

/** Contract deployment status */
export type ContractStatus =
  | "deploying"
  | "deployed"
  | "verified"
  | "paused"
  | "deprecated"
  | "failed";

// =============================================================================
// DEPLOYED CONTRACT
// =============================================================================

export interface DeployedContract {
  /** Unique contract identifier */
  id: string;
  
  /** Contract address on-chain */
  address: ContractAddress;
  
  /** Contract type */
  type: ContractType;
  
  /** Human-readable name */
  name: string;
  
  /** Description of contract purpose */
  description?: string;
  
  /** Blockchain network */
  network: BlockchainNetwork;
  
  /** Chain ID */
  chainId: number;
  
  /** Contract version */
  version: string;
  
  /** Deployment transaction hash */
  deploymentTxHash: DeploymentTxHash;
  
  /** Block number of deployment */
  deploymentBlock: number;
  
  /** Contract status */
  status: ContractStatus;
  
  /** Owner/deployer wallet */
  owner: WalletAddress;
  
  /** Store ID if associated with a store */
  storeId?: StoreId;
  
  /** ABI (Application Binary Interface) */
  abi: string[];
  
  /** Contract bytecode hash */
  bytecodeHash: string;
  
  /** Source code verification status */
  verified: boolean;
  
  /** Verified source code URL (e.g., Polygonscan) */
  verifiedSourceUrl?: string;
  
  /** Associated asset/model CID */
  assetCid?: Cid;
  
  /** Metadata URI (IPFS) */
  metadataUri?: string;
  
  /** Creation timestamp */
  createdAt: string;
  
  /** Last updated timestamp */
  updatedAt: string;
}

// =============================================================================
// INFERENCE ACCESS NFT
// =============================================================================

/**
 * NFT that grants access to inference on a model/agent.
 * The NFT acts as the access control layer - only holders can run inference.
 */
export interface InferenceAccessNFT {
  /** Token ID */
  tokenId: TokenId;
  
  /** Contract address */
  contractAddress: ContractAddress;
  
  /** Network */
  network: BlockchainNetwork;
  
  /** Current owner */
  owner: WalletAddress;
  
  /** Original minter/creator */
  creator: WalletAddress;
  
  /** Model/Agent CID this NFT grants access to */
  assetCid: Cid;
  
  /** Asset name */
  assetName: string;
  
  /** Asset type */
  assetType: "model" | "agent" | "dataset" | "workflow";
  
  /** License type */
  licenseType: NFTLicenseType;
  
  /** License details */
  license: InferenceLicense;
  
  /** Data protection settings */
  dataProtection: DataProtectionSettings;
  
  /** Usage limits */
  usageLimits: InferenceUsageLimits;
  
  /** Current usage stats */
  currentUsage: InferenceUsageStats;
  
  /** Metadata URI */
  metadataUri: string;
  
  /** Token URI */
  tokenUri: string;
  
  /** Is active (not revoked/expired) */
  isActive: boolean;
  
  /** Expiration timestamp (null = never expires) */
  expiresAt?: string;
  
  /** Minted at timestamp */
  mintedAt: string;
  
  /** Last transfer timestamp */
  lastTransferAt?: string;
}

// =============================================================================
// INFERENCE LICENSE (ON-CHAIN)
// =============================================================================

export interface InferenceLicense {
  /** License ID (hash of license terms) */
  licenseId: LicenseId;
  
  /** License type */
  type: NFTLicenseType;
  
  /** License scope */
  scope: LicenseScope;
  
  /** Permitted uses */
  permittedUses: PermittedUse[];
  
  /** Restrictions */
  restrictions: LicenseRestriction[];
  
  /** Revenue sharing terms */
  revenueShare?: RevenueShareTerms;
  
  /** Attribution requirements */
  attribution?: AttributionRequirements;
  
  /** Transferable */
  transferable: boolean;
  
  /** Sublicensable */
  sublicensable: boolean;
  
  /** Exclusive license */
  exclusive: boolean;
  
  /** Territory (null = worldwide) */
  territory?: string[];
  
  /** License hash stored on-chain */
  onChainHash: string;
  
  /** Full license terms CID (IPFS) */
  termsCid: Cid;
}

export type LicenseScope =
  | "inference_only"       // Can only run inference
  | "fine_tuning"          // Can fine-tune model
  | "commercial"           // Commercial usage allowed
  | "research"             // Research use only
  | "personal"             // Personal use only
  | "derivative"           // Can create derivatives
  | "redistribution"       // Can redistribute
  | "full_rights";         // All rights granted

export type PermittedUse =
  | "api_inference"        // API-based inference
  | "batch_processing"     // Batch inference jobs
  | "streaming"            // Streaming responses
  | "embedding"            // Generate embeddings
  | "training"             // Use for training
  | "fine_tuning"          // Fine-tune the model
  | "evaluation"           // Model evaluation
  | "integration"          // Integrate in products
  | "resale";              // Resell access

export interface LicenseRestriction {
  type: "max_requests" | "max_tokens" | "time_limit" | "geo_restriction" | "use_case" | "custom";
  value: string | number;
  description: string;
}

export interface RevenueShareTerms {
  /** Creator percentage (basis points, e.g., 1000 = 10%) */
  creatorBps: number;
  /** Platform percentage */
  platformBps: number;
  /** Minimum payout threshold (in USDC) */
  minPayoutThreshold: number;
  /** Payment frequency */
  paymentFrequency: "per_use" | "daily" | "weekly" | "monthly";
}

export interface AttributionRequirements {
  required: boolean;
  text?: string;
  url?: string;
  logo?: string;
}

// =============================================================================
// DATA PROTECTION
// =============================================================================

/**
 * Data protection settings for encrypted/protected data.
 * All data is hashed and optionally encrypted.
 */
export interface DataProtectionSettings {
  /** Data is encrypted */
  encrypted: boolean;
  
  /** Encryption algorithm */
  encryptionAlgorithm?: "aes-256-gcm" | "chacha20-poly1305" | "xchacha20-poly1305";
  
  /** Key derivation function */
  kdf?: "argon2id" | "scrypt" | "pbkdf2";
  
  /** Encrypted key escrow contract */
  keyEscrowContract?: ContractAddress;
  
  /** Data hash (SHA-256) */
  dataHash: string;
  
  /** Merkle root for chunked data */
  merkleRoot?: string;
  
  /** Access requires NFT ownership verification */
  requiresNftOwnership: boolean;
  
  /** Access requires signature */
  requiresSignature: boolean;
  
  /** Permitted agents (wallet addresses) */
  permittedAgents: WalletAddress[];
  
  /** Agent access policy */
  agentAccessPolicy: AgentAccessPolicy;
  
  /** Audit logging enabled */
  auditLogging: boolean;
  
  /** Watermarking enabled for outputs */
  watermarking: boolean;
}

export interface AgentAccessPolicy {
  /** Allow autonomous agent access */
  allowAutonomousAgents: boolean;
  
  /** Require human approval for agent access */
  requireHumanApproval: boolean;
  
  /** Allowed agent types */
  allowedAgentTypes: ("ai_agent" | "workflow" | "automation" | "custom")[];
  
  /** Maximum concurrent agent sessions */
  maxConcurrentSessions: number;
  
  /** Agent must be verified */
  requireVerifiedAgent: boolean;
  
  /** Minimum agent reputation score */
  minReputationScore?: number;
  
  /** Blocked agents */
  blockedAgents: WalletAddress[];
}

// =============================================================================
// USAGE TRACKING
// =============================================================================

export interface InferenceUsageLimits {
  /** Max inferences (null = unlimited) */
  maxInferences?: number;
  
  /** Max tokens (null = unlimited) */
  maxTokens?: number;
  
  /** Max requests per day */
  maxRequestsPerDay?: number;
  
  /** Max requests per hour */
  maxRequestsPerHour?: number;
  
  /** Max concurrent requests */
  maxConcurrentRequests?: number;
  
  /** Time limit (null = never expires) */
  timeLimitMs?: number;
  
  /** Cooldown between requests (ms) */
  cooldownMs?: number;
}

export interface InferenceUsageStats {
  /** Total inferences used */
  totalInferences: number;
  
  /** Total tokens used */
  totalTokens: number;
  
  /** Total input tokens */
  inputTokens: number;
  
  /** Total output tokens */
  outputTokens: number;
  
  /** Requests today */
  requestsToday: number;
  
  /** Requests this hour */
  requestsThisHour: number;
  
  /** Last request timestamp */
  lastRequestAt?: string;
  
  /** Total compute time (ms) */
  totalComputeMs: number;
  
  /** Revenue generated (USDC) */
  revenueGenerated: number;
}

// =============================================================================
// INFERENCE ACCESS VERIFICATION
// =============================================================================

export interface InferenceAccessRequest {
  /** Requester wallet */
  requesterWallet: WalletAddress;
  
  /** Asset CID to access */
  assetCid: Cid;
  
  /** Token ID (if known) */
  tokenId?: TokenId;
  
  /** Contract address */
  contractAddress: ContractAddress;
  
  /** Signature proving ownership */
  signature: string;
  
  /** Message that was signed */
  signedMessage: string;
  
  /** Request type */
  requestType: "inference" | "batch" | "stream" | "embed";
  
  /** Estimated tokens */
  estimatedTokens?: number;
  
  /** Agent ID (if request is from an agent) */
  agentId?: string;
  
  /** Agent signature (if applicable) */
  agentSignature?: string;
}

export interface InferenceAccessVerification {
  /** Access granted */
  granted: boolean;
  
  /** Denial reason (if not granted) */
  denialReason?: string;
  
  /** Token ID verified */
  tokenId?: TokenId;
  
  /** License details */
  license?: InferenceLicense;
  
  /** Remaining usage */
  remainingUsage?: {
    inferences?: number;
    tokens?: number;
    timeMs?: number;
  };
  
  /** Decryption key (if encrypted data and access granted) */
  decryptionKey?: string;
  
  /** Access expiry for this session */
  sessionExpiresAt: string;
  
  /** Session ID for audit trail */
  sessionId: string;
  
  /** Verification timestamp */
  verifiedAt: string;
  
  /** On-chain verification tx */
  verificationTxHash?: DeploymentTxHash;
}

// =============================================================================
// CONTRACT QUERIES
// =============================================================================

export interface ContractQuery {
  /** Filter by type */
  type?: ContractType[];
  
  /** Filter by network */
  network?: BlockchainNetwork[];
  
  /** Filter by status */
  status?: ContractStatus[];
  
  /** Filter by owner */
  owner?: WalletAddress;
  
  /** Filter by store */
  storeId?: StoreId;
  
  /** Search by name/description */
  search?: string;
  
  /** Include inactive */
  includeInactive?: boolean;
  
  /** Pagination */
  offset?: number;
  limit?: number;
  
  /** Sort by */
  sortBy?: "createdAt" | "updatedAt" | "name";
  sortOrder?: "asc" | "desc";
}

export interface NFTAccessQuery {
  /** Filter by owner */
  owner?: WalletAddress;
  
  /** Filter by asset CID */
  assetCid?: Cid;
  
  /** Filter by contract */
  contractAddress?: ContractAddress;
  
  /** Filter by network */
  network?: BlockchainNetwork[];
  
  /** Filter by license type */
  licenseType?: NFTLicenseType[];
  
  /** Only active NFTs */
  activeOnly?: boolean;
  
  /** Pagination */
  offset?: number;
  limit?: number;
}

// =============================================================================
// CONTRACT DEPLOYMENT
// =============================================================================

export interface DeployContractRequest {
  /** Contract type */
  type: ContractType;
  
  /** Contract name */
  name: string;
  
  /** Description */
  description?: string;
  
  /** Target network */
  network: BlockchainNetwork;
  
  /** Deployer wallet */
  deployerWallet: WalletAddress;
  
  /** Store ID (optional) */
  storeId?: StoreId;
  
  /** Constructor arguments */
  constructorArgs: unknown[];
  
  /** Initial configuration */
  initialConfig?: Record<string, unknown>;
  
  /** Associated asset CID */
  assetCid?: Cid;
  
  /** Gas limit override */
  gasLimit?: number;
  
  /** Max fee per gas (gwei) */
  maxFeePerGas?: number;
}

export interface DeployContractResult {
  success: boolean;
  contract?: DeployedContract;
  transactionHash?: DeploymentTxHash;
  error?: string;
  gasUsed?: number;
}

// =============================================================================
// NFT MINTING FOR INFERENCE ACCESS
// =============================================================================

export interface MintInferenceNFTRequest {
  /** Recipient wallet */
  recipient: WalletAddress;
  
  /** Asset CID */
  assetCid: Cid;
  
  /** Asset name */
  assetName: string;
  
  /** Asset type */
  assetType: "model" | "agent" | "dataset" | "workflow";
  
  /** Contract address to mint from */
  contractAddress: ContractAddress;
  
  /** License type */
  licenseType: NFTLicenseType;
  
  /** License details */
  license: Omit<InferenceLicense, "licenseId" | "onChainHash" | "termsCid">;
  
  /** Data protection settings */
  dataProtection: Omit<DataProtectionSettings, "dataHash">;
  
  /** Usage limits */
  usageLimits: InferenceUsageLimits;
  
  /** Price (in USDC, 0 for free) */
  price: number;
  
  /** Royalty percentage (basis points) */
  royaltyBps: number;
  
  /** Expiration (null = never) */
  expiresAt?: string;
  
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface MintInferenceNFTResult {
  success: boolean;
  nft?: InferenceAccessNFT;
  transactionHash?: DeploymentTxHash;
  tokenId?: TokenId;
  metadataUri?: string;
  error?: string;
}

// =============================================================================
// ENCRYPTED DATA ACCESS
// =============================================================================

export interface RequestDecryptionKeyParams {
  /** NFT token ID */
  tokenId: TokenId;
  
  /** Contract address */
  contractAddress: ContractAddress;
  
  /** Requester wallet */
  requesterWallet: WalletAddress;
  
  /** Ownership proof signature */
  ownershipProof: string;
  
  /** Message that was signed */
  signedMessage: string;
  
  /** Purpose of access */
  accessPurpose: "inference" | "fine_tuning" | "evaluation" | "training";
  
  /** Agent ID (if accessing via agent) */
  agentId?: string;
}

export interface DecryptionKeyResponse {
  success: boolean;
  
  /** Encrypted decryption key (encrypted with requester's public key) */
  encryptedKey?: string;
  
  /** Key valid until */
  validUntil?: string;
  
  /** Session ID for audit */
  sessionId?: string;
  
  /** Error if failed */
  error?: string;
  
  /** Error code */
  errorCode?: "UNAUTHORIZED" | "EXPIRED" | "RATE_LIMITED" | "REVOKED" | "INVALID_PROOF";
}

// =============================================================================
// AUDIT LOG
// =============================================================================

export interface ContractAuditEntry {
  id: string;
  timestamp: string;
  contractAddress: ContractAddress;
  tokenId?: TokenId;
  action: "mint" | "transfer" | "revoke" | "access" | "decrypt" | "update_license";
  actor: WalletAddress;
  details: Record<string, unknown>;
  transactionHash?: DeploymentTxHash;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}
