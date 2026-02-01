/**
 * Hyper Liquid Data Types
 * Real-time data liquidity pipeline from local to federated marketplace
 * 
 * Features:
 * - Seamless local → joymarketplace.io data flow
 * - Real-time streaming with backpressure handling
 * - Content-addressed deduplication
 * - Automatic chunking and parallel uploads
 * - Resume-capable transfers
 * - License and access control propagation
 */

import type { WalletAddress, Cid, StoreId } from "./jcn_types";
import type { BlockchainNetwork, NFTLicenseType } from "./nft_types";
import type { StorageNetwork, DataType, DataVisibility, DataLicense, DataPricing } from "./sovereign_data";
import type { SyncMode, ConflictResolution, RetryPolicy } from "./hybrid_bridge_types";
import type { InferenceLicense, DataProtectionSettings } from "./deployed_contract_types";

// =============================================================================
// LIQUIDITY FLOW TYPES
// =============================================================================

/** Flow direction for data liquidity */
export type FlowDirection = 
  | "local-to-marketplace"     // Push to joymarketplace.io
  | "marketplace-to-local"     // Pull from marketplace
  | "bidirectional"            // Two-way sync
  | "broadcast";               // Push to multiple destinations

/** Flow priority levels */
export type FlowPriority = "critical" | "high" | "normal" | "low" | "background";

/** Flow status */
export type FlowStatus = 
  | "idle"
  | "preparing"
  | "streaming"
  | "paused"
  | "completing"
  | "completed"
  | "failed"
  | "cancelled";

/** Transfer protocol */
export type TransferProtocol = 
  | "ipfs"           // IPFS/Helia DAG transfer
  | "http-stream"    // HTTP chunked streaming
  | "websocket"      // WebSocket real-time
  | "graphsync"      // Filecoin GraphSync
  | "bitswap";       // IPFS Bitswap protocol

// =============================================================================
// LIQUID DATA CONTAINER
// =============================================================================

/**
 * A container for data in the liquidity pipeline.
 * Wraps any data with transfer metadata and flow control.
 */
export interface LiquidDataContainer<T = unknown> {
  /** Unique flow identifier */
  flowId: string;
  
  /** Data identifier (CID or local ID) */
  dataId: string;
  
  /** Content hash (CID) */
  contentCid?: Cid;
  
  /** Data type classification */
  dataType: DataType;
  
  /** Visibility level */
  visibility: DataVisibility;
  
  /** The actual data payload */
  payload?: T;
  
  /** Data size in bytes */
  sizeBytes: number;
  
  /** Number of chunks (for large data) */
  totalChunks: number;
  
  /** Chunks transferred */
  transferredChunks: number;
  
  /** Flow direction */
  direction: FlowDirection;
  
  /** Current status */
  status: FlowStatus;
  
  /** Transfer progress (0-100) */
  progress: number;
  
  /** Transfer speed (bytes/second) */
  speedBps: number;
  
  /** Estimated time remaining (seconds) */
  etaSeconds: number;
  
  /** Source location */
  source: DataLocation;
  
  /** Destination(s) */
  destinations: DataLocation[];
  
  /** Transfer protocol in use */
  protocol: TransferProtocol;
  
  /** Priority level */
  priority: FlowPriority;
  
  /** License attached to data */
  license?: DataLicense;
  
  /** Pricing info for marketplace */
  pricing?: DataPricing;
  
  /** Access control settings */
  accessControl?: DataProtectionSettings;
  
  /** Encryption status */
  encrypted: boolean;
  
  /** Owner wallet */
  owner: WalletAddress;
  
  /** Creation timestamp */
  createdAt: string;
  
  /** Last update timestamp */
  updatedAt: string;
  
  /** Completion timestamp */
  completedAt?: string;
  
  /** Error info if failed */
  error?: FlowError;
  
  /** Retry count */
  retries: number;
  
  /** Resume token for interrupted transfers */
  resumeToken?: string;
}

export interface DataLocation {
  type: "local" | "marketplace" | "ipfs" | "peer";
  
  /** For local: file path or DB key */
  localPath?: string;
  
  /** For marketplace: store ID */
  storeId?: StoreId;
  
  /** For IPFS: CID */
  cid?: Cid;
  
  /** For peer: peer ID */
  peerId?: string;
  
  /** Network/chain */
  network?: BlockchainNetwork | StorageNetwork;
  
  /** API endpoint */
  endpoint?: string;
}

export interface FlowError {
  code: string;
  message: string;
  retryable: boolean;
  timestamp: string;
  details?: Record<string, unknown>;
}

// =============================================================================
// LIQUIDITY PIPELINE CONFIGURATION
// =============================================================================

export interface LiquidityPipelineConfig {
  /** Pipeline identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Enable/disable */
  enabled: boolean;
  
  /** Flow direction */
  direction: FlowDirection;
  
  /** Data types to include */
  dataTypes: DataType[];
  
  /** Visibility levels to include */
  visibilities: DataVisibility[];
  
  /** Transfer protocol preference */
  preferredProtocol: TransferProtocol;
  
  /** Parallel transfer limit */
  maxParallelTransfers: number;
  
  /** Chunk size for large files (bytes) */
  chunkSizeBytes: number;
  
  /** Maximum bandwidth (bytes/second, 0 = unlimited) */
  maxBandwidthBps: number;
  
  /** Sync mode */
  syncMode: SyncMode;
  
  /** Conflict resolution strategy */
  conflictResolution: ConflictResolution;
  
  /** Retry policy */
  retryPolicy: RetryPolicy;
  
  /** Auto-start on app launch */
  autoStart: boolean;
  
  /** Schedule (cron expression, null = continuous) */
  schedule?: string;
  
  /** Destination configuration */
  marketplace: MarketplaceDestination;
  
  /** Filter rules */
  filters: LiquidityFilter[];
  
  /** Transform rules */
  transforms: LiquidityTransform[];
  
  /** Hooks for lifecycle events */
  hooks?: LiquidityHooks;
}

export interface MarketplaceDestination {
  /** JoyMarketplace API key */
  apiKey?: string;
  
  /** Publisher ID */
  publisherId?: string;
  
  /** Default store ID */
  defaultStoreId?: StoreId;
  
  /** Default store info */
  defaultStore?: {
    storeName: string;
    creatorId: string;
    creatorWallet: WalletAddress;
  };
  
  /** Auto-list on marketplace */
  autoList: boolean;
  
  /** Auto-mint as NFT */
  autoMint: boolean;
  
  /** Default license type */
  defaultLicense: NFTLicenseType;
  
  /** Default royalty (basis points) */
  defaultRoyaltyBps: number;
  
  /** Default pricing */
  defaultPricing?: DataPricing;
  
  /** Pin to IPFS providers */
  pinningProviders: ("4everland" | "pinata" | "helia")[];
}

export interface LiquidityFilter {
  /** Filter ID */
  id: string;
  
  /** Field to filter on */
  field: string;
  
  /** Operator */
  operator: "equals" | "not_equals" | "contains" | "gt" | "lt" | "regex" | "in";
  
  /** Value to compare */
  value: unknown;
  
  /** Action if matched */
  action: "include" | "exclude" | "transform" | "priority";
  
  /** Priority override (if action is priority) */
  priorityOverride?: FlowPriority;
}

export interface LiquidityTransform {
  /** Transform ID */
  id: string;
  
  /** Transform type */
  type: "encrypt" | "compress" | "chunk" | "hash" | "sign" | "redact" | "custom";
  
  /** Transform configuration */
  config: Record<string, unknown>;
  
  /** Order in transform chain */
  order: number;
}

export interface LiquidityHooks {
  /** Called before transfer starts */
  beforeTransfer?: string; // Function name or webhook URL
  
  /** Called after successful transfer */
  afterTransfer?: string;
  
  /** Called on transfer error */
  onError?: string;
  
  /** Called on conflict detection */
  onConflict?: string;
  
  /** Called when data is listed on marketplace */
  onListed?: string;
  
  /** Called when NFT is minted */
  onMinted?: string;
}

// =============================================================================
// FLOW QUEUE & BATCH OPERATIONS
// =============================================================================

export interface FlowQueue {
  /** Queue ID */
  id: string;
  
  /** Pipeline this queue belongs to */
  pipelineId: string;
  
  /** Total items in queue */
  totalItems: number;
  
  /** Items completed */
  completedItems: number;
  
  /** Items failed */
  failedItems: number;
  
  /** Items currently transferring */
  activeItems: number;
  
  /** Queue status */
  status: "idle" | "processing" | "paused" | "draining";
  
  /** Start time */
  startedAt?: string;
  
  /** Estimated completion */
  estimatedCompletion?: string;
  
  /** Total bytes to transfer */
  totalBytes: number;
  
  /** Bytes transferred */
  transferredBytes: number;
  
  /** Average speed (bytes/second) */
  averageSpeedBps: number;
}

export interface FlowBatch {
  /** Batch ID */
  id: string;
  
  /** Flows in this batch */
  flows: LiquidDataContainer[];
  
  /** Batch priority */
  priority: FlowPriority;
  
  /** Batch status */
  status: FlowStatus;
  
  /** Created at */
  createdAt: string;
  
  /** Started at */
  startedAt?: string;
  
  /** Completed at */
  completedAt?: string;
  
  /** Success count */
  successCount: number;
  
  /** Failure count */
  failureCount: number;
}

// =============================================================================
// MARKETPLACE LISTING RESULT
// =============================================================================

export interface MarketplaceListingResult {
  /** Flow ID */
  flowId: string;
  
  /** Data ID */
  dataId: string;
  
  /** Success status */
  success: boolean;
  
  /** Marketplace asset ID */
  marketplaceAssetId?: string;
  
  /** Store asset link ID */
  storeAssetLinkId?: string;
  
  /** Listed in store */
  storeName?: string;
  
  /** IPFS CID */
  contentCid?: Cid;
  
  /** Metadata CID */
  metadataCid?: Cid;
  
  /** NFT token ID (if minted) */
  tokenId?: string;
  
  /** NFT contract address */
  contractAddress?: WalletAddress;
  
  /** Mint transaction hash */
  mintTxHash?: string;
  
  /** Marketplace listing URL */
  listingUrl?: string;
  
  /** Pin results */
  pinResults?: {
    provider: string;
    success: boolean;
    pinId?: string;
    gateway?: string;
  }[];
  
  /** Error message */
  error?: string;
  
  /** Timestamp */
  timestamp: string;
}

// =============================================================================
// REAL-TIME STREAM EVENTS
// =============================================================================

export interface LiquidityStreamEvent {
  type: LiquidityEventType;
  flowId?: string;
  pipelineId?: string;
  timestamp: string;
  data: unknown;
}

export type LiquidityEventType =
  | "pipeline:started"
  | "pipeline:stopped"
  | "pipeline:paused"
  | "pipeline:resumed"
  | "pipeline:error"
  | "flow:queued"
  | "flow:started"
  | "flow:progress"
  | "flow:chunk-complete"
  | "flow:completed"
  | "flow:failed"
  | "flow:cancelled"
  | "flow:retrying"
  | "batch:started"
  | "batch:completed"
  | "batch:failed"
  | "marketplace:listed"
  | "marketplace:minted"
  | "marketplace:pinned"
  | "conflict:detected"
  | "conflict:resolved";

export interface FlowProgressEvent {
  flowId: string;
  dataId: string;
  progress: number;
  transferredBytes: number;
  totalBytes: number;
  transferredChunks: number;
  totalChunks: number;
  speedBps: number;
  etaSeconds: number;
}

// =============================================================================
// LIQUIDITY STATS & ANALYTICS
// =============================================================================

export interface LiquidityStats {
  /** Pipeline stats are aggregated */
  pipelineId?: string;
  
  /** Time period */
  period: "hour" | "day" | "week" | "month" | "all";
  
  /** Total flows processed */
  totalFlows: number;
  
  /** Successful flows */
  successfulFlows: number;
  
  /** Failed flows */
  failedFlows: number;
  
  /** Success rate (0-100) */
  successRate: number;
  
  /** Total bytes transferred */
  totalBytesTransferred: number;
  
  /** Average transfer speed */
  averageSpeedBps: number;
  
  /** Peak transfer speed */
  peakSpeedBps: number;
  
  /** Total items listed on marketplace */
  marketplaceListings: number;
  
  /** Total NFTs minted */
  nftsMinted: number;
  
  /** Revenue generated (USDC) */
  revenueGenerated: number;
  
  /** Data types breakdown */
  byDataType: Record<DataType, {
    count: number;
    bytes: number;
    revenue: number;
  }>;
  
  /** Top destinations */
  topDestinations: {
    storeId: string;
    storeName: string;
    count: number;
    bytes: number;
  }[];
  
  /** Error breakdown */
  errorsByType: Record<string, number>;
  
  /** Calculated at */
  calculatedAt: string;
}

// =============================================================================
// API REQUESTS & RESPONSES
// =============================================================================

export interface StartFlowRequest {
  /** Data ID to transfer */
  dataId: string;
  
  /** Optional: specific pipeline to use */
  pipelineId?: string;
  
  /** Override priority */
  priority?: FlowPriority;
  
  /** Override destination */
  destination?: DataLocation;
  
  /** Override license */
  license?: DataLicense;
  
  /** Override pricing */
  pricing?: DataPricing;
  
  /** Auto-list on marketplace */
  autoList?: boolean;
  
  /** Auto-mint as NFT */
  autoMint?: boolean;
  
  /** Metadata overrides */
  metadata?: Record<string, unknown>;
}

export interface StartFlowResponse {
  success: boolean;
  flowId?: string;
  queuePosition?: number;
  estimatedStart?: string;
  error?: string;
}

export interface BatchFlowRequest {
  /** Data IDs to transfer */
  dataIds: string[];
  
  /** Pipeline to use */
  pipelineId?: string;
  
  /** Batch priority */
  priority?: FlowPriority;
  
  /** Common settings for all */
  commonSettings?: {
    license?: DataLicense;
    pricing?: DataPricing;
    autoList?: boolean;
    autoMint?: boolean;
  };
}

export interface BatchFlowResponse {
  success: boolean;
  batchId?: string;
  flowIds?: string[];
  queuedCount: number;
  error?: string;
}

export interface PausePipelineRequest {
  pipelineId: string;
  /** Graceful: wait for active transfers */
  graceful?: boolean;
}

export interface ResumePipelineRequest {
  pipelineId: string;
  /** Resume from checkpoint */
  fromCheckpoint?: boolean;
}

// =============================================================================
// DEDUPLICATION & CONTENT ADDRESSING
// =============================================================================

export interface ContentDeduplication {
  /** CID of content */
  cid: Cid;
  
  /** Already exists on marketplace */
  existsOnMarketplace: boolean;
  
  /** Existing marketplace asset ID */
  existingAssetId?: string;
  
  /** Existing listings */
  existingListings?: {
    storeId: string;
    storeName: string;
    assetId: string;
    price: number;
    currency: string;
  }[];
  
  /** Already pinned */
  pinnedProviders: string[];
  
  /** Recommendation */
  recommendation: "skip" | "link" | "transfer" | "update";
}

// =============================================================================
// CHECKPOINT & RESUME
// =============================================================================

export interface FlowCheckpoint {
  /** Flow ID */
  flowId: string;
  
  /** Checkpoint timestamp */
  timestamp: string;
  
  /** Chunks completed */
  completedChunks: number[];
  
  /** Bytes transferred */
  bytesTransferred: number;
  
  /** Last successful chunk CID */
  lastChunkCid?: Cid;
  
  /** Upload session ID (for resumable uploads) */
  uploadSessionId?: string;
  
  /** Expires at */
  expiresAt: string;
}
