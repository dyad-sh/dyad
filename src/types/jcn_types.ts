/**
 * JoyCreate Node (JCN) Types
 * Production-grade types for the Local Joy Create Node system.
 * 
 * The JCN handles:
 * - Asset publishing (upload → CID → manifest/merkle → mint → index)
 * - Bundle pinning/storage to IPFS/Web3.Storage
 * - Inference job execution with licensed access
 * - Crash-safe state machines with recovery
 */

// =============================================================================
// CORE IDENTIFIERS
// =============================================================================

/** UUID v4 format for all IDs */
export type JcnId = string;

/** Request ID for idempotency */
export type RequestId = string;

/** Trace ID for distributed tracing */
export type TraceId = string;

/** Store ID from marketplace */
export type StoreId = string;

/** Wallet address (0x prefixed) */
export type WalletAddress = string;

/** CID (Content Identifier) */
export type Cid = string;

/** Merkle root hash */
export type MerkleRoot = string;

/** SHA256 hash */
export type Sha256Hash = string;

/** Transaction hash */
export type TxHash = string;

/** License identifier */
export type LicenseId = string;

/** Key type for cryptographic operations */
export type KeyType = "signing" | "encryption" | "identity" | "node_identity";

/** Key algorithm for cryptographic operations */
export type KeyAlgorithm = "ed25519" | "secp256k1" | "rsa" | "ecdsa" | "rsa-2048" | "aes-256-gcm";

/** Usage metrics for tracking job execution */
export interface UsageMetrics {
  cpuTimeMs: number;
  memoryPeakMb: number;
  ioReadBytes: number;
  ioWriteBytes: number;
  networkBytes: number;
  executionTimeMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  memoryUsedMb?: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  gpuTimeMs?: number;
}

/** Execution output from a job */
export interface ExecutionOutput {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  data?: Record<string, unknown>;
  type?: string;
  [key: string]: unknown;
}

// =============================================================================
// AUTHORIZATION & AUTHENTICATION
// =============================================================================

export type AuthMethod = "jwt" | "mtls" | "api_key" | "signed_message";

export type Role = 
  | "store_owner"
  | "org_admin"
  | "publisher"
  | "executor"
  | "auditor"
  | "admin";

/** Alias for Role */
export type JcnRole = Role;

export type JcnPermission = 
  | "publish:create"
  | "publish:read"
  | "publish:update"
  | "publish:delete"
  | "job:create"
  | "job:read"
  | "job:cancel"
  | "bundle:create"
  | "bundle:read"
  | "bundle:verify"
  | "license:create"
  | "license:read"
  | "license:revoke"
  | "audit:read"
  | "audit:write"
  | string;

export type RateLimitScope = "user" | "global" | "store";

export interface AuthContext {
  /** Authentication method used */
  method: AuthMethod;
  /** Authenticated principal ID */
  principalId: string;
  /** Wallet address if applicable */
  walletAddress?: WalletAddress;
  /** Wallet address shorthand */
  wallet?: WalletAddress;
  /** Store ID */
  storeId?: StoreId;
  /** Roles assigned to principal */
  roles: Role[];
  /** Store IDs the principal has access to */
  authorizedStores: StoreId[];
  /** JWT expiry timestamp */
  expiresAt?: number;
  /** mTLS certificate fingerprint */
  certFingerprint?: string;
  /** Request trace ID */
  traceId: TraceId;
  /** Whether authenticated */
  authenticated?: boolean;
  /** Permissions granted to principal */
  permissions?: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface AuthorizationCheck {
  allowed: boolean;
  reason?: string;
  requiredRoles?: Role[];
  missingRoles?: Role[];
}

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

export type KeyStorageBackend = "os_keyring" | "encrypted_vault" | "hsm";

export interface KeyMetadata {
  /** Key identifier */
  keyId: string;
  /** Key type */
  type: "signing" | "encryption" | "chain";
  /** Storage backend */
  backend: KeyStorageBackend;
  /** Algorithm */
  algorithm: "secp256k1" | "ed25519" | "aes-256-gcm";
  /** Public key (for signing keys) */
  publicKey?: string;
  /** Wallet address (for chain keys) */
  walletAddress?: WalletAddress;
  /** Creation timestamp */
  createdAt: number;
  /** Last rotation timestamp */
  lastRotatedAt?: number;
  /** Key is active */
  active: boolean;
}

export interface KeyRotationConfig {
  /** Auto-rotate after N days */
  autoRotateDays?: number;
  /** Keep N previous keys for verification */
  keepPreviousKeys: number;
  /** Notify before rotation */
  notifyBeforeRotationDays: number;
}

// =============================================================================
// BUNDLE & MANIFEST
// =============================================================================

export type BundleType = 
  | "ai_agent" | "agent"
  | "ai_model" | "model"
  | "dataset" 
  | "prompt" | "prompt_library"
  | "tool" 
  | "workflow"
  | "knowledge_pack";

export interface BundleFile {
  /** Relative path within bundle */
  path: string;
  /** SHA256 hash of file content */
  sha256: Sha256Hash;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType?: string;
  /** Is executable (for agents) */
  executable?: boolean;
}

export interface BundleChunk {
  /** Chunk index */
  index: number;
  /** Chunk CID */
  cid: Cid;
  /** Chunk SHA256 */
  sha256: Sha256Hash;
  /** Chunk size */
  size: number;
  /** Offset in original file */
  offset: number;
}

export interface BundleManifest {
  /** Manifest version */
  version: "1.0.0";
  /** Bundle type */
  type: BundleType;
  /** Bundle name */
  name: string;
  /** Bundle description */
  description?: string;
  /** Semantic version */
  bundleVersion: string;
  /** Creator wallet */
  creator: WalletAddress;
  /** Store ID */
  storeId?: StoreId;
  /** Files in bundle (sorted by path for determinism) */
  files: BundleFile[];
  /** Chunks (if chunked) */
  chunks?: BundleChunk[];
  /** Total size in bytes */
  totalSize: number;
  /** Entry point (for agents) */
  entryPoint?: string;
  /** Dependencies */
  dependencies?: Record<string, string>;
  /** Runtime requirements */
  runtime?: {
    minMemoryMb?: number;
    minCpuCores?: number;
    gpuRequired?: boolean;
    gpuMemoryMb?: number;
  };
  /** License */
  license: {
    type: string;
    url?: string;
    restrictedUse?: string[];
  };
  /** Merkle root of all chunks/files */
  merkleRoot: MerkleRoot;
  /** Manifest hash (SHA256 of canonical JSON, excluding this field) */
  manifestHash?: Sha256Hash;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Publisher signature */
  signature?: {
    algorithm: "eip191" | "eip712" | "ed25519";
    value: string;
    signer: WalletAddress;
  };
}

export interface BundleVerification {
  valid: boolean;
  manifestHashValid: boolean;
  merkleRootValid: boolean;
  signatureValid: boolean;
  allFilesPresent: boolean;
  allChunksValid: boolean;
  errors: string[];
}

// =============================================================================
// PUBLISH STATE MACHINE
// =============================================================================

export type PublishState =
  | "INIT"
  | "BUNDLE_BUILT"
  | "PINNED"
  | "VERIFIED"
  | "MINTED"
  | "INDEXED"
  | "COMPLETE"
  | "FAILED"
  | "RETRYABLE";

export type PublishTransition =
  | { from: "INIT"; to: "BUNDLE_BUILT"; event: "bundle_created" }
  | { from: "BUNDLE_BUILT"; to: "PINNED"; event: "pin_success" }
  | { from: "BUNDLE_BUILT"; to: "RETRYABLE"; event: "pin_failed" }
  | { from: "PINNED"; to: "VERIFIED"; event: "verification_passed" }
  | { from: "PINNED"; to: "FAILED"; event: "verification_failed" }
  | { from: "VERIFIED"; to: "MINTED"; event: "mint_success" }
  | { from: "VERIFIED"; to: "RETRYABLE"; event: "mint_pending" }
  | { from: "MINTED"; to: "INDEXED"; event: "index_success" }
  | { from: "MINTED"; to: "RETRYABLE"; event: "index_failed" }
  | { from: "INDEXED"; to: "COMPLETE"; event: "publish_complete" }
  | { from: "RETRYABLE"; to: "INIT"; event: "retry" }
  | { from: "*"; to: "FAILED"; event: "abort" };

export interface PublishStateRecord {
  /** Unique publish ID */
  id: JcnId;
  /** Idempotency key (requestId) */
  requestId: RequestId;
  /** Trace ID for observability */
  traceId: TraceId;
  /** Current state */
  state: PublishState;
  /** State history */
  stateHistory: {
    state: PublishState;
    timestamp: number;
    event?: string;
    metadata?: Record<string, unknown>;
  }[];
  /** Store ID */
  storeId: StoreId;
  /** Publisher wallet */
  publisherWallet: WalletAddress;
  /** Bundle type */
  bundleType: BundleType;
  /** Local source path */
  sourcePath?: string;
  /** Bundle CID (after pinning) */
  bundleCid?: Cid;
  /** Manifest CID */
  manifestCid?: Cid;
  /** Manifest hash */
  manifestHash?: Sha256Hash;
  /** Merkle root */
  merkleRoot?: MerkleRoot;
  /** Mint transaction hash */
  mintTxHash?: TxHash;
  /** Minted token ID */
  tokenId?: string;
  /** Collection contract address */
  collectionContract?: WalletAddress;
  /** Marketplace asset ID */
  marketplaceAssetId?: string;
  /** Error information */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    retryCount: number;
    lastRetryAt?: number;
  };
  /** Checkpoint data for recovery */
  checkpoint?: {
    lastCompletedStep: string;
    data: Record<string, unknown>;
  };
  /** Source type */
  sourceType?: "local_path" | "cid";
  /** Metadata JSON */
  metadataJson?: {
    name: string;
    description?: string;
    version: string;
    license: string;
    licenseUrl?: string;
    tags?: string[];
  };
  /** Pricing JSON */
  pricingJson?: {
    model: string;
    amount?: number;
    currency?: string;
  };
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// =============================================================================
// JOB EXECUTION
// =============================================================================

export type JobState =
  | "PENDING"
  | "VALIDATING"
  | "FETCHING"
  | "EXECUTING"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT"
  | "RETRYABLE";

export interface JobTicket {
  /** Ticket version */
  v: 1;
  /** Ticket type */
  type: "job-ticket";
  /** Unique job ID */
  jobId: JcnId;
  /** Ticket ID */
  ticketId?: string;
  /** Bundle CID to execute */
  bundleCid: Cid;
  /** Bundle version */
  bundleVersion?: string;
  /** Merkle root for verification */
  merkleRoot: MerkleRoot;
  /** Input CID (if applicable) */
  inputCid?: Cid;
  /** Input hash */
  inputHash?: Sha256Hash;
  /** Input JSON */
  inputJson?: Record<string, unknown>;
  /** Requester wallet */
  requester: WalletAddress;
  /** Requester wallet (alias) */
  requesterWallet?: WalletAddress;
  /** Authorized executors (empty = any) */
  authorizedExecutors?: WalletAddress[];
  /** License ID */
  licenseId: string;
  /** License scope */
  licenseScope?: string;
  /** Max execution time in seconds */
  maxExecutionTimeSec: number;
  /** Payment information */
  payment?: {
    chain: string;
    currency: string;
    amount: string;
    txHash?: TxHash;
  };
  /** Job parameters */
  params?: Record<string, unknown>;
  /** Issued at timestamp */
  issuedAt: number;
  /** Expires at timestamp */
  expiresAt: number;
  /** Issuer (Joy/Marketplace) */
  issuer: WalletAddress;
  /** Issuer signature */
  signature: {
    algorithm: "eip191" | "eip712" | "ed25519";
    value: string;
  };
}

export interface InferenceReceipt {
  /** Receipt version */
  v: 1;
  /** Receipt type */
  type: "inference-receipt";
  /** Job ID */
  jobId: JcnId;
  /** Ticket ID */
  ticketId?: string;
  /** Receipt CID (after pinning) */
  receiptCid?: Cid;
  /** Bundle CID executed */
  bundleCid: Cid;
  /** Merkle root verified */
  merkleRoot: MerkleRoot;
  /** Input CID */
  inputCid?: Cid;
  /** Input hash */
  inputHash?: Sha256Hash;
  /** Output CID */
  outputCid: Cid;
  /** Output hash */
  outputHash: Sha256Hash;
  /** License used */
  licenseId: string;
  /** Executor wallet */
  executor: WalletAddress;
  /** Executor node address */
  executorNode?: string;
  /** Execution metrics */
  metrics: {
    startedAt: number;
    completedAt: number;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    gpuTimeMs?: number;
    memoryPeakMb?: number;
  };
  /** Requester wallet */
  requester: WalletAddress;
  /** Timestamp */
  timestamp: number;
  /** Executor signature */
  signature: {
    algorithm: "eip191" | "eip712" | "ed25519";
    value: string;
  };
}

export interface JobStateRecord {
  /** Unique job ID */
  id: JcnId;
  /** Request ID for idempotency */
  requestId: RequestId;
  /** Trace ID */
  traceId: TraceId;
  /** Current state */
  state: JobState;
  /** State history */
  stateHistory: {
    state: JobState;
    timestamp: number;
    event?: string;
    metadata?: Record<string, unknown>;
  }[];
  /** Job ticket */
  ticket: JobTicket;
  /** Ticket validation result */
  ticketValid?: boolean;
  /** License validation result */
  licenseValid?: boolean;
  /** License ID */
  licenseId?: string;
  /** Bundle verification result */
  bundleVerified?: boolean;
  /** Execution container ID */
  containerId?: string;
  /** Output CID */
  outputCid?: Cid;
  /** Receipt */
  receipt?: InferenceReceipt;
  /** Receipt CID (after pinning) */
  receiptCid?: Cid;
  /** Checkpoint data */
  checkpoint?: {
    workDir?: string;
    bundlePath?: string;
    extractDir?: string;
    manifest?: Record<string, unknown>;
  };
  /** Sandbox configuration */
  sandboxConfig?: SandboxConfig;
  /** Execution output */
  output?: ExecutionOutput;
  /** Execution metrics */
  metrics?: UsageMetrics;
  /** Error information */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    retryCount: number;
  };
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// =============================================================================
// LICENSE VALIDATION
// =============================================================================

export type LicenseType = "registry" | "token" | "signature" | "perpetual" | "subscription" | "usage_based";

export interface LicenseRecord {
  /** License ID */
  id?: string;
  /** License ID (legacy alias) */
  licenseId?: string;
  /** License type */
  type?: LicenseType;
  /** License type (legacy alias) */
  licenseType?: "perpetual" | "subscription" | "usage_based";
  /** Licensed asset (bundle CID or asset ID) */
  assetId?: string;
  /** Bundle CID (legacy alias) */
  bundleCid?: Cid;
  /** Licensee wallet */
  licensee?: WalletAddress;
  /** Holder wallet (legacy alias) */
  holderWallet?: WalletAddress;
  /** Licensor wallet */
  licensor?: WalletAddress;
  /** License scope */
  scope?: string;
  /** Usage limit */
  usageLimit?: number | null;
  /** Current usage */
  currentUsage?: number;
  /** Usage limits */
  limits?: {
    maxInferences?: number;
    maxTokens?: number;
    expiresAt?: number;
  };
  /** Current usage */
  usage?: {
    inferencesUsed: number;
    tokensUsed: number;
  };
  /** Verification data */
  verification?: {
    method: "contract_call" | "token_ownership" | "signature";
    contractAddress?: WalletAddress;
    tokenId?: string;
    signature?: string;
  };
  /** Is valid */
  valid?: boolean;
  /** Revoked status (legacy alias for valid: false) */
  revoked?: boolean;
  /** Validation timestamp */
  validatedAt?: number;
  /** Granted at timestamp */
  grantedAt?: number;
  /** Valid until timestamp */
  validUntil?: number;
  /** On chain flag */
  onChain?: boolean;
  /** Contract address */
  contractAddress?: WalletAddress;
  /** Token ID */
  tokenId?: string;
}

// =============================================================================
// STORAGE ADAPTER
// =============================================================================

export type StorageProvider = "ipfs_local" | "ipfs_remote" | "web3_storage" | "pinata" | "4everland";

export interface PinRequest {
  /** Content to pin (CID or raw data) */
  content: Cid | Buffer;
  /** Pin name/label */
  name?: string;
  /** Metadata */
  metadata?: Record<string, string>;
  /** Target providers */
  providers: StorageProvider[];
  /** Verification options */
  verification?: {
    enabled: boolean;
    expectedHash?: Sha256Hash;
    maxRetries: number;
  };
}

export interface PinResult {
  /** Provider */
  provider: StorageProvider;
  /** Success */
  success: boolean;
  /** CID */
  cid?: Cid;
  /** Pin ID (provider-specific) */
  pinId?: string;
  /** Gateway URL */
  gatewayUrl?: string;
  /** Size in bytes */
  size?: number;
  /** Error */
  error?: string;
  /** Verification passed */
  verified?: boolean;
}

export interface StorageStatus {
  provider: StorageProvider;
  connected: boolean;
  lastPingMs?: number;
  quotaUsedBytes?: number;
  quotaTotalBytes?: number;
  pinCount?: number;
}

// =============================================================================
// CHAIN ADAPTER
// =============================================================================

export type ChainNetwork = "polygon" | "polygon_mumbai" | "ethereum" | "base";

export interface ChainConfig {
  network: ChainNetwork;
  chainId: number;
  rpcUrl: string;
  marketplaceContract: WalletAddress;
  confirmationBlocks: number;
  maxGasPrice?: bigint;
}

export interface MintRequest {
  /** Request ID for idempotency */
  requestId: RequestId;
  /** Store ID */
  storeId: StoreId;
  /** Collection contract (if known) */
  collectionContract?: WalletAddress;
  /** Token metadata URI */
  tokenUri: string;
  /** Bundle CID */
  bundleCid: Cid;
  /** Merkle root */
  merkleRoot: MerkleRoot;
  /** Royalty basis points */
  royaltyBps: number;
  /** Initial price (optional) */
  initialPrice?: {
    amount: bigint;
    currency: WalletAddress;
  };
}

export interface MintResult {
  success: boolean;
  txHash?: TxHash;
  tokenId?: string;
  collectionContract?: WalletAddress;
  blockNumber?: number;
  confirmations?: number;
  error?: string;
  /** Transaction pending (submitted but not confirmed) */
  pending?: boolean;
}

export interface ChainTransaction {
  /** Transaction hash */
  txHash: TxHash;
  /** Network */
  network: ChainNetwork;
  /** Status */
  status: "pending" | "confirmed" | "failed" | "dropped";
  /** Block number (if confirmed) */
  blockNumber?: number;
  /** Confirmations */
  confirmations: number;
  /** Required confirmations */
  requiredConfirmations: number;
  /** Created at */
  createdAt: number;
  /** Last checked */
  lastCheckedAt: number;
}

// =============================================================================
// SANDBOX EXECUTION
// =============================================================================

export interface SandboxConfig {
  /** Container image (for Docker-based execution) */
  image?: string;
  /** CPU limit (cores) - Docker mode */
  cpuLimit?: number;
  /** Memory limit (MB) - Docker mode */
  memoryLimitMb?: number;
  /** Max memory (MB) - local execution */
  maxMemoryMb?: number;
  /** Max CPU percent - local execution */
  maxCpuPercent?: number;
  /** Max execution time (ms) */
  maxExecutionMs?: number;
  /** Max output bytes */
  maxOutputBytes?: number;
  /** GPU access */
  gpuEnabled?: boolean;
  /** GPU memory limit (MB) */
  gpuMemoryLimitMb?: number;
  /** Network access */
  networkEnabled?: boolean;
  /** Allow network - local execution */
  allowNetwork?: boolean;
  /** Allowed hosts (if network enabled) */
  allowedHosts?: string[];
  /** Allowed network domains - local execution */
  allowedNetworkDomains?: string[];
  /** Read-only filesystem */
  readOnlyFs?: boolean;
  /** Allow filesystem - local execution */
  allowFileSystem?: boolean;
  /** Writable paths */
  writablePaths?: string[];
  /** Allowed paths - local execution */
  allowedPaths?: string[];
  /** Timeout (seconds) - Docker mode */
  timeoutSec?: number;
  /** Seccomp profile */
  seccompProfile?: string;
  /** AppArmor profile */
  apparmorProfile?: string;
  /** Environment variables */
  envVars?: Record<string, string>;
}

export interface SandboxExecution {
  /** Execution ID */
  id: string;
  /** Container ID */
  containerId: string;
  /** Status */
  status: "starting" | "running" | "completed" | "failed" | "timeout" | "killed";
  /** Exit code */
  exitCode?: number;
  /** Stdout path */
  stdoutPath?: string;
  /** Stderr path */
  stderrPath?: string;
  /** Output path */
  outputPath?: string;
  /** Resource usage */
  resourceUsage?: {
    cpuTimeMs: number;
    memoryPeakMb: number;
    gpuTimeMs?: number;
  };
  /** Started at */
  startedAt?: number;
  /** Completed at */
  completedAt?: number;
}

// =============================================================================
// OBSERVABILITY
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface StructuredLog {
  /** Log level */
  level: LogLevel;
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** Message */
  message: string;
  /** Request ID */
  requestId?: RequestId;
  /** Job ID */
  jobId?: JcnId;
  /** Trace ID */
  traceId?: TraceId;
  /** Span ID */
  spanId?: string;
  /** Module/component */
  module: string;
  /** Additional attributes */
  attributes?: Record<string, unknown>;
  /** Error details */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface JcnMetrics {
  /** Publish metrics */
  publish: {
    total: number;
    successful: number;
    failed: number;
    inProgress: number;
    avgDurationMs: number;
  };
  /** Job metrics */
  jobs: {
    total: number;
    successful: number;
    failed: number;
    active: number;
    avgDurationMs: number;
  };
  /** Storage metrics */
  storage: {
    totalPinned: number;
    totalSizeBytes: number;
    failedPins: number;
  };
  /** Chain metrics */
  chain: {
    pendingTx: number;
    confirmedTx: number;
    failedTx: number;
    avgConfirmationMs: number;
  };
}

// =============================================================================
// ADMIN & RECOVERY
// =============================================================================

export interface ReplayRequest {
  /** Record ID to replay */
  recordId: JcnId;
  /** Record type */
  recordType: "publish" | "job";
  /** Replay from state */
  fromState?: PublishState | JobState;
  /** Admin override (skip some checks) */
  adminOverride?: {
    skipTimeCheck?: boolean;
    skipSignatureCheck?: boolean;
  };
  /** Reason for replay */
  reason: string;
  /** Admin who initiated */
  adminId: string;
}

export interface AuditEntry {
  /** Entry ID */
  id: JcnId;
  /** Timestamp */
  timestamp: number;
  /** Action type */
  action: string;
  /** Actor */
  actor: {
    type: "user" | "system" | "admin";
    id: string;
    wallet?: WalletAddress;
  };
  /** Target */
  target: {
    type: "publish" | "job" | "bundle" | "license" | "key";
    id: string;
  };
  /** Old state */
  oldState?: unknown;
  /** New state */
  newState?: unknown;
  /** Request ID */
  requestId?: RequestId;
  /** Trace ID */
  traceId?: TraceId;
  /** IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
}

// =============================================================================
// API TYPES
// =============================================================================

export interface JcnApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: RequestId;
  traceId: TraceId;
  timestamp: number;
}

export interface PublishAssetRequest {
  /** Idempotency key */
  requestId: RequestId;
  /** Store ID */
  storeId: StoreId;
  /** Bundle type */
  bundleType: BundleType;
  /** Source (local path or existing CID) */
  source: {
    type: "local_path" | "cid";
    value: string;
  };
  /** Asset metadata */
  metadata: {
    name: string;
    description?: string;
    version: string;
    license: string;
    tags?: string[];
  };
  /** Pricing */
  pricing?: {
    model: "free" | "one_time" | "subscription";
    amount?: number;
    currency?: string;
  };
  /** Mint on chain */
  mintOnChain: boolean;
  /** Index in marketplace */
  indexInMarketplace: boolean;
}

export interface RunJobRequest {
  /** Idempotency key */
  requestId: RequestId;
  /** Job ticket */
  ticket: JobTicket;
  /** Input data (CID or inline) */
  input?: {
    type: "cid" | "inline";
    value: string | Record<string, unknown>;
  };
  /** Encryption key (for encrypted I/O) */
  encryptionKey?: string;
}

export interface HealthStatus {
  /** Overall status */
  status: "healthy" | "degraded" | "unhealthy";
  /** Component statuses */
  components: {
    name: string;
    status: "up" | "down" | "degraded";
    latencyMs?: number;
    message?: string;
  }[];
  /** Version */
  version: string;
  /** Uptime seconds */
  uptimeSeconds: number;
  /** Last check */
  lastCheck: number;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

export interface RateLimitConfig {
  /** Endpoint or action */
  endpoint: string;
  /** Max requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSec: number;
  /** Per-user vs global */
  scope: "user" | "global" | "store";
}

export interface RateLimitState {
  /** Current count */
  count: number;
  /** Window start */
  windowStart: number;
  /** Remaining requests */
  remaining: number;
  /** Reset timestamp */
  resetAt: number;
  /** Is limited */
  limited: boolean;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface JcnConfig {
  /** Node ID */
  nodeId: string;
  /** Node version */
  version: string;
  /** Enabled features */
  features: {
    publishing: boolean;
    execution: boolean;
    pinning: boolean;
    minting: boolean;
  };
  /** Chain configuration */
  chain: ChainConfig;
  /** Storage providers */
  storage: {
    providers: StorageProvider[];
    primaryProvider: StorageProvider;
    verificationEnabled: boolean;
  };
  /** Execution configuration */
  execution?: SandboxConfig;
  /** Rate limits */
  rateLimits: RateLimitConfig[];
  /** Key rotation */
  keyRotation: KeyRotationConfig;
  /** Observability */
  observability: {
    logLevel: LogLevel;
    metricsEnabled: boolean;
    tracingEnabled: boolean;
    tracingEndpoint?: string;
  };
}
