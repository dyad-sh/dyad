/**
 * Trustless Inference Types
 * Types for verifiable, content-addressed AI inference
 */

// ============================================================================
// Local Model Provider Types
// ============================================================================

export type LocalModelProvider = "ollama" | "lmstudio" | "llamacpp" | "vllm";

export interface LocalModelInfo {
  id: string;
  name: string;
  provider: LocalModelProvider;
  modelFile?: string;
  modelHash?: string; // SHA-256 of model weights
  size?: number;
  quantization?: string;
  family?: string;
  parameters?: string;
  contextLength?: number;
  modifiedAt?: string;
  digest?: string; // Ollama digest
}

export interface LocalModelConfig {
  provider: LocalModelProvider;
  baseUrl: string;
  modelId: string;
  options?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    repeatPenalty?: number;
    seed?: number;
    numPredict?: number;
    numCtx?: number;
    stop?: string[];
  };
}

// ============================================================================
// Inference Request/Response Types
// ============================================================================

export interface InferenceRequest {
  id: string;
  modelConfig: LocalModelConfig;
  prompt: string;
  systemPrompt?: string;
  messages?: InferenceMessage[];
  timestamp: number;
  requestHash?: string;
}

export interface InferenceMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface InferenceResponse {
  id: string;
  requestId: string;
  modelInfo: LocalModelInfo;
  output: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  generationTimeMs: number;
  timestamp: number;
  finishReason: "stop" | "length" | "error";
}

// ============================================================================
// Trustless Verification Types (Helia/IPFS)
// ============================================================================

export interface InferenceProof {
  version: "1.0.0";
  proofType: "inference-verification";
  
  // Content identifiers (CIDs)
  requestCid: string;
  responseCid: string;
  proofCid?: string;
  
  // Model verification
  model: {
    id: string;
    name: string;
    provider: LocalModelProvider;
    weightsHash?: string; // SHA-256 of model file
    configHash?: string;  // SHA-256 of model config
    quantization?: string;
  };
  
  // Request fingerprint
  request: {
    promptHash: string;       // SHA-256 of prompt
    systemPromptHash?: string;
    messagesHash?: string;    // SHA-256 of conversation
    configHash: string;       // SHA-256 of generation config
  };
  
  // Response fingerprint
  response: {
    outputHash: string;       // SHA-256 of output
    tokenCount: number;
    generationTimeMs: number;
  };
  
  // Temporal data
  timestamps: {
    requested: number;
    started: number;
    completed: number;
  };
  
  // Node identity
  node: {
    peerId?: string;
    publicKey?: string;
  };
  
  // Signatures
  signature?: string;
  
  // Merkle proof for batch verification
  merkleRoot?: string;
  merkleProof?: string[];
}

export interface InferenceRecord {
  id: string;
  proof: InferenceProof;
  request: InferenceRequest;
  response: InferenceResponse;
  cid: string;
  pinned: boolean;
  verified: boolean;
  createdAt: number;
}

// ============================================================================
// Verification Result Types
// ============================================================================

export interface VerificationResult {
  valid: boolean;
  checks: {
    requestIntegrity: boolean;
    responseIntegrity: boolean;
    modelMatch: boolean;
    timestampValid: boolean;
    signatureValid?: boolean;
  };
  details: string[];
  warnings: string[];
}

export interface BatchVerificationResult {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  merkleRootValid: boolean;
  results: Array<{
    recordId: string;
    valid: boolean;
    errors?: string[];
  }>;
}

// ============================================================================
// Helia Node Types
// ============================================================================

export interface HeliaNodeConfig {
  enablePersistence: boolean;
  storagePath?: string;
  bootstrapPeers?: string[];
  announceAddresses?: string[];
}

export interface HeliaNodeStatus {
  running: boolean;
  peerId?: string;
  multiaddrs?: string[];
  connectedPeers: number;
  storedCids: number;
  storageUsedBytes: number;
}

// ============================================================================
// Model Registry Types (Decentralized)
// ============================================================================

export interface ModelRegistryEntry {
  modelId: string;
  name: string;
  version: string;
  provider: LocalModelProvider;
  
  // Verification data
  weightsHash: string;
  configCid: string;
  
  // Metadata
  description?: string;
  author?: string;
  license?: string;
  tags?: string[];
  
  // Performance benchmarks
  benchmarks?: {
    name: string;
    score: number;
    date: string;
  }[];
  
  // Registry metadata
  registeredAt: number;
  registeredBy: string;
  signature: string;
}

export interface ModelVerificationRequest {
  modelId: string;
  expectedWeightsHash: string;
  localModelPath?: string;
}

export interface ModelVerificationResult {
  modelId: string;
  verified: boolean;
  weightsMatch: boolean;
  registryEntry?: ModelRegistryEntry;
  localHash?: string;
  expectedHash?: string;
  error?: string;
}

// ============================================================================
// Inference Attestation Types
// ============================================================================

export interface InferenceAttestation {
  id: string;
  proofCid: string;
  attestationType: "self" | "peer" | "consensus";
  
  // Attestor info
  attestor: {
    peerId: string;
    publicKey: string;
  };
  
  // What's being attested
  claims: {
    modelUsed: string;
    outputGenerated: string;
    timestampAccurate: boolean;
  };
  
  // Cryptographic proof
  signature: string;
  timestamp: number;
}

// ============================================================================
// Consensus Types (for multi-node verification)
// ============================================================================

export interface ConsensusRequest {
  proofCid: string;
  requiredAttestations: number;
  timeout: number;
}

export interface ConsensusResult {
  proofCid: string;
  achieved: boolean;
  attestations: InferenceAttestation[];
  attestationCount: number;
  requiredCount: number;
  consensusTimestamp?: number;
}

// ============================================================================
// API Types
// ============================================================================

export interface TrustlessInferenceConfig {
  enableVerification: boolean;
  enablePinning: boolean;
  autoPublish: boolean;
  requireModelVerification: boolean;
  consensusThreshold?: number;
}

export interface InferenceStats {
  totalInferences: number;
  verifiedInferences: number;
  pinnedRecords: number;
  storageUsedBytes: number;
  modelUsage: Record<string, number>;
  averageGenerationTimeMs: number;
}
