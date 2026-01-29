/**
 * Privacy-Preserving Inference Bridge
 * 
 * Connects local Model Factory & Agent Factory to the federated JoyMarketplace
 * for decentralized inference without data harvesting.
 * 
 * Key principles:
 * - LOCAL FIRST: Always prefer local models and trained adapters
 * - PRIVACY BY DEFAULT: No data leaves the device unless explicitly allowed
 * - FEDERATED FALLBACK: Route to peer network only when needed
 * - VERIFIABLE: All inference is cryptographically attested via IPLD receipts
 * - NO HARVESTING: Prompts are hashed, never sent in plaintext to untrusted parties
 */

import type {
  FederatedInferenceRequest,
  FederatedInferenceRoute,
  FederatedInferenceExecutionRequest,
  FederatedInferenceExecutionResult,
  Peer,
  PeerCapability,
  ModelChunkAnnouncement,
} from "./federation_types";

import type {
  TrainingJobId,
  AdapterId,
  TrainingMethod,
} from "./model_factory_types";

import type {
  CustomAgentId,
  AgentType,
  AgentCapability,
} from "./agent_factory_types";

// =============================================================================
// BRANDED TYPES
// =============================================================================

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type InferenceRequestId = Brand<string, "InferenceRequestId">;
export type ProofCid = Brand<string, "ProofCid">;
export type PromptHash = Brand<string, "PromptHash">;
export type DataHash = Brand<string, "DataHash">;

// =============================================================================
// PRIVACY LEVELS
// =============================================================================

export type PrivacyLevel =
  | "local_only"      // Never leaves the device, no network at all
  | "local_preferred" // Prefer local, fallback to trusted peers only
  | "federated"       // Can use JoyMarketplace peers (encrypted)
  | "hybrid"          // Can mix local and federated for speed
  | "any";            // No restrictions (NOT RECOMMENDED)

export type DataHandling =
  | "never_share"     // Prompts/data never leave the device
  | "hash_only"       // Only cryptographic hashes are shared
  | "encrypted"       // End-to-end encrypted to peer
  | "attestation"     // Share for attestation/verification only
  | "full";           // Full data sharing (only to self-hosted nodes)

// =============================================================================
// INFERENCE REQUEST
// =============================================================================

export interface PrivacyPreservingInferenceRequest {
  id: InferenceRequestId;
  
  // What to run
  type: "completion" | "chat" | "embedding" | "agent_task";
  
  // Model selection (local first)
  modelConfig: InferenceModelConfig;
  
  // Privacy settings
  privacy: InferencePrivacyConfig;
  
  // The actual request (kept local unless privacy allows)
  payload: InferencePayload;
  
  // Routing preferences
  routing: InferenceRoutingConfig;
  
  // Verification
  verification: InferenceVerificationConfig;
  
  // Metadata (never sent externally)
  metadata?: Record<string, unknown>;
  
  createdAt: number;
}

export interface InferenceModelConfig {
  // Local model preference
  preferLocal: boolean;
  
  // Specific model requests
  modelId?: string;           // Specific model ID
  adapterId?: AdapterId;      // Use trained LoRA adapter
  agentId?: CustomAgentId;    // Use custom agent
  
  // Capabilities required
  requiredCapabilities?: AgentCapability[];
  
  // Minimum quality thresholds
  minContextLength?: number;
  minReasoningScore?: number;
  minCodingScore?: number;
  
  // Quantization acceptable
  acceptQuantized?: boolean;
  minQuantBits?: 4 | 8 | 16 | 32;
  
  // Fallback chain
  fallbackModels?: string[];
}

export interface InferencePrivacyConfig {
  level: PrivacyLevel;
  dataHandling: DataHandling;
  
  // What can be shared
  allowPromptHashing: boolean;      // Allow SHA256 hash of prompt
  allowResponseHashing: boolean;    // Allow hash of response for verification
  allowMetricSharing: boolean;      // Allow anonymous timing/token metrics
  allowModelIdSharing: boolean;     // Allow sharing which model was used
  
  // Where data can go
  trustedPeers?: string[];          // DIDs of trusted peers
  blockedPeers?: string[];          // DIDs to never use
  trustedRegions?: string[];        // Geographic restrictions
  blockedRegions?: string[];
  
  // Encryption
  encryptInTransit: boolean;
  encryptAtRest: boolean;
  keyRotationEnabled: boolean;
}

export interface InferencePayload {
  // For completion/chat
  prompt?: string;
  systemPrompt?: string;
  messages?: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    toolCalls?: unknown[];
    toolCallId?: string;
  }>;
  
  // For embeddings
  texts?: string[];
  
  // For agent tasks
  agentTask?: {
    taskType: string;
    input: unknown;
    context?: unknown;
    tools?: string[];
  };
  
  // Generation config
  config?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    stream?: boolean;
    seed?: number;
  };
}

export interface InferenceRoutingConfig {
  // Preference order
  preferenceOrder: ("local" | "adapter" | "agent" | "peer" | "cloud")[];
  
  // Cost limits
  maxCostCents?: number;
  
  // Latency requirements
  maxLatencyMs?: number;
  
  // Load balancing
  loadBalancing: "fastest" | "cheapest" | "most_private" | "round_robin";
  
  // Retry policy
  maxRetries: number;
  retryDelayMs: number;
  
  // Peer selection for federated
  peerSelection?: {
    minReputation?: number;
    minUptime?: number;
    preferredCapabilities?: PeerCapability[];
    maxPeers?: number;
  };
}

export interface InferenceVerificationConfig {
  // Create IPLD receipt
  createReceipt: boolean;
  
  // Receipt content
  includePromptHash: boolean;
  includeResponseHash: boolean;
  includeTimings: boolean;
  includeModelInfo: boolean;
  
  // Attestation
  signReceipt: boolean;
  requirePeerSignature: boolean;
  
  // Storage
  pinReceipt: boolean;
  receiptTtlDays?: number;
}

// =============================================================================
// INFERENCE RESPONSE
// =============================================================================

export interface PrivacyPreservingInferenceResponse {
  id: InferenceRequestId;
  
  // Execution info
  executedBy: InferenceExecutor;
  
  // Result
  result: InferenceResult;
  
  // Privacy audit
  privacyAudit: PrivacyAudit;
  
  // Verification
  verification?: InferenceVerification;
  
  // Metrics (if allowed by privacy config)
  metrics?: InferenceMetrics;
  
  completedAt: number;
}

export interface InferenceExecutor {
  type: "local" | "adapter" | "agent" | "peer" | "cloud";
  
  // For local
  modelId?: string;
  modelPath?: string;
  
  // For adapter
  adapterId?: AdapterId;
  baseModelId?: string;
  
  // For agent
  agentId?: CustomAgentId;
  agentName?: string;
  
  // For peer
  peerId?: string;
  peerDid?: string;
  peerName?: string;
  
  // For cloud (NOT RECOMMENDED)
  cloudProvider?: string;
  cloudModel?: string;
}

export interface InferenceResult {
  success: boolean;
  
  // For completion/chat
  content?: string;
  
  // For streaming
  chunks?: string[];
  
  // For embeddings
  embeddings?: number[][];
  
  // For agent tasks
  agentOutput?: {
    result: unknown;
    reasoning?: string;
    toolCalls?: unknown[];
  };
  
  // Error info
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
  
  // Token usage
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface PrivacyAudit {
  // What was shared
  promptShared: boolean;
  promptHashShared: boolean;
  responseShared: boolean;
  responseHashShared: boolean;
  metricsShared: boolean;
  
  // Where it went
  destinations: Array<{
    type: "local" | "peer" | "cloud";
    identifier?: string;
    dataTypes: string[];
  }>;
  
  // Encryption
  encryptionUsed: boolean;
  encryptionAlgorithm?: string;
  
  // Compliance
  compliantWithConfig: boolean;
  violations?: string[];
}

export interface InferenceVerification {
  // IPLD receipt
  receiptCid?: ProofCid;
  receiptCreatedAt?: number;
  
  // Hashes
  promptHash?: PromptHash;
  responseHash?: string;
  
  // Signatures
  localSignature?: string;
  peerSignature?: string;
  
  // Attestation chain
  attestationChain?: Array<{
    signer: string;
    signature: string;
    timestamp: number;
  }>;
}

export interface InferenceMetrics {
  // Timing
  totalMs: number;
  routingMs: number;
  executionMs: number;
  networkMs?: number;
  
  // Tokens
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  
  // Cost
  estimatedCostCents?: number;
  
  // Resource usage
  gpuMemoryUsedMb?: number;
  cpuUsagePercent?: number;
}

// =============================================================================
// INFERENCE BRIDGE STATE
// =============================================================================

export interface InferenceBridgeState {
  // Status
  initialized: boolean;
  
  // Local models
  localModels: LocalModelInfo[];
  loadedModels: string[];
  
  // Adapters (trained via Model Factory)
  adapters: AdapterInfo[];
  loadedAdapters: string[];
  
  // Agents (created via Agent Factory)
  agents: AgentInfo[];
  activeAgents: string[];
  
  // Peer network
  connectedPeers: number;
  trustedPeers: string[];
  availableCapacity: number;
  
  // Stats
  stats: InferenceBridgeStats;
}

export interface LocalModelInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  quantization?: string;
  loaded: boolean;
  capabilities: string[];
}

export interface AdapterInfo {
  id: AdapterId;
  name: string;
  baseModelId: string;
  method: TrainingMethod;
  path: string;
  loaded: boolean;
}

export interface AgentInfo {
  id: CustomAgentId;
  name: string;
  type: AgentType;
  modelId: string;
  adapterId?: AdapterId;
  active: boolean;
}

export interface InferenceBridgeStats {
  // Request counts
  totalRequests: number;
  localRequests: number;
  adapterRequests: number;
  agentRequests: number;
  peerRequests: number;
  cloudRequests: number;
  
  // Privacy
  promptsKeptLocal: number;
  promptsHashed: number;
  promptsEncrypted: number;
  
  // Performance
  avgLatencyMs: number;
  avgTokensPerSecond: number;
  
  // Cost savings
  estimatedCloudCostCents: number;
  actualCostCents: number;
  costSavingsCents: number;
  
  // Verification
  receiptsCreated: number;
  receiptsPinned: number;
}

// =============================================================================
// BRIDGE CONFIGURATION
// =============================================================================

export interface InferenceBridgeConfig {
  // Default privacy
  defaultPrivacy: InferencePrivacyConfig;
  
  // Model loading
  autoLoadModels: boolean;
  maxLoadedModels: number;
  modelCacheSizeMb: number;
  
  // Adapter loading
  autoLoadAdapters: boolean;
  maxLoadedAdapters: number;
  
  // Peer network
  enableFederation: boolean;
  maxPeerConnections: number;
  peerTimeoutMs: number;
  
  // Routing
  defaultRouting: InferenceRoutingConfig;
  
  // Verification
  defaultVerification: InferenceVerificationConfig;
  
  // Performance
  batchingEnabled: boolean;
  maxBatchSize: number;
  batchTimeoutMs: number;
}

// =============================================================================
// EVENTS
// =============================================================================

export type InferenceBridgeEvent =
  | { type: "model_loaded"; modelId: string }
  | { type: "model_unloaded"; modelId: string }
  | { type: "adapter_loaded"; adapterId: AdapterId }
  | { type: "adapter_unloaded"; adapterId: AdapterId }
  | { type: "agent_activated"; agentId: CustomAgentId }
  | { type: "agent_deactivated"; agentId: CustomAgentId }
  | { type: "peer_connected"; peerId: string }
  | { type: "peer_disconnected"; peerId: string }
  | { type: "inference_started"; requestId: InferenceRequestId; executor: string }
  | { type: "inference_progress"; requestId: InferenceRequestId; progress: number }
  | { type: "inference_completed"; requestId: InferenceRequestId; success: boolean }
  | { type: "privacy_violation"; requestId: InferenceRequestId; violation: string }
  | { type: "receipt_created"; requestId: InferenceRequestId; receiptCid: ProofCid };

// =============================================================================
// API TYPES
// =============================================================================

export interface CreateInferenceRequest {
  type: "completion" | "chat" | "embedding" | "agent_task";
  payload: InferencePayload;
  modelConfig?: Partial<InferenceModelConfig>;
  privacy?: Partial<InferencePrivacyConfig>;
  routing?: Partial<InferenceRoutingConfig>;
  verification?: Partial<InferenceVerificationConfig>;
}

export interface InferenceStreamChunk {
  requestId: InferenceRequestId;
  chunk: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// =============================================================================
// PRESET PRIVACY PROFILES
// =============================================================================

export const PRIVACY_PROFILES = {
  /** Maximum privacy - never leaves device */
  MAXIMUM: {
    level: "local_only" as PrivacyLevel,
    dataHandling: "never_share" as DataHandling,
    allowPromptHashing: false,
    allowResponseHashing: false,
    allowMetricSharing: false,
    allowModelIdSharing: false,
    encryptInTransit: true,
    encryptAtRest: true,
    keyRotationEnabled: true,
  },
  
  /** High privacy - local with verification */
  HIGH: {
    level: "local_preferred" as PrivacyLevel,
    dataHandling: "hash_only" as DataHandling,
    allowPromptHashing: true,
    allowResponseHashing: true,
    allowMetricSharing: false,
    allowModelIdSharing: false,
    encryptInTransit: true,
    encryptAtRest: true,
    keyRotationEnabled: true,
  },
  
  /** Standard - federated with encryption */
  STANDARD: {
    level: "federated" as PrivacyLevel,
    dataHandling: "encrypted" as DataHandling,
    allowPromptHashing: true,
    allowResponseHashing: true,
    allowMetricSharing: true,
    allowModelIdSharing: true,
    encryptInTransit: true,
    encryptAtRest: true,
    keyRotationEnabled: true,
  },
  
  /** Balanced - hybrid for performance */
  BALANCED: {
    level: "hybrid" as PrivacyLevel,
    dataHandling: "encrypted" as DataHandling,
    allowPromptHashing: true,
    allowResponseHashing: true,
    allowMetricSharing: true,
    allowModelIdSharing: true,
    encryptInTransit: true,
    encryptAtRest: false,
    keyRotationEnabled: false,
  },
} as const;

// =============================================================================
// PRESET ROUTING PROFILES
// =============================================================================

export const ROUTING_PROFILES = {
  /** Always local - never use network */
  LOCAL_ONLY: {
    preferenceOrder: ["local", "adapter", "agent"] as const,
    loadBalancing: "fastest" as const,
    maxRetries: 3,
    retryDelayMs: 100,
  },
  
  /** Privacy focused - local first, trusted peers only */
  PRIVACY_FIRST: {
    preferenceOrder: ["local", "adapter", "agent", "peer"] as const,
    loadBalancing: "most_private" as const,
    maxRetries: 2,
    retryDelayMs: 500,
    peerSelection: {
      minReputation: 90,
      minUptime: 95,
    },
  },
  
  /** Performance - fastest response */
  PERFORMANCE: {
    preferenceOrder: ["local", "adapter", "peer", "agent"] as const,
    loadBalancing: "fastest" as const,
    maxLatencyMs: 5000,
    maxRetries: 3,
    retryDelayMs: 100,
  },
  
  /** Cost optimized - cheapest option */
  COST_OPTIMIZED: {
    preferenceOrder: ["local", "adapter", "agent", "peer"] as const,
    loadBalancing: "cheapest" as const,
    maxCostCents: 10,
    maxRetries: 2,
    retryDelayMs: 500,
  },
} as const;
