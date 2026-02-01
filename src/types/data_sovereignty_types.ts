/**
 * Data Sovereignty & Monetization Types
 * 
 * Complete user data protection and monetization system:
 * - Protect data from harvesting
 * - Contain data in user-controlled vaults
 * - Monetize through NFT-gated access
 * - Flow to marketplace with full ownership retained
 */

import type { WalletAddress, Cid, StoreId } from "./jcn_types";
import type { DataType, DataVisibility, DataLicense, DataPricing } from "./sovereign_data";

// =============================================================================
// DATA PROTECTION STATUS
// =============================================================================

/**
 * Protection levels for user data
 */
export type ProtectionLevel = 
  | "unprotected"      // Raw data, no encryption
  | "encrypted"        // Encrypted at rest
  | "sealed"           // Encrypted + access controlled
  | "sovereign"        // Sealed + NFT-gated + revocable
  | "monetized";       // Sovereign + marketplace listed

/**
 * Encryption algorithms supported
 */
export type EncryptionAlgorithm = 
  | "aes-256-gcm"
  | "chacha20-poly1305"
  | "xchacha20-poly1305";

/**
 * Key derivation functions
 */
export type KeyDerivationFunction = 
  | "argon2id"
  | "scrypt"
  | "pbkdf2";

/**
 * Where encryption keys are stored
 */
export type KeyStorageLocation = 
  | "local-vault"      // User's local encrypted vault
  | "hardware-wallet"  // Hardware wallet (Ledger, Trezor)
  | "smart-contract"   // On-chain escrow
  | "threshold-split"; // Shamir's secret sharing

// =============================================================================
// PROTECTED DATA ASSET
// =============================================================================

/**
 * A user's protected data asset with full sovereignty
 */
export interface ProtectedDataAsset {
  /** Unique asset ID */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description */
  description?: string;
  
  /** Type of data */
  dataType: DataType;
  
  /** Original file path (if from local) */
  originalPath?: string;
  
  /** Content hash (before encryption) */
  contentHash: string;
  
  /** Content CID (after encryption) */
  encryptedCid?: Cid;
  
  /** Size in bytes (original) */
  originalSizeBytes: number;
  
  /** Size in bytes (encrypted) */
  encryptedSizeBytes?: number;
  
  /** Current protection level */
  protectionLevel: ProtectionLevel;
  
  /** Encryption details */
  encryption?: DataEncryption;
  
  /** Access control settings */
  accessControl?: DataAccessControl;
  
  /** Monetization settings */
  monetization?: DataMonetization;
  
  /** Owner wallet address */
  owner: WalletAddress;
  
  /** Creation timestamp */
  createdAt: string;
  
  /** Last modified */
  updatedAt: string;
  
  /** Tags for organization */
  tags?: string[];
  
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Encryption configuration for an asset
 */
export interface DataEncryption {
  /** Algorithm used */
  algorithm: EncryptionAlgorithm;
  
  /** Key derivation function */
  kdf: KeyDerivationFunction;
  
  /** Key length in bits */
  keyLengthBits: 256 | 384 | 512;
  
  /** Where the key is stored */
  keyStorage: KeyStorageLocation;
  
  /** Key ID (for retrieval) */
  keyId: string;
  
  /** Initialization vector (base64) */
  iv?: string;
  
  /** Salt (for key derivation, base64) */
  salt?: string;
  
  /** Encrypted at timestamp */
  encryptedAt: string;
  
  /** Key rotation schedule */
  keyRotationDays?: number;
  
  /** Last key rotation */
  lastKeyRotation?: string;
}

// =============================================================================
// ACCESS CONTROL
// =============================================================================

/**
 * Access control configuration
 */
export interface DataAccessControl {
  /** Is access gated by NFT? */
  nftGated: boolean;
  
  /** NFT contract address */
  nftContractAddress?: WalletAddress;
  
  /** Required token ID (or null for any token) */
  requiredTokenId?: string;
  
  /** License contract address */
  licenseContractAddress?: WalletAddress;
  
  /** License ID */
  licenseId?: string;
  
  /** Whitelist of allowed wallets */
  allowedWallets?: WalletAddress[];
  
  /** Blacklist of denied wallets */
  deniedWallets?: WalletAddress[];
  
  /** Maximum number of accesses */
  maxAccesses?: number;
  
  /** Current access count */
  currentAccessCount: number;
  
  /** Access expiration date */
  accessExpiresAt?: string;
  
  /** Require signed message for access */
  requireSignature: boolean;
  
  /** Usage metering enabled */
  meteringEnabled: boolean;
  
  /** Rate limits */
  rateLimits?: {
    maxRequestsPerHour: number;
    maxTokensPerDay: number;
    maxBytesPerMonth: number;
  };
}

// =============================================================================
// MONETIZATION
// =============================================================================

/**
 * Monetization configuration for an asset
 */
export interface DataMonetization {
  /** Is monetization enabled? */
  enabled: boolean;
  
  /** Pricing model */
  pricingModel: PricingModel;
  
  /** Base price */
  price: number;
  
  /** Currency */
  currency: "USDC" | "MATIC" | "ETH" | "JOY";
  
  /** Royalty percentage (0-100) */
  royaltyPercent: number;
  
  /** Revenue split addresses */
  revenueSplit?: RevenueSplit[];
  
  /** Marketplace listing ID */
  marketplaceListingId?: string;
  
  /** Marketplace URL */
  marketplaceUrl?: string;
  
  /** NFT token ID (if minted) */
  nftTokenId?: string;
  
  /** NFT contract address */
  nftContractAddress?: WalletAddress;
  
  /** Total revenue earned */
  totalRevenue: number;
  
  /** Number of purchases/accesses */
  totalPurchases: number;
  
  /** License terms */
  license: MonetizationLicense;
  
  /** Auto-renew subscription */
  autoRenewEnabled?: boolean;
  
  /** Subscription period */
  subscriptionPeriod?: "daily" | "weekly" | "monthly" | "yearly";
}

/**
 * Pricing models available
 */
export type PricingModel = 
  | "one-time"           // Single purchase
  | "subscription"       // Recurring access
  | "per-use"            // Pay per inference/query
  | "per-token"          // Pay per token processed
  | "tiered"             // Volume-based pricing
  | "free"               // Free with optional tip
  | "pay-what-you-want"; // User chooses price

/**
 * Revenue split configuration
 */
export interface RevenueSplit {
  /** Recipient wallet address */
  address: WalletAddress;
  
  /** Percentage of revenue (0-100) */
  percent: number;
  
  /** Role description */
  role: string;
}

/**
 * License terms for monetized data
 */
export interface MonetizationLicense {
  /** License type */
  type: LicenseType;
  
  /** Allowed uses */
  allowedUses: AllowedUse[];
  
  /** Prohibited uses */
  prohibitedUses: ProhibitedUse[];
  
  /** Can sublicense? */
  canSublicense: boolean;
  
  /** Can modify? */
  canModify: boolean;
  
  /** Can redistribute? */
  canRedistribute: boolean;
  
  /** Attribution required? */
  attributionRequired: boolean;
  
  /** Commercial use allowed? */
  commercialUse: boolean;
  
  /** Geographic restrictions */
  geoRestrictions?: string[];
  
  /** Industry restrictions */
  industryRestrictions?: string[];
  
  /** Custom terms (IPFS CID to full legal text) */
  customTermsCid?: Cid;
}

export type LicenseType = 
  | "personal"          // Personal use only
  | "commercial"        // Commercial allowed
  | "research"          // Academic/research only
  | "enterprise"        // Enterprise license
  | "exclusive"         // Exclusive rights
  | "custom";           // Custom terms

export type AllowedUse = 
  | "inference"         // AI inference
  | "training"          // Model training
  | "fine-tuning"       // Model fine-tuning
  | "embedding"         // Generate embeddings
  | "analysis"          // Data analysis
  | "visualization"     // Visualization
  | "export"            // Export data
  | "api-access";       // API access

export type ProhibitedUse = 
  | "resale"            // No reselling
  | "scraping"          // No scraping for other uses
  | "aggregation"       // No aggregating with other data
  | "profiling"         // No user profiling
  | "surveillance"      // No surveillance
  | "military"          // No military use
  | "harmful-content";  // No harmful content generation

// =============================================================================
// HARVESTING PROTECTION
// =============================================================================

/**
 * Anti-harvesting configuration
 */
export interface AntiHarvestingConfig {
  /** Is anti-harvesting enabled? */
  enabled: boolean;
  
  /** Watermarking enabled */
  watermarkEnabled: boolean;
  
  /** Watermark type */
  watermarkType?: "visible" | "invisible" | "steganographic";
  
  /** Fingerprinting enabled (unique per-user output) */
  fingerprintEnabled: boolean;
  
  /** Rate limiting */
  rateLimiting: RateLimitConfig;
  
  /** Anomaly detection */
  anomalyDetection: AnomalyDetectionConfig;
  
  /** Access logging */
  accessLogging: AccessLoggingConfig;
  
  /** Blocklist of known harvesters */
  harvesterBlocklist: HarvesterEntry[];
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Max requests per minute */
  maxRequestsPerMinute: number;
  
  /** Max requests per hour */
  maxRequestsPerHour: number;
  
  /** Max requests per day */
  maxRequestsPerDay: number;
  
  /** Max tokens per request */
  maxTokensPerRequest: number;
  
  /** Max bytes per request */
  maxBytesPerRequest: number;
  
  /** Cooldown after limit hit (seconds) */
  cooldownSeconds: number;
  
  /** Penalty for repeated violations */
  penaltyMultiplier: number;
}

/**
 * Anomaly detection configuration
 */
export interface AnomalyDetectionConfig {
  /** Enabled */
  enabled: boolean;
  
  /** Detect rapid sequential access */
  detectRapidAccess: boolean;
  
  /** Detect bulk downloads */
  detectBulkDownloads: boolean;
  
  /** Detect pattern scanning */
  detectPatternScanning: boolean;
  
  /** Detect automated access */
  detectAutomatedAccess: boolean;
  
  /** Threshold for flagging (0-100) */
  sensitivityThreshold: number;
  
  /** Action on detection */
  actionOnDetection: "alert" | "rate-limit" | "block" | "challenge";
  
  /** Challenge type */
  challengeType?: "captcha" | "signature" | "payment";
}

/**
 * Access logging configuration
 */
export interface AccessLoggingConfig {
  /** Log all access */
  logAllAccess: boolean;
  
  /** Log to blockchain */
  logToChain: boolean;
  
  /** Log to IPFS */
  logToIpfs: boolean;
  
  /** Retention period (days) */
  retentionDays: number;
  
  /** Include user agent */
  includeUserAgent: boolean;
  
  /** Include IP (hashed) */
  includeIpHash: boolean;
  
  /** Include request details */
  includeRequestDetails: boolean;
}

/**
 * Known harvester entry
 */
export interface HarvesterEntry {
  /** Identifier (wallet, IP hash, user agent pattern) */
  identifier: string;
  
  /** Type of identifier */
  identifierType: "wallet" | "ip-hash" | "user-agent" | "fingerprint";
  
  /** Reason for blocking */
  reason: string;
  
  /** Source of report */
  source: "user" | "community" | "automated";
  
  /** Confidence score */
  confidence: number;
  
  /** Added timestamp */
  addedAt: string;
  
  /** Expiration (or null for permanent) */
  expiresAt?: string;
}

// =============================================================================
// DATA SOVEREIGNTY VAULT
// =============================================================================

/**
 * User's data sovereignty vault
 */
export interface DataSovereigntyVault {
  /** Vault ID */
  id: string;
  
  /** Owner wallet address */
  owner: WalletAddress;
  
  /** Vault name */
  name: string;
  
  /** Total assets in vault */
  totalAssets: number;
  
  /** Total size in bytes */
  totalSizeBytes: number;
  
  /** Protected assets count */
  protectedAssetsCount: number;
  
  /** Monetized assets count */
  monetizedAssetsCount: number;
  
  /** Total revenue earned */
  totalRevenueEarned: number;
  
  /** Vault encryption key ID */
  vaultKeyId: string;
  
  /** Default protection level for new assets */
  defaultProtectionLevel: ProtectionLevel;
  
  /** Default encryption settings */
  defaultEncryption: Partial<DataEncryption>;
  
  /** Default access control */
  defaultAccessControl: Partial<DataAccessControl>;
  
  /** Default monetization */
  defaultMonetization: Partial<DataMonetization>;
  
  /** Anti-harvesting config */
  antiHarvesting: AntiHarvestingConfig;
  
  /** Created timestamp */
  createdAt: string;
  
  /** Last activity */
  lastActivityAt: string;
}

// =============================================================================
// PROTECTION WORKFLOW
// =============================================================================

/**
 * Request to protect data
 */
export interface ProtectDataRequest {
  /** Asset to protect (ID or path) */
  assetIdOrPath: string;
  
  /** Target protection level */
  targetLevel: ProtectionLevel;
  
  /** Encryption config (optional, uses vault defaults) */
  encryption?: Partial<DataEncryption>;
  
  /** Access control (optional) */
  accessControl?: Partial<DataAccessControl>;
  
  /** Monetization (optional) */
  monetization?: Partial<DataMonetization>;
  
  /** Mint NFT for access control? */
  mintNft?: boolean;
  
  /** List on marketplace? */
  listOnMarketplace?: boolean;
  
  /** Pipeline ID for marketplace flow */
  pipelineId?: string;
}

/**
 * Result of protection operation
 */
export interface ProtectDataResult {
  /** Success */
  success: boolean;
  
  /** Protected asset (if successful) */
  asset?: ProtectedDataAsset;
  
  /** NFT details (if minted) */
  nft?: {
    tokenId: string;
    contractAddress: WalletAddress;
    txHash: string;
  };
  
  /** Marketplace listing (if listed) */
  listing?: {
    listingId: string;
    url: string;
  };
  
  /** Error message (if failed) */
  error?: string;
  
  /** Warnings */
  warnings?: string[];
}

/**
 * Request to revoke access
 */
export interface RevokeAccessRequest {
  /** Asset ID */
  assetId: string;
  
  /** Wallet to revoke (or all if not specified) */
  wallet?: WalletAddress;
  
  /** Token ID to revoke */
  tokenId?: string;
  
  /** Reason for revocation */
  reason: string;
  
  /** Refund purchaser? */
  refund?: boolean;
}

/**
 * Request to update monetization
 */
export interface UpdateMonetizationRequest {
  /** Asset ID */
  assetId: string;
  
  /** New price */
  price?: number;
  
  /** New pricing model */
  pricingModel?: PricingModel;
  
  /** Update license */
  license?: Partial<MonetizationLicense>;
  
  /** Pause/unpause */
  paused?: boolean;
}

// =============================================================================
// ACCESS VERIFICATION
// =============================================================================

/**
 * Request to verify access
 */
export interface VerifyAccessRequest {
  /** Asset ID */
  assetId: string;
  
  /** Requester wallet */
  requesterWallet: WalletAddress;
  
  /** Signed message proving ownership */
  signature?: string;
  
  /** Message that was signed */
  message?: string;
  
  /** NFT token ID (if NFT-gated) */
  tokenId?: string;
  
  /** Requested use */
  intendedUse: AllowedUse;
}

/**
 * Access verification result
 */
export interface VerifyAccessResult {
  /** Access granted? */
  granted: boolean;
  
  /** Reason (if denied) */
  reason?: string;
  
  /** Decryption key (if granted and needed) */
  decryptionKey?: string;
  
  /** Access token for this session */
  accessToken?: string;
  
  /** Token expiration */
  expiresAt?: string;
  
  /** Rate limit remaining */
  rateLimitRemaining?: {
    requests: number;
    tokens: number;
    bytes: number;
  };
  
  /** Watermark ID (for tracking) */
  watermarkId?: string;
  
  /** License terms summary */
  licenseSummary?: string;
}

// =============================================================================
// ANALYTICS & REPORTING
// =============================================================================

/**
 * Data sovereignty analytics
 */
export interface SovereigntyAnalytics {
  /** Period */
  period: "day" | "week" | "month" | "year" | "all";
  
  /** Total protected assets */
  totalProtectedAssets: number;
  
  /** Total monetized assets */
  totalMonetizedAssets: number;
  
  /** Total revenue */
  totalRevenue: number;
  
  /** Revenue by currency */
  revenueByCurrency: Record<string, number>;
  
  /** Total accesses */
  totalAccesses: number;
  
  /** Accesses granted */
  accessesGranted: number;
  
  /** Accesses denied */
  accessesDenied: number;
  
  /** Harvesting attempts blocked */
  harvestingBlocked: number;
  
  /** Top assets by revenue */
  topAssetsByRevenue: {
    assetId: string;
    name: string;
    revenue: number;
  }[];
  
  /** Top assets by access */
  topAssetsByAccess: {
    assetId: string;
    name: string;
    accesses: number;
  }[];
  
  /** Revenue over time */
  revenueTimeline: {
    date: string;
    revenue: number;
  }[];
  
  /** Calculated at */
  calculatedAt: string;
}

/**
 * Access log entry
 */
export interface AccessLogEntry {
  /** Entry ID */
  id: string;
  
  /** Asset ID */
  assetId: string;
  
  /** Requester wallet */
  requesterWallet: WalletAddress;
  
  /** Access type */
  accessType: AllowedUse;
  
  /** Was granted? */
  granted: boolean;
  
  /** Denial reason (if denied) */
  denialReason?: string;
  
  /** Tokens consumed */
  tokensConsumed?: number;
  
  /** Bytes transferred */
  bytesTransferred?: number;
  
  /** Revenue generated */
  revenueGenerated?: number;
  
  /** User agent hash */
  userAgentHash?: string;
  
  /** IP hash */
  ipHash?: string;
  
  /** Was flagged as suspicious? */
  suspicious: boolean;
  
  /** Suspicion reason */
  suspicionReason?: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** On-chain tx hash (if logged to chain) */
  txHash?: string;
  
  /** IPFS CID (if logged to IPFS) */
  logCid?: Cid;
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

/**
 * Batch protect request
 */
export interface BatchProtectRequest {
  /** Assets to protect */
  assets: {
    path: string;
    name?: string;
    dataType?: DataType;
  }[];
  
  /** Common protection settings */
  settings: Omit<ProtectDataRequest, "assetIdOrPath">;
}

/**
 * Batch protect result
 */
export interface BatchProtectResult {
  /** Total processed */
  total: number;
  
  /** Successfully protected */
  successful: number;
  
  /** Failed */
  failed: number;
  
  /** Results per asset */
  results: {
    path: string;
    success: boolean;
    assetId?: string;
    error?: string;
  }[];
}
