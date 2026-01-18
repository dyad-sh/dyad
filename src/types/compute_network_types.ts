/**
 * Decentralized Compute Network Types
 * libp2p/Helia-based peer networking for AI inference
 */

// ============================================================================
// Peer Identity & Discovery
// ============================================================================

export interface ComputePeerId {
  /** libp2p peer ID (base58 encoded) */
  peerId: string;
  /** Wallet address for payments/staking */
  walletAddress: string;
  /** Ed25519 public key for signing */
  publicKey: string;
  /** Display name (optional) */
  displayName?: string;
  /** Avatar CID (optional) */
  avatarCid?: string;
}

export interface PeerCapabilities {
  /** GPU models available */
  gpus: GpuInfo[];
  /** Total VRAM in MB */
  totalVram: number;
  /** Available VRAM in MB */
  availableVram: number;
  /** CPU cores */
  cpuCores: number;
  /** RAM in MB */
  ramMb: number;
  /** Available RAM in MB */
  availableRamMb: number;
  /** Disk space available in MB */
  diskMb: number;
  /** Supported model formats */
  supportedFormats: ModelFormat[];
  /** Supported quantizations */
  supportedQuantizations: QuantizationType[];
  /** Maximum model size in MB */
  maxModelSize: number;
  /** Maximum batch size */
  maxBatchSize: number;
  /** Network bandwidth estimate (Mbps) */
  bandwidthMbps: number;
  /** Whether peer can run as validator */
  canValidate: boolean;
}

export interface GpuInfo {
  name: string;
  vendor: "nvidia" | "amd" | "intel" | "apple" | "other";
  vramMb: number;
  computeCapability?: string;
  driverVersion?: string;
}

export type ModelFormat = 
  | "gguf"
  | "safetensors"
  | "pytorch"
  | "onnx"
  | "tensorrt"
  | "openvino"
  | "coreml";

export type QuantizationType =
  | "fp32"
  | "fp16"
  | "bf16"
  | "int8"
  | "int4"
  | "q4_0"
  | "q4_1"
  | "q5_0"
  | "q5_1"
  | "q8_0"
  | "q2_k"
  | "q3_k"
  | "q4_k"
  | "q5_k"
  | "q6_k";

export interface PeerInfo {
  id: ComputePeerId;
  capabilities: PeerCapabilities;
  /** Multiaddrs for connecting */
  addresses: string[];
  /** When peer was first seen */
  firstSeen: number;
  /** Last heartbeat timestamp */
  lastSeen: number;
  /** Peer reputation score (0-100) */
  reputation: number;
  /** Total jobs completed */
  jobsCompleted: number;
  /** Average job latency in ms */
  avgLatency: number;
  /** Uptime percentage */
  uptime: number;
  /** Current status */
  status: PeerStatus;
  /** Current jobs being processed */
  activeJobs: number;
  /** NAT type detected */
  natType: NatType;
  /** Whether this peer is a relay */
  isRelay: boolean;
  /** Staked amount (for validators) */
  stakedAmount?: bigint;
}

export type PeerStatus = 
  | "online"
  | "busy"
  | "idle"
  | "offline"
  | "syncing"
  | "error";

export type NatType =
  | "public"
  | "full-cone"
  | "restricted-cone"
  | "port-restricted"
  | "symmetric"
  | "unknown";

// ============================================================================
// Discovery & Transport
// ============================================================================

export interface DiscoveryConfig {
  /** Bootstrap peers to connect to initially */
  bootstrapPeers: string[];
  /** mDNS discovery for local network */
  enableMdns: boolean;
  /** DHT discovery */
  enableDht: boolean;
  /** Rendezvous point discovery */
  enableRendezvous: boolean;
  /** Rendezvous namespace */
  rendezvousNamespace: string;
  /** PubSub discovery topics */
  discoveryTopics: string[];
  /** Maximum peers to maintain */
  maxPeers: number;
  /** Minimum peers before seeking more */
  minPeers: number;
  /** Peer discovery interval in ms */
  discoveryIntervalMs: number;
}

export interface TransportConfig {
  /** Enable WebSocket transport */
  enableWebSocket: boolean;
  /** Enable WebRTC transport */
  enableWebRTC: boolean;
  /** Enable TCP transport (Node.js only) */
  enableTcp: boolean;
  /** Enable QUIC transport */
  enableQuic: boolean;
  /** Listen addresses */
  listenAddresses: string[];
  /** Announce addresses (public IPs) */
  announceAddresses: string[];
  /** Enable relay client */
  enableRelayClient: boolean;
  /** Enable relay server */
  enableRelayServer: boolean;
  /** Relay hop limit */
  relayHopLimit: number;
  /** Enable hole punching */
  enableHolePunching: boolean;
  /** Enable UPnP */
  enableUpnp: boolean;
  /** Connection timeout in ms */
  connectionTimeoutMs: number;
}

export interface ConnectionInfo {
  peerId: string;
  remoteAddr: string;
  direction: "inbound" | "outbound";
  status: "open" | "closing" | "closed";
  streams: number;
  latencyMs: number;
  bandwidth: {
    upload: number;
    download: number;
  };
  encryption: string;
  multiplexer: string;
  establishedAt: number;
}

// ============================================================================
// Content Fetching (Weights/Inputs by CID)
// ============================================================================

export interface ContentManifest {
  /** CID of the manifest itself */
  cid: string;
  /** Type of content */
  type: ContentType;
  /** Human readable name */
  name: string;
  /** Description */
  description?: string;
  /** Total size in bytes */
  totalSize: number;
  /** Number of chunks */
  chunkCount: number;
  /** Chunk CIDs in order */
  chunks: ChunkInfo[];
  /** Hash algorithm used */
  hashAlgorithm: "sha256" | "blake3";
  /** Root hash for verification */
  rootHash: string;
  /** Creator peer ID */
  creator: string;
  /** Timestamp created */
  createdAt: number;
  /** Signature from creator */
  signature: string;
  /** Metadata */
  metadata: Record<string, unknown>;
}

export type ContentType =
  | "model-weights"
  | "model-config"
  | "tokenizer"
  | "inference-input"
  | "inference-output"
  | "dataset"
  | "checkpoint"
  | "lora-adapter"
  | "embedding";

export interface ChunkInfo {
  /** CID of chunk */
  cid: string;
  /** Index in sequence */
  index: number;
  /** Size in bytes */
  size: number;
  /** Offset in full content */
  offset: number;
  /** Hash of chunk data */
  hash: string;
}

export interface FetchRequest {
  /** Request ID */
  id: string;
  /** CID to fetch */
  cid: string;
  /** Expected content type */
  expectedType?: ContentType;
  /** Priority (0-10, higher = more urgent) */
  priority: number;
  /** Maximum peers to fetch from */
  maxProviders: number;
  /** Timeout per chunk in ms */
  chunkTimeoutMs: number;
  /** Whether to verify chunks */
  verifyChunks: boolean;
  /** Resume from chunk index */
  resumeFrom?: number;
  /** Destination path (if caching to disk) */
  destinationPath?: string;
  /** Requester info */
  requester: string;
  /** Timestamp */
  requestedAt: number;
}

export interface FetchProgress {
  requestId: string;
  cid: string;
  status: FetchStatus;
  totalChunks: number;
  completedChunks: number;
  totalBytes: number;
  downloadedBytes: number;
  bytesPerSecond: number;
  activeProviders: string[];
  failedProviders: string[];
  estimatedTimeRemaining: number;
  errors: FetchError[];
  startedAt: number;
  completedAt?: number;
}

export type FetchStatus =
  | "pending"
  | "resolving"
  | "downloading"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export interface FetchError {
  chunkIndex?: number;
  provider?: string;
  error: string;
  timestamp: number;
  retryable: boolean;
}

export interface FetchResult {
  requestId: string;
  cid: string;
  success: boolean;
  manifest?: ContentManifest;
  localPath?: string;
  bytesDownloaded: number;
  duration: number;
  providers: string[];
  error?: string;
}

// ============================================================================
// Job Execution
// ============================================================================

export interface InferenceJob {
  /** Unique job ID */
  id: string;
  /** Job type */
  type: JobType;
  /** Model CID or identifier */
  modelCid: string;
  /** Model name for display */
  modelName: string;
  /** Input data CID */
  inputCid: string;
  /** Job parameters */
  params: InferenceParams;
  /** Requester peer ID */
  requester: string;
  /** Assigned executor (if any) */
  executor?: string;
  /** Assigned validators */
  validators: string[];
  /** Job priority */
  priority: number;
  /** Maximum execution time in ms */
  maxExecutionTimeMs: number;
  /** Payment offered (in smallest unit) */
  paymentOffered: bigint;
  /** Required stake from executor */
  requiredStake: bigint;
  /** Number of redundant executions required */
  redundancy: number;
  /** Consensus threshold (0-1) */
  consensusThreshold: number;
  /** Job status */
  status: JobStatus;
  /** When job was created */
  createdAt: number;
  /** When job started executing */
  startedAt?: number;
  /** When job completed */
  completedAt?: number;
  /** Execution results */
  results?: JobResult[];
  /** Final consensus result */
  consensusResult?: ConsensusResult;
}

export type JobType =
  | "text-generation"
  | "text-embedding"
  | "image-generation"
  | "image-embedding"
  | "audio-transcription"
  | "audio-generation"
  | "vision"
  | "multi-modal"
  | "fine-tuning"
  | "custom";

export interface InferenceParams {
  /** For text generation */
  prompt?: string;
  /** System prompt */
  systemPrompt?: string;
  /** Max tokens to generate */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
  /** Top P */
  topP?: number;
  /** Top K */
  topK?: number;
  /** Repetition penalty */
  repetitionPenalty?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Seed for reproducibility */
  seed?: number;
  /** Batch size */
  batchSize?: number;
  /** For embeddings */
  embeddingDimensions?: number;
  /** For images */
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  /** Custom parameters */
  custom?: Record<string, unknown>;
}

export type JobStatus =
  | "pending"
  | "queued"
  | "assigned"
  | "fetching-model"
  | "fetching-input"
  | "executing"
  | "validating"
  | "consensus"
  | "completed"
  | "failed"
  | "cancelled"
  | "disputed";

export interface JobResult {
  /** Job ID */
  jobId: string;
  /** Executor peer ID */
  executor: string;
  /** Output CID */
  outputCid: string;
  /** Output hash for quick comparison */
  outputHash: string;
  /** Execution metrics */
  metrics: ExecutionMetrics;
  /** Execution receipt */
  receipt: ExecutionReceipt;
  /** Timestamp */
  completedAt: number;
}

export interface ExecutionMetrics {
  /** Total execution time in ms */
  executionTimeMs: number;
  /** Model loading time in ms */
  modelLoadTimeMs: number;
  /** Input processing time in ms */
  inputProcessTimeMs: number;
  /** Inference time in ms */
  inferenceTimeMs: number;
  /** Output processing time in ms */
  outputProcessTimeMs: number;
  /** Peak memory usage in MB */
  peakMemoryMb: number;
  /** Peak VRAM usage in MB */
  peakVramMb: number;
  /** Tokens processed (if applicable) */
  tokensProcessed?: number;
  /** Tokens per second */
  tokensPerSecond?: number;
  /** GPU utilization percentage */
  gpuUtilization?: number;
}

export interface ExecutionReceipt {
  /** Receipt ID */
  id: string;
  /** Job ID */
  jobId: string;
  /** Executor peer ID */
  executor: string;
  /** Executor wallet address */
  executorWallet: string;
  /** Input CID */
  inputCid: string;
  /** Output CID */
  outputCid: string;
  /** Model CID */
  modelCid: string;
  /** Output hash (blake3) */
  outputHash: string;
  /** Execution metrics hash */
  metricsHash: string;
  /** Timestamp */
  timestamp: number;
  /** Nonce for uniqueness */
  nonce: string;
  /** Executor signature */
  signature: string;
}

// ============================================================================
// Validation & Consensus
// ============================================================================

export interface ValidationRequest {
  /** Request ID */
  id: string;
  /** Job being validated */
  jobId: string;
  /** Result to validate */
  resultToValidate: JobResult;
  /** Validator peer ID */
  validator: string;
  /** Validation type */
  validationType: ValidationType;
  /** Timeout in ms */
  timeoutMs: number;
  /** Stake amount */
  stakeAmount: bigint;
  /** Requested at */
  requestedAt: number;
}

export type ValidationType =
  | "full-reexecution"
  | "sampling"
  | "hash-verification"
  | "output-comparison"
  | "probabilistic";

export interface ValidationResult {
  /** Request ID */
  requestId: string;
  /** Job ID */
  jobId: string;
  /** Validator peer ID */
  validator: string;
  /** Whether result is valid */
  isValid: boolean;
  /** Confidence score (0-1) */
  confidence: number;
  /** Validation type used */
  validationType: ValidationType;
  /** If re-executed, the validator's output hash */
  validatorOutputHash?: string;
  /** Match score if compared (0-1) */
  matchScore?: number;
  /** Discrepancies found */
  discrepancies?: Discrepancy[];
  /** Validation metrics */
  metrics: {
    validationTimeMs: number;
    resourcesUsed: number;
  };
  /** Validator signature */
  signature: string;
  /** Timestamp */
  completedAt: number;
}

export interface Discrepancy {
  type: "output-mismatch" | "metric-mismatch" | "timing-anomaly" | "signature-invalid";
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence?: unknown;
}

export interface ConsensusResult {
  /** Job ID */
  jobId: string;
  /** Whether consensus was reached */
  consensusReached: boolean;
  /** Final output CID (if consensus) */
  finalOutputCid?: string;
  /** Final output hash */
  finalOutputHash?: string;
  /** Participating executors */
  executors: string[];
  /** Validation results */
  validations: ValidationResult[];
  /** Consensus score (0-1) */
  consensusScore: number;
  /** Majority executor (whose result was accepted) */
  majorityExecutor?: string;
  /** Disputed executors */
  disputedExecutors: string[];
  /** Slashed amounts */
  slashedAmounts: Record<string, bigint>;
  /** Rewards distributed */
  rewardsDistributed: Record<string, bigint>;
  /** Finalized at */
  finalizedAt: number;
  /** Consensus signature (multi-sig or aggregate) */
  consensusSignature: string;
}

// ============================================================================
// Heartbeats & Telemetry
// ============================================================================

export interface Heartbeat {
  /** Peer ID */
  peerId: string;
  /** Sequence number */
  sequence: number;
  /** Timestamp */
  timestamp: number;
  /** Current status */
  status: PeerStatus;
  /** Current capabilities (may change) */
  capabilities: PeerCapabilities;
  /** Active jobs count */
  activeJobs: number;
  /** Queued jobs count */
  queuedJobs: number;
  /** Recent job stats */
  jobStats: JobStats;
  /** System metrics */
  systemMetrics: SystemMetrics;
  /** Network metrics */
  networkMetrics: NetworkMetrics;
  /** Ed25519 signature */
  signature: string;
}

export interface JobStats {
  /** Jobs completed in last hour */
  completedLastHour: number;
  /** Jobs failed in last hour */
  failedLastHour: number;
  /** Average execution time in ms */
  avgExecutionTimeMs: number;
  /** Total tokens processed */
  totalTokensProcessed: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Earnings in last 24h */
  earnings24h: bigint;
}

export interface SystemMetrics {
  /** CPU usage percentage */
  cpuUsage: number;
  /** Memory usage percentage */
  memoryUsage: number;
  /** GPU usage percentage (if available) */
  gpuUsage?: number;
  /** VRAM usage percentage (if available) */
  vramUsage?: number;
  /** Disk usage percentage */
  diskUsage: number;
  /** System temperature (if available) */
  temperature?: number;
  /** Power consumption in watts (if available) */
  powerWatts?: number;
}

export interface NetworkMetrics {
  /** Connected peers count */
  connectedPeers: number;
  /** Inbound connections */
  inboundConnections: number;
  /** Outbound connections */
  outboundConnections: number;
  /** Bytes sent in last minute */
  bytesSentLastMinute: number;
  /** Bytes received in last minute */
  bytesReceivedLastMinute: number;
  /** Average latency to peers in ms */
  avgPeerLatencyMs: number;
  /** DHT queries/responses */
  dhtQueries: number;
  dhtResponses: number;
  /** PubSub messages */
  pubsubMessagesSent: number;
  pubsubMessagesReceived: number;
}

export interface TelemetryReport {
  /** Report ID */
  id: string;
  /** Peer ID */
  peerId: string;
  /** Report period start */
  periodStart: number;
  /** Report period end */
  periodEnd: number;
  /** Aggregated heartbeats */
  heartbeatCount: number;
  /** Uptime during period */
  uptimePercentage: number;
  /** Job statistics */
  jobStats: {
    completed: number;
    failed: number;
    cancelled: number;
    validated: number;
    disputed: number;
  };
  /** Average metrics */
  avgMetrics: {
    cpuUsage: number;
    memoryUsage: number;
    gpuUsage?: number;
    networkBandwidth: number;
  };
  /** Reputation changes */
  reputationChange: number;
  /** Earnings */
  earnings: bigint;
  /** Slashed amount */
  slashed: bigint;
  /** Signature */
  signature: string;
}

// ============================================================================
// Network Events
// ============================================================================

export type ComputeNetworkEvent =
  | { type: "peer:discovered"; peer: PeerInfo }
  | { type: "peer:connected"; peerId: string; connection: ConnectionInfo }
  | { type: "peer:disconnected"; peerId: string; reason?: string }
  | { type: "peer:updated"; peer: PeerInfo }
  | { type: "heartbeat:received"; heartbeat: Heartbeat }
  | { type: "job:created"; job: InferenceJob }
  | { type: "job:assigned"; jobId: string; executor: string }
  | { type: "job:started"; jobId: string }
  | { type: "job:progress"; jobId: string; progress: number }
  | { type: "job:completed"; jobId: string; result: JobResult }
  | { type: "job:failed"; jobId: string; error: string }
  | { type: "validation:requested"; request: ValidationRequest }
  | { type: "validation:completed"; result: ValidationResult }
  | { type: "consensus:reached"; result: ConsensusResult }
  | { type: "consensus:failed"; jobId: string; reason: string }
  | { type: "content:fetching"; request: FetchRequest }
  | { type: "content:progress"; progress: FetchProgress }
  | { type: "content:fetched"; result: FetchResult }
  | { type: "content:failed"; requestId: string; error: string }
  | { type: "network:status"; status: NetworkStatus }
  | { type: "error"; error: string; context?: unknown };

export interface NetworkStatus {
  /** Whether network is initialized */
  initialized: boolean;
  /** Local peer info */
  localPeer?: PeerInfo;
  /** Connected peers count */
  connectedPeers: number;
  /** Known peers count */
  knownPeers: number;
  /** Active jobs count */
  activeJobs: number;
  /** Pending jobs count */
  pendingJobs: number;
  /** Content being fetched */
  activeFetches: number;
  /** Helia status */
  heliaStatus: "starting" | "ready" | "stopped" | "error";
  /** libp2p status */
  libp2pStatus: "starting" | "started" | "stopped" | "error";
  /** NAT status */
  natStatus: NatType;
  /** Whether acting as relay */
  isRelay: boolean;
  /** DHT mode */
  dhtMode: "client" | "server" | "disabled";
  /** Bootstrap status */
  bootstrapped: boolean;
  /** Uptime in seconds */
  uptime: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface ComputeNetworkConfig {
  /** Enable the compute network */
  enabled: boolean;
  /** Peer identity config */
  identity: {
    walletAddress: string;
    displayName?: string;
  };
  /** Discovery configuration */
  discovery: DiscoveryConfig;
  /** Transport configuration */
  transport: TransportConfig;
  /** Job execution config */
  execution: {
    /** Maximum concurrent jobs */
    maxConcurrentJobs: number;
    /** Accept jobs automatically */
    autoAcceptJobs: boolean;
    /** Minimum payment per token */
    minPaymentPerToken: bigint;
    /** Models to pre-load */
    preloadModels: string[];
    /** Execution timeout default */
    defaultTimeoutMs: number;
  };
  /** Validation config */
  validation: {
    /** Enable validator role */
    enableValidator: boolean;
    /** Stake amount for validation */
    validatorStake: bigint;
    /** Validation types to support */
    supportedValidationTypes: ValidationType[];
    /** Maximum concurrent validations */
    maxConcurrentValidations: number;
  };
  /** Heartbeat config */
  heartbeat: {
    /** Interval between heartbeats in ms */
    intervalMs: number;
    /** Timeout for peer heartbeats */
    timeoutMs: number;
    /** Enable signed telemetry */
    signTelemetry: boolean;
  };
  /** Content config */
  content: {
    /** Cache directory for content */
    cacheDir: string;
    /** Maximum cache size in MB */
    maxCacheSizeMb: number;
    /** Pin fetched content */
    pinFetchedContent: boolean;
    /** Provide content to network */
    provideContent: boolean;
  };
}

export const DEFAULT_COMPUTE_NETWORK_CONFIG: ComputeNetworkConfig = {
  enabled: false,
  identity: {
    walletAddress: "",
  },
  discovery: {
    bootstrapPeers: [
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
    ],
    enableMdns: true,
    enableDht: true,
    enableRendezvous: true,
    rendezvousNamespace: "joycreate-compute-v1",
    discoveryTopics: ["/joycreate/compute/discovery/1.0.0"],
    maxPeers: 50,
    minPeers: 5,
    discoveryIntervalMs: 30000,
  },
  transport: {
    enableWebSocket: true,
    enableWebRTC: true,
    enableTcp: true,
    enableQuic: false,
    listenAddresses: ["/ip4/0.0.0.0/tcp/0", "/ip4/0.0.0.0/tcp/0/ws"],
    announceAddresses: [],
    enableRelayClient: true,
    enableRelayServer: false,
    relayHopLimit: 2,
    enableHolePunching: true,
    enableUpnp: true,
    connectionTimeoutMs: 30000,
  },
  execution: {
    maxConcurrentJobs: 2,
    autoAcceptJobs: false,
    minPaymentPerToken: BigInt(0),
    preloadModels: [],
    defaultTimeoutMs: 300000,
  },
  validation: {
    enableValidator: false,
    validatorStake: BigInt(0),
    supportedValidationTypes: ["hash-verification", "sampling"],
    maxConcurrentValidations: 5,
  },
  heartbeat: {
    intervalMs: 30000,
    timeoutMs: 90000,
    signTelemetry: true,
  },
  content: {
    cacheDir: "",
    maxCacheSizeMb: 10240,
    pinFetchedContent: true,
    provideContent: true,
  },
};
