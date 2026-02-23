/**
 * Sovereign Stack Types
 * Complete type definitions for self-hosted, decentralized development platform.
 * No third-party dependencies - own your entire stack.
 */

// =============================================================================
// BRANDED TYPES
// =============================================================================

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type ModelId = Brand<string, "ModelId">;
export type CollectionId = Brand<string, "CollectionId">;
export type EmbeddingId = Brand<string, "EmbeddingId">;
export type ContractId = Brand<string, "ContractId">;
export type PipelineId = Brand<string, "PipelineId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type PaymentId = Brand<string, "PaymentId">;
export type AnalyticsId = Brand<string, "AnalyticsId">;
export type ComponentId = Brand<string, "ComponentId">;
export type FineTuneJobId = Brand<string, "FineTuneJobId">;
export type MediaJobId = Brand<string, "MediaJobId">;

// =============================================================================
// LOCAL MODEL MANAGER
// =============================================================================

export type ModelBackend = "ollama" | "llama.cpp" | "vllm" | "transformers" | "onnx" | "mlx";
export type ModelFormat = "gguf" | "safetensors" | "pytorch" | "onnx" | "mlx";
export type ModelSize = "tiny" | "small" | "medium" | "large" | "xl";
export type QuantizationType = "q4_0" | "q4_1" | "q5_0" | "q5_1" | "q8_0" | "f16" | "f32";

export interface LocalModel {
  id: ModelId;
  name: string;
  family: string;
  version: string;
  backend: ModelBackend;
  format: ModelFormat;
  size: ModelSize;
  quantization?: QuantizationType;
  
  // Paths
  path: string;
  configPath?: string;
  tokenizerPath?: string;
  
  // Specs
  parameters: number;
  contextLength: number;
  embeddingDimension?: number;
  vocabSize: number;
  
  // Capabilities
  capabilities: ModelCapabilities;
  
  // Status
  downloaded: boolean;
  downloadProgress?: number;
  loaded: boolean;
  gpuLayers?: number;
  
  // Metadata
  license: string;
  author: string;
  source: string;
  sha256?: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface ModelCapabilities {
  textGeneration: boolean;
  chat: boolean;
  embedding: boolean;
  codeGeneration: boolean;
  functionCalling: boolean;
  vision: boolean;
  audio: boolean;
  multimodal: boolean;
}

export interface ModelDownloadRequest {
  source: "huggingface" | "ollama" | "url" | "local";
  modelId: string;
  variant?: string;
  quantization?: QuantizationType;
  targetBackend: ModelBackend;
}

export interface ModelLoadConfig {
  modelId: ModelId;
  gpuLayers?: number;
  contextSize?: number;
  batchSize?: number;
  threads?: number;
  memoryLimit?: number;
  flashAttention?: boolean;
  continuousBatching?: boolean;
}

export interface InferenceRequest {
  modelId: ModelId;
  prompt: string;
  systemPrompt?: string;
  messages?: ChatMessage[];
  images?: string[];
  
  // Generation params
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  stopSequences?: string[];
  
  // Streaming
  stream?: boolean;
  
  // Function calling
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  images?: string[];
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface InferenceResponse {
  id: string;
  modelId: ModelId;
  content: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "length" | "tool_calls" | "error";
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timing: {
    promptEvalMs: number;
    evalMs: number;
    totalMs: number;
    tokensPerSecond: number;
  };
}

// =============================================================================
// VECTOR STORE SERVICE
// =============================================================================

export type VectorBackend = "sqlite-vss" | "sqlite-vec" | "faiss" | "annoy" | "hnswlib" | "chromadb-local";
export type DistanceMetric = "cosine" | "euclidean" | "dot_product" | "dot" | "manhattan";

export interface VectorCollection {
  id: CollectionId;
  name: string;
  description?: string;
  backend: VectorBackend;
  
  // Embedding config
  embeddingModel: ModelId | "builtin";
  dimension: number;
  distanceMetric: DistanceMetric;
  
  // Index config
  indexType: "flat" | "ivf" | "hnsw" | "pq";
  indexParams?: Record<string, unknown>;
  
  // Stats
  documentCount: number;
  chunkCount: number;
  totalSize: number;
  vectorCount?: number;
  
  // Chunking config
  chunkingConfig?: ChunkingConfig;
  
  // Metadata
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface VectorDocument {
  id: string;
  collectionId: CollectionId;
  content: string;
  title?: string;
  metadata?: Record<string, unknown>;
  chunkCount?: number;
  
  // Source info
  source?: string | {
    type: "file" | "url" | "text" | "api";
    path?: string;
    url?: string;
  };
  
  // Chunking
  chunks?: VectorChunk[];
  chunkingStrategy?: ChunkingStrategy;
  
  createdAt: number;
  updatedAt: number;
}

export interface VectorChunk {
  id: string;
  documentId: string;
  content: string;
  embedding?: number[];
  
  // Position
  startOffset: number;
  endOffset: number;
  chunkIndex: number;
  
  // Metadata
  metadata?: Record<string, unknown>;
}

export interface ChunkingStrategy {
  type: "fixed" | "sentence" | "paragraph" | "semantic" | "recursive";
  chunkSize: number;
  chunkOverlap: number;
  separators?: string[];
}

export interface VectorSearchRequest {
  collectionId: CollectionId;
  query: string;
  queryEmbedding?: number[];
  topK: number;
  
  // Filtering
  filter?: Record<string, unknown>;
  minScore?: number;
  threshold?: number;
  
  // Options
  includeMetadata?: boolean;
  includeEmbeddings?: boolean;
  rerank?: boolean;
  rerankModel?: ModelId;
}

export interface VectorSearchResult {
  id: string;
  documentId: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  source?: string;
}

export interface RAGRequest {
  collectionIds: CollectionId[];
  collectionId?: CollectionId;
  query: string;
  modelId: ModelId;
  
  // Retrieval
  topK?: number;
  minScore?: number;
  threshold?: number;
  filter?: Record<string, unknown>;
  rerank?: boolean;
  
  // Generation
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  
  // Context
  includeContext?: boolean;
  contextTemplate?: string;
}

export interface RAGResponse {
  answer: string;
  sources: VectorSearchResult[];
  modelResponse: InferenceResponse;
  citations?: {
    documentId: string;
    chunkId: string;
    content: string;
    score: number;
    source?: string;
  }[];
}

// =============================================================================
// VISUAL APP BUILDER
// =============================================================================

export type ComponentType = 
  | "layout" | "container" | "grid" | "flex" | "stack"
  | "row" | "column"
  | "text" | "heading" | "paragraph" | "link" | "code"
  | "button" | "input" | "textarea" | "select" | "checkbox" | "radio" | "switch" | "slider"
  | "form" | "table" | "list" | "card" | "modal" | "drawer" | "tabs" | "accordion"
  | "image" | "video" | "audio" | "file" | "icon"
  | "badge" | "avatar" | "divider" | "progress" | "spinner"
  | "chart" | "graph" | "map"
  | "custom" | "agent" | "workflow";

export interface AppComponent {
  id: ComponentId;
  type: ComponentType;
  name: string;
  
  // Props
  props: Record<string, unknown>;
  
  // Children
  children?: ComponentId[];
  parentId?: ComponentId;
  
  // Styling
  styles: ComponentStyles;
  responsive?: ResponsiveStyles;
  
  // Behavior
  events?: ComponentEvent[];
  bindings?: DataBinding[];
  conditions?: ConditionalRender[];
  
  // Position (for canvas mode)
  position?: { x: number; y: number; width: number; height: number };
}

export interface ComponentStyles {
  // Layout
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  padding?: string;
  margin?: string;
  
  // Sizing
  width?: string;
  height?: string;
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  
  // Appearance
  backgroundColor?: string;
  color?: string;
  borderRadius?: string;
  border?: string;
  borderTop?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderRight?: string;
  boxShadow?: string;
  opacity?: string;
  
  // Typography
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  textAlign?: string;
  lineHeight?: string;
  textDecoration?: string;
  
  // Positioning
  overflow?: string;
  cursor?: string;
  borderCollapse?: string;
  
  // Custom - allows any CSS property
  [key: string]: string | Record<string, string> | undefined;
}

export interface ResponsiveStyles {
  sm?: Partial<ComponentStyles>;
  md?: Partial<ComponentStyles>;
  lg?: Partial<ComponentStyles>;
  xl?: Partial<ComponentStyles>;
}

export interface ComponentEvent {
  trigger: "click" | "change" | "submit" | "focus" | "blur" | "hover" | "load" | "custom";
  action: EventAction;
}

export type EventAction = 
  | { type: "navigate"; path: string }
  | { type: "setVariable"; variable: string; value: unknown }
  | { type: "callApi"; endpoint: string; method: string; body?: unknown }
  | { type: "runWorkflow"; workflowId: string; inputs?: Record<string, unknown> }
  | { type: "runAgent"; agentId: string; message: string }
  | { type: "showModal"; modalId: ComponentId }
  | { type: "hideModal"; modalId: ComponentId }
  | { type: "custom"; code: string };

export interface DataBinding {
  property: string;
  source: "variable" | "api" | "store" | "query" | "computed";
  path: string;
  transform?: string;
}

export interface ConditionalRender {
  condition: string;
  showWhen: boolean;
}

export interface AppProject {
  id: string;
  name: string;
  description?: string;
  version?: string;
  
  // Pages
  pages: AppPage[];
  
  // Global
  globalStyles: string | {
    fontFamily?: string;
    colors?: Record<string, string>;
    spacing?: Record<string, string>;
  };
  globalVariables: Record<string, unknown>;
  
  // Data
  apiEndpoints: ApiEndpoint[];
  dataStores: DataStore[];
  
  // Integrations
  agents: string[];
  workflows: string[];
  
  // Build
  framework: "react" | "vue" | "svelte" | "html";
  buildConfig: BuildConfig;
  
  // Metadata
  createdAt: number;
  updatedAt: number;
}

export interface AppPage {
  id: string;
  name: string;
  path: string;
  components: AppComponent[];
  variables: Record<string, unknown>;
  onLoad?: EventAction[];
  metadata?: Record<string, unknown>;
  updatedAt?: number;
}

export interface ApiEndpoint {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  auth?: {
    type: "none" | "bearer" | "basic" | "api_key";
    config: Record<string, string>;
  };
}

export interface DataStore {
  id: string;
  name: string;
  type: "local" | "indexed_db" | "sqlite" | "external";
  schema?: Record<string, unknown>;
  initialData?: unknown;
}

export interface BuildConfig {
  outputDir: string;
  minify: boolean;
  sourceMaps: boolean;
  ssr: boolean;
  pwa: boolean;
  target: "web" | "electron" | "capacitor" | "tauri";
}

// =============================================================================
// SMART CONTRACT STUDIO
// =============================================================================

export type ContractLanguage = "solidity" | "vyper" | "ink" | "move" | "rust";

// Note: ContractTemplateType is the string enum for template selection
// ContractTemplate interface is defined later in the file with full details
export type ContractTemplateType = 
  | "erc20" | "erc721" | "erc1155" | "erc4626"
  | "marketplace" | "auction" | "crowdfund"
  | "dao" | "governor" | "timelock"
  | "staking" | "vesting" | "escrow"
  | "multisig" | "proxy" | "custom";

export interface SmartContract {
  id: ContractId;
  name: string;
  description?: string;
  language: ContractLanguage;
  template?: ContractTemplateType;
  
  // Source
  sourceCode: string;
  abi?: ContractABI;
  bytecode?: string;
  
  // Compilation
  compilerVersion: string;
  optimizerRuns?: number;
  compiled: boolean;
  compiledAt?: number;
  lastCompiled?: number;
  
  // Deployment
  deployments: ContractDeployment[];
  
  // Verification
  verified: boolean;
  verifiedAt?: number;
  
  // Metadata
  createdAt: number;
  updatedAt: number;
}

export interface ContractABIEntry {
  name?: string;
  type: "function" | "event" | "constructor" | "fallback" | "receive";
  inputs?: ABIParam[];
  outputs?: ABIParam[];
  stateMutability?: "pure" | "view" | "nonpayable" | "payable";
}

// ContractABI is an array of ABI entries
export type ContractABI = ContractABIEntry[];

export interface ABIParam {
  name: string;
  type: string;
  indexed?: boolean;
  components?: ABIParam[];
}

export interface ContractDeployment {
  id: string;
  contractId: ContractId;
  chainId: number;
  chainName: string;
  address: string;
  txHash: string;
  deployer: string;
  constructorArgs: unknown[];
  deployedAt: number;
  blockNumber: number;
  verification?: ContractVerification;
}

export interface ContractInteraction {
  deployment: ContractDeployment;
  function: string;
  args: unknown[];
  value?: string;
  gasLimit?: number;
  gasPrice?: string;
}

export interface ContractTestCase {
  id: string;
  name: string;
  description?: string;
  setup?: string;
  test: string;
  expected: unknown;
  gasEstimate?: number;
}

// =============================================================================
// LOCAL CI/CD PIPELINE
// =============================================================================

export type PipelineStage = "checkout" | "install" | "lint" | "test" | "build" | "deploy" | "notify";
export type PipelineTrigger = "manual" | "push" | "schedule" | "webhook" | "file_change";
export type PipelineStatus = "idle" | "queued" | "running" | "success" | "failed" | "cancelled" | "pending" | "skipped";

export interface PipelineStep {
  id: string;
  name: string;
  type?: PipelineStage | "build" | "test" | "deploy" | "script" | "approval";
  command?: string;
  windowsCommand?: string;
  script?: string;
  continueOnError?: boolean;
  condition?: string;
  timeout?: number;
  retries?: number;
  env?: Record<string, string>;
  environment?: Record<string, string>;
  dependsOn?: string[];
}

export interface Pipeline {
  id: PipelineId;
  name: string;
  description?: string;
  projectId?: string;
  
  // Steps (used by implementation)
  steps: PipelineStep[];
  
  // Triggers
  triggers: PipelineTriggerConfig[];
  
  // Environment
  environment?: Record<string, string>;
  env: Record<string, string>;  // Alias for compatibility
  secrets?: string[];
  
  // Config
  timeout?: number;
  concurrent?: boolean;
  enabled: boolean;
  workingDirectory: string;
  
  // Artifacts
  artifacts?: ArtifactConfig[];
  
  // Stats
  lastRunAt?: number;
  lastRunNumber?: number;
  lastStatus?: PipelineStatus;
  successCount?: number;
  failureCount?: number;
  
  createdAt: number;
  updatedAt: number;
}

export interface PipelineTriggerConfig {
  id?: string;
  type: PipelineTrigger;
  enabled?: boolean;
  branch?: string;
  paths?: string[];
  patterns?: string[];
  schedule?: string;
  webhookSecret?: string;
}

export interface PipelineStageConfig {
  name: string;
  stage: PipelineStage;
  
  // Commands
  commands: string[];
  
  // Conditions
  condition?: string;
  continueOnError?: boolean;
  
  // Caching
  cache?: {
    key: string;
    paths: string[];
  };
  
  // Artifacts
  artifacts?: ArtifactConfig;
  
  // Parallel
  parallel?: boolean;
  matrix?: Record<string, string[]>;
}

export interface ArtifactConfig {
  name?: string;
  paths: string[];
  expireIn?: string;
}

export interface StepResult {
  stepId: string;
  name: string;
  status: PipelineStatus;
  startedAt?: number;
  finishedAt?: number;
  duration?: number;
  logs: string;
  exitCode?: number;
  error?: string;
  skippedReason?: string;
  output?: string;
  logFile?: string;
}

export interface PipelineRunArtifact {
  name: string;
  path: string;
  size: number;
}

export interface PipelineRun {
  id: string;
  pipelineId: PipelineId;
  runNumber: number;
  status: PipelineStatus;
  trigger: PipelineTrigger;
  triggeredBy?: string;
  
  // Progress
  currentStep?: string;
  steps: StepResult[];
  
  // Environment
  env: Record<string, string>;
  
  // Timing
  startedAt: number;
  finishedAt?: number;
  duration?: number;
  
  // Artifacts
  artifacts: PipelineRunArtifact[];
  logs: string;
  
  // Errors
  error?: string;
}

// =============================================================================
// CRYPTO PAYMENT GATEWAY
// =============================================================================

export type PaymentNetwork = "ethereum" | "polygon" | "arbitrum" | "optimism" | "base" | "solana" | "bitcoin";
export type PaymentStatus = "pending" | "confirming" | "confirmed" | "failed" | "expired" | "refunded" | "cancelled";
export type PaymentType = "one_time" | "subscription" | "escrow" | "streaming";
export type PaymentMethod = "crypto" | "fiat" | "lightning" | "layer2";

export interface PaymentGatewayConfig {
  enabledNetworks: PaymentNetwork[];
  acceptedTokens: TokenConfig[];
  
  // Wallet
  receiverWallet: string;
  merchantWallet?: string;
  merchantId?: string;
  
  // Callbacks
  webhookUrl?: string;
  redirectUrl?: string;
  
  // Options
  autoConvert?: boolean;
  convertTo?: string;
  minConfirmations: number;
  confirmationsRequired?: number;
  
  // Additional
  supportedChains?: PaymentNetwork[];
  customRpcUrls?: Record<string, string>;
}

export interface TokenConfig {
  network: PaymentNetwork;
  symbol: string;
  address: string;
  decimals: number;
  minAmount?: number;
  maxAmount?: number;
}

export interface PaymentRequest {
  id: PaymentId;
  type: PaymentType;
  amount: string;
  currency: string;
  network: PaymentNetwork;
  token: string;
  
  // Metadata
  description?: string;
  orderId?: string;
  customerId?: string;
  metadata?: Record<string, unknown>;
  
  // Timing
  expiresAt?: number;
  
  // For subscriptions
  interval?: "daily" | "weekly" | "monthly" | "yearly";
  
  // For streaming
  duration?: number;
  flowRate?: string;
}

export interface Payment {
  id: PaymentId;
  requestId: PaymentId;
  status: PaymentStatus;
  
  // Transaction
  txHash?: string;
  blockNumber?: number;
  confirmations: number;
  
  // Amounts
  requestedAmount: string;
  paidAmount?: string;
  feeAmount?: string;
  amount?: string;
  amountReceived?: string;
  
  // Currency
  currency?: string;
  
  // Addresses
  fromAddress?: string;
  toAddress: string;
  paymentAddress?: string;
  tokenAddress?: string;
  
  // Chain/Network info
  chainId?: number;
  network?: PaymentNetwork;
  
  // Timing
  createdAt: number;
  updatedAt?: number;
  paidAt?: number;
  confirmedAt?: number;
  expiresAt?: number;
  
  // Refund info
  refundedAmount?: string;
  refundTransactionHash?: string;
  refundReason?: string;
  
  // Metadata
  metadata?: Record<string, unknown>;
  merchantId?: string;
  merchantOrderId?: string;
  callbackUrl?: string;
}

export interface PaymentInvoice {
  id: string;
  paymentId: PaymentId;
  
  // Invoice details
  invoiceNumber: string;
  items: InvoiceItem[];
  subtotal: string;
  tax?: string;
  total: string;
  
  // Customer
  customerName?: string;
  customerEmail?: string;
  customerAddress?: string;
  
  // Status
  paid: boolean;
  paidAt?: number;
  
  createdAt: number;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: string;
  total: string;
}

export interface PaymentStream {
  id: string;
  sender: string;
  receiver: string;
  token: string;
  flowRate: string;
  startTime: number;
  endTime?: number;
  status: "active" | "paused" | "cancelled" | "completed";
  totalAmount: string;
  claimedAmount: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  createdAt: number;
  lastTriggeredAt?: number;
}

// =============================================================================
// COLLABORATIVE WORKSPACE (CRDT)
// =============================================================================

export type ConflictResolution = "last_write_wins" | "first_write_wins" | "merge" | "manual";
// SyncStatus is defined later as an interface to support both string literals and object format

export interface Workspace {
  id: WorkspaceId;
  name: string;
  description?: string;
  
  // Ownership
  ownerId: string;
  members?: WorkspaceMember[];
  collaborators?: Collaborator[];
  
  // Documents
  documents: CollaborativeDocument[];
  
  // Sync
  syncEnabled?: boolean;
  lastSyncAt?: number;
  syncStatus?: SyncStatus;
  
  // Config
  conflictResolution?: ConflictResolution;
  isPublic?: boolean;
  metadata?: Record<string, unknown>;
  
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMember {
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  joinedAt: number;
  lastActiveAt?: number;
}

export interface CollaborativeDocument {
  id: string;
  workspaceId: WorkspaceId;
  name: string;
  type: "text" | "json" | "code" | "canvas" | "table" | "markdown";
  
  // Content (CRDT state)
  content: unknown;
  crdtState?: Uint8Array | CRDTState;
  
  // Version
  version: number;
  localVersion?: number;
  
  // Cursors
  cursors?: UserCursor[];
  
  // History
  history?: DocumentChange[];
  operations?: DocumentOperation[];
  
  // Sync
  syncStatus?: SyncStatus;
  pendingChanges?: DocumentChange[];
  
  // Comments
  comments?: Comment[];
  
  // Metadata
  lastEditedBy?: string;
  metadata?: Record<string, unknown>;
  
  createdAt: number;
  updatedAt: number;
}

export interface UserCursor {
  userId: string;
  position: number;
  selection?: { start: number; end: number };
  color: string;
  name: string;
  lastUpdate: number;
}

export interface DocumentChange {
  id: string;
  userId: string;
  timestamp: number;
  operation: CRDTOperation;
  applied: boolean;
}

export type CRDTOperation =
  | { type: "insert"; position: number; content: string }
  | { type: "delete"; position: number; length: number }
  | { type: "replace"; position: number; length: number; content: string }
  | { type: "set"; path: string[]; value: unknown };

// =============================================================================
// LOCAL FINE-TUNING
// =============================================================================

export type FineTuneMethod = "lora" | "qlora" | "full" | "adapter" | "prefix";
export type FineTuneStatus = "pending" | "preparing" | "running" | "training" | "evaluating" | "completed" | "failed" | "cancelled";

export interface FineTuneJob {
  id: FineTuneJobId;
  name: string;
  description?: string;
  
  // Base model
  baseModelId: ModelId;
  baseModel?: string;
  baseModelPath?: string;
  outputModelId?: ModelId;
  
  // Method
  method: FineTuneMethod;
  
  // Dataset
  datasetId: string;
  validationSplit?: number;
  
  // Hyperparameters
  hyperparameters: FineTuneHyperparameters;
  config?: TrainingConfig;
  
  // Status
  status: FineTuneStatus;
  progress: number | TrainingProgress;
  currentEpoch?: number;
  error?: string;
  
  // Output
  outputPath?: string;
  
  // Metrics
  trainingMetrics: TrainingMetrics[];
  evaluationMetrics?: EvaluationMetrics;
  
  // Checkpoints
  checkpoints: ModelCheckpoint[];
  bestCheckpoint?: string;
  
  // Resources
  gpuMemoryUsed?: number;
  estimatedTimeRemaining?: number;
  
  // Timing
  startedAt?: number;
  completedAt?: number;
  
  // Metadata
  metadata?: Record<string, unknown>;
  
  createdAt: number;
  updatedAt: number;
}

export interface FineTuneHyperparameters {
  // Training
  epochs: number;
  batchSize: number;
  learningRate: number;
  warmupSteps: number;
  weightDecay: number;
  
  // LoRA specific
  loraRank?: number;
  loraAlpha?: number;
  loraDropout?: number;
  targetModules?: string[];
  
  // QLoRA specific
  bitsAndBytes?: {
    load4bit: boolean;
    bnbQuantType: string;
    computeDtype: string;
  };
  
  // Optimization
  gradientAccumulation?: number;
  gradientCheckpointing?: boolean;
  mixedPrecision?: "fp16" | "bf16" | "fp32";
  
  // Regularization
  maxGradNorm?: number;
  earlyStopping?: {
    patience: number;
    metric: string;
  };
}

export interface TrainingMetrics {
  epoch: number;
  step: number;
  loss: number;
  learningRate: number;
  gradNorm?: number;
  timestamp: number;
}

export interface EvaluationMetrics {
  loss: number;
  perplexity: number;
  accuracy?: number;
  f1Score?: number;
  bleuScore?: number;
  rougeScores?: {
    rouge1: number;
    rouge2: number;
    rougeL: number;
  };
}

export interface ModelCheckpoint {
  id: string;
  jobId: FineTuneJobId;
  epoch: number;
  step: number;
  path: string;
  metrics: TrainingMetrics;
  size: number;
  createdAt: number;
}

// =============================================================================
// MEDIA GENERATION
// =============================================================================

export type MediaType = "image" | "video" | "audio" | "3d";
export type ImageModel = "stable-diffusion" | "sdxl" | "flux" | "dalle" | "midjourney-style";
export type AudioModel = "musicgen" | "audiogen" | "bark" | "tortoise" | "whisper";
export type VideoModel = "stable-video" | "animate-diff" | "runway-style";

export interface MediaGenerationJob {
  id: MediaJobId;
  type: MediaType;
  model: string;
  status: "pending" | "processing" | "running" | "completed" | "failed" | "cancelled";
  
  // Input
  prompt?: string;
  negativePrompt?: string;
  inputMedia?: string;
  
  // Config
  config: MediaGenerationConfig;
  
  // Output
  outputs: GeneratedMedia[];
  
  // Progress
  progress: number;
  currentStep?: number;
  totalSteps?: number;
  
  // Error
  error?: string;
  
  // Timing
  startedAt?: number;
  completedAt?: number;
  
  createdAt: number;
}

export interface MediaGenerationConfig {
  // Image
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  sampler?: string;
  seed?: number;
  batchSize?: number;
  
  // Video
  fps?: number;
  duration?: number;
  motionScale?: number;
  
  // Audio
  sampleRate?: number;
  channels?: number;
  format?: string;
  
  // Common
  scheduler?: string;
  clipSkip?: number;
}

export interface GeneratedMedia {
  id: string;
  jobId?: MediaJobId;
  type: MediaType;
  path: string;
  url?: string;
  
  // Metadata
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  format?: string;
  
  // Generation info
  seed?: number;
  prompt?: string;
  model?: string;
  parameters?: Record<string, unknown>;
  
  createdAt: number;
}

export interface ImageEditRequest {
  inputImage: string;
  mask?: string;
  prompt: string;
  editType: "inpaint" | "outpaint" | "style_transfer" | "upscale" | "enhance";
  config?: Partial<MediaGenerationConfig>;
}

export interface AudioTranscriptionRequest {
  audioPath: string;
  language?: string;
  translate?: boolean;
  timestamps?: boolean;
  wordLevel?: boolean;
}

export interface AudioTranscription {
  text: string;
  language: string;
  duration: number;
  segments: TranscriptionSegment[];
  words?: TranscriptionWord[];
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

// =============================================================================
// SELF-HOSTED ANALYTICS
// =============================================================================

export type AnalyticsEventType = 
  | "page_view" | "click" | "form_submit" | "scroll" | "custom"
  | "agent_run" | "workflow_run" | "model_inference" | "media_generation";

export interface AnalyticsEvent {
  id: AnalyticsId | string;
  type?: AnalyticsEventType;
  name?: string;
  
  // Context
  sessionId: string;
  userId?: string;
  anonymousId?: string;
  
  // Page
  page?: {
    path: string;
    title: string;
    referrer?: string;
  };
  
  // Properties
  properties?: Record<string, unknown>;
  
  // Legacy / simplified event tracking
  category?: string;
  action?: string;
  label?: string;
  value?: number;
  metadata?: Record<string, unknown>;
  
  // Timing
  timestamp: number;
  duration?: number;
  
  // Device
  device?: DeviceInfo;
  
  // Geo
  geo?: GeoInfo;
}

export interface DeviceInfo {
  type: "desktop" | "mobile" | "tablet";
  os: string;
  osVersion: string;
  browser?: string;
  browserVersion?: string;
  screenWidth?: number;
  screenHeight?: number;
}

export interface GeoInfo {
  country?: string;
  region?: string;
  city?: string;
  timezone?: string;
}

export interface AnalyticsQuery {
  eventTypes?: AnalyticsEventType[];
  startDate: number;
  endDate: number;
  
  // Dimensions
  groupBy?: string[];
  
  // Metrics
  metrics: AnalyticsMetric[];
  
  // Filters
  filters?: AnalyticsFilter[];
  
  // Pagination
  limit?: number;
  offset?: number;
}

export type AnalyticsMetric = 
  | "count" | "unique_users" | "unique_sessions"
  | "avg_duration" | "total_duration"
  | "sum" | "avg" | "min" | "max"
  // Also used as an interface-like record in self_hosted_analytics
  | AnalyticsMetricRecord;

export interface AnalyticsMetricRecord {
  id: string;
  name: string;
  value: number;
  tags?: Record<string, string>;
  interval: "minute" | "hour" | "day" | "week" | "month";
  periodStart: number;
  periodEnd: number;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
}

export interface AnalyticsFilter {
  field: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: unknown;
}

export interface AnalyticsReport {
  id: string;
  name: string;
  description?: string;
  query: AnalyticsQuery;
  visualization: "table" | "line" | "bar" | "pie" | "funnel" | "heatmap";
  schedule?: string;
  lastRunAt?: number;
  createdAt: number;
}

export interface AnalyticsResult {
  rows: Record<string, unknown>[];
  totals: Record<string, number>;
  meta: {
    executionTime: number;
    rowCount: number;
    scannedRows: number;
  };
}

// =============================================================================
// UNIFIED CONFIG
// =============================================================================

export interface SovereignStackConfig {
  // Models
  modelsDir: string;
  defaultBackend: ModelBackend;
  autoLoadModels: boolean;
  
  // Vector Store
  vectorStoreDir: string;
  defaultVectorBackend: VectorBackend;
  
  // Contracts
  contractsDir: string;
  defaultNetwork: number;
  rpcEndpoints: Record<number, string>;
  
  // Pipelines
  pipelinesDir: string;
  artifactsDir: string;
  
  // Payments
  paymentsEnabled: boolean;
  paymentConfig?: PaymentGatewayConfig;
  
  // Collaboration
  collaborationEnabled: boolean;
  syncServer?: string;
  
  // Fine-tuning
  fineTuneEnabled: boolean;
  checkpointsDir: string;
  
  // Media
  mediaEnabled: boolean;
  mediaOutputDir: string;
  
  // Analytics
  analyticsEnabled: boolean;
  analyticsRetentionDays: number;
}
// =============================================================================
// ADDITIONAL EXPORTS FOR COMPATIBILITY
// =============================================================================

// Project types
export type ProjectId = Brand<string, "ProjectId">;
export type AppId = Brand<string, "AppId">;

// Model download progress
export interface ModelDownloadProgress {
  modelId: ModelId;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  eta: number;
  status: "pending" | "downloading" | "extracting" | "complete" | "error";
  error?: string;
}

// Inference types
export interface InferenceOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  stop?: string[];
  stream?: boolean;
}

export interface InferenceResult {
  text: string;
  finishReason: "stop" | "length" | "tool_call";
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolCalls?: ToolCall[];
}

// Document types
export interface Document {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

// Search types
export interface SearchResult {
  document: Document;
  score: number;
  highlights?: string[];
}

// RAG types
export interface RAGOptions {
  topK?: number;
  threshold?: number;
  filter?: Record<string, unknown>;
  rerank?: boolean;
}

export interface RAGResult {
  answer: string;
  sources: SearchResult[];
  context: string;
}

// Component types
export interface ComponentProperty {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "function";
  default?: unknown;
  required?: boolean;
  description?: string;
}

// Export types
export type AppExportFormat = "react" | "vue" | "svelte" | "html" | "react-native";

export interface AppExportOptions {
  format: AppExportFormat;
  outputDir: string;
  minify?: boolean;
  sourceMaps?: boolean;
}

export interface ExportOptions extends AppExportOptions {}

export interface ExportResult {
  success: boolean;
  outputPath: string;
  files: string[];
  errors?: string[];
}

// Contract types
export interface ContractTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  language: ContractLanguage;
  code: string;
  parameters: ContractParameter[];
  dependencies: string[];
}

export interface ContractParameter {
  name: string;
  type: string;
  description: string;
  default?: string;
}

export interface CompilationResult {
  success: boolean;
  bytecode?: string;
  abi?: ContractABI;
  errors?: CompilationError[];
  warnings?: string[];
}

export interface CompilationError {
  severity: "error" | "warning";
  message: string;
  line?: number;
  column?: number;
}

export interface ContractVerification {
  verified: boolean;
  explorerUrl?: string;
  contractAddress: string;
  network: number;
  verifiedAt?: number;
}

export interface DeploymentResult {
  success: boolean;
  address?: string;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: number;
  error?: string;
}

// Pipeline types (merged with main PipelineStep interface above)
// Extending PipelineStep with additional step types
// Main interface is defined in LOCAL CI/CD PIPELINE section

export interface BuildArtifact {
  id: string;
  name: string;
  path: string;
  size: number;
  checksum: string;
  createdAt: number;
}

// Payment types
export interface PaymentConfig {
  gateway: "stripe" | "crypto" | "custom";
  apiKey?: string;
  webhookSecret?: string;
  currencies: string[];
}

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  planName?: string;
  amount?: string;
  currency?: string;
  chainId?: number;
  interval?: "daily" | "weekly" | "monthly" | "yearly";
  status: "active" | "canceled" | "past_due" | "paused";
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  nextPaymentDate?: number;
  payments?: string[];
  merchantId?: string;
  subscriberAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  cancelledAt?: number;
  updatedAt?: number;
}

export interface PaymentWebhook {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  signature: string;
  receivedAt: number;
  processed: boolean;
}

export interface PaymentAnalytics {
  totalRevenue: number;
  activeSubscriptions: number;
  churnRate: number;
  averageOrderValue: number;
  revenueByPeriod: Record<string, number>;
}

// Collaboration types
export interface DocumentOperation {
  type: "insert" | "delete" | "retain" | "format";
  position?: number;
  content?: string;
  length?: number;
  attributes?: Record<string, unknown>;
  // CRDT-specific fields
  id?: string;
  char?: string;
  afterId?: string;
  timestamp?: string | number;
}

export interface CRDTState {
  version?: number;
  operations?: DocumentOperation[];
  snapshot?: string;
  nodes?: Record<string, unknown>;
  head?: string;
  timestamp?: string;
}

export interface Collaborator {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  role: "owner" | "editor" | "viewer";
  color?: string;
  joinedAt?: number;
  online?: boolean;
}

export interface PresenceInfo {
  id?: string;
  collaborator: Collaborator;
  cursor?: { line: number; column: number };
  selection?: { start: number; end: number };
  lastActive: number;
  lastActiveAt?: number;
}

export interface Comment {
  id: string;
  content: string;
  author: Collaborator;
  createdAt: number;
  updatedAt?: number;
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: string;
  replies?: Comment[];
  anchor?: { start: number; end: number };
}

export interface SyncStatus {
  status?: "synced" | "syncing" | "pending" | "error" | "conflict" | "offline";
  synced?: boolean;
  pendingChanges?: number;
  pendingOperations?: number;
  lastSyncedAt?: number;
  error?: string;
}

// Fine-tuning types
export interface TrainingDataset {
  id: string;
  name: string;
  description?: string;
  path: string;
  format: "jsonl" | "csv" | "parquet" | "custom" | "alpaca" | "sharegpt" | "oasst";
  sampleCount?: number;
  trainSamples?: number;
  validationSamples?: number;
  validationSplit?: number;
  statistics?: {
    totalSamples: number;
    avgInputLength: number;
    avgOutputLength: number;
    maxInputLength: number;
    maxOutputLength: number;
  };
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

export interface TrainingConfig {
  baseModel: ModelId;
  dataset: TrainingDataset;
  hyperparameters: FineTuneHyperparameters;
  outputDir: string;
  
  // Convenience aliases for hyperparameters (for flat access in code)
  batchSize?: number;
  epochs?: number;
  learningRate?: number;
  warmupSteps?: number;
  maxGradNorm?: number;
  gradientAccumulationSteps?: number;
  
  // LoRA settings
  loraR?: number;
  loraAlpha?: number;
  loraDropout?: number;
  targetModules?: string[];
  
  // QLoRA settings  
  doublequant?: boolean;
  nf4?: boolean;
  
  // Optimization
  optimizer?: string;
  scheduler?: string;
}

export interface TrainingProgress {
  epoch: number;
  step: number;
  totalSteps: number;
  loss: number;
  learningRate: number;
  eta: number;
  currentStep?: number;
  currentEpoch?: number;
  totalEpochs?: number;
  elapsedTime?: number;
}

export interface ModelAdapter {
  id: string;
  name: string;
  baseModel: ModelId;
  type: "lora" | "qlora" | "full";
  path: string;
  rank?: number;
  alpha?: number;
  method?: string;
  config?: TrainingConfig;
}

export interface EvaluationResult {
  id?: string;
  modelPath?: string;
  adapterId?: string;
  datasetId?: string;
  completedAt?: number;
  metrics: EvaluationMetrics;
  samples?: { input: string; expected: string; actual: string; score: number }[];
}

// Media types
export type MediaGenerationId = MediaJobId;

export interface ImageGenerationJob extends MediaGenerationJob {
  type: "image";
  // Flat config properties for convenience
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  sampler?: string;
  seed?: number;
  batchSize?: number;
  scheduler?: string;
  clipSkip?: number;
  loraModels?: Array<{ name: string; weight: number }>;
  controlnet?: { model: string; image: string; weight: number };
  img2img?: { image: string; denoisingStrength: number };
  inpaint?: { image: string; mask: string };
  metadata?: Record<string, unknown>;
}

export interface AudioGenerationJob extends MediaGenerationJob {
  type: "audio";
  // Audio-specific properties
  audioType?: "tts" | "music" | "sound" | "transcribe";
  audioFile?: string;
  text?: string;
  voice?: string;
  language?: string;
  transcript?: string;
  output?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface VideoGenerationJob extends MediaGenerationJob {
  type: "video";
  // Video-specific properties
  image?: string;
  frames?: number;
  fps?: number;
  width?: number;
  height?: number;
  seed?: number;
  output?: string;
}

export interface MediaModel {
  id: string;
  name: string;
  type: "image" | "audio" | "video" | "multimodal";
  backend?: string;
  capabilities: string[];
  size?: string;
  requirements?: { vram: string; platform: string[] };
  localPath?: string;
}

// Analytics dashboard types
export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  widgets: DashboardWidget[];
  layout?: { columns: number; rows: number } | Record<string, unknown>;
  refreshInterval?: number;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

export interface DashboardWidget {
  id: string;
  type: "chart" | "metric" | "table" | "map" | "text";
  title: string;
  query?: AnalyticsQuery;
  position: { x: number; y: number; w?: number; h?: number };
  size?: { width: number; height: number };
  config?: Record<string, unknown>;
  // Widget-specific fields for simplified usage
  metric?: string;
  timeRange?: TimeRange;
  chartType?: "line" | "bar" | "area" | "pie";
  groupBy?: string;
}

export interface TimeRange {
  start: number;
  end: number;
  preset?: "today" | "yesterday" | "last7days" | "last30days" | "thisMonth" | "lastMonth";
}

export interface AggregatedData {
  dimensions?: Record<string, string>;
  metrics?: Record<string, number>;
  // Used by self_hosted_analytics aggregation
  periodStart?: number;
  periodEnd?: number;
  count?: number;
  values?: Record<string, number>;
}

export interface UserBehavior {
  userId?: string;
  sessionId?: string;
  sessions?: number;
  pageViews?: number;
  avgSessionDuration?: number;
  bounceRate?: number;
  lastActive?: number;
  // Used by self_hosted_analytics
  feature?: string;
  usageCount?: number;
  totalDuration?: number;
  lastUsed?: number;
  firstUsed?: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit?: string;
  trend?: "up" | "down" | "stable";
  percentChange?: number;
  context?: Record<string, unknown>;
  timestamp?: number;
}

// Vector store additional types
export type VectorStoreBackend = VectorBackend;

export interface ChunkingConfig {
  strategy: "fixed" | "sentence" | "paragraph" | "semantic" | "code" | "markdown";
  chunkSize: number;
  chunkOverlap: number;
  separators?: string[];
}