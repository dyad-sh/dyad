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

export type VectorBackend = "sqlite-vss" | "faiss" | "annoy" | "hnswlib" | "chromadb-local";
export type DistanceMetric = "cosine" | "euclidean" | "dot_product" | "manhattan";

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
  
  // Metadata
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface VectorDocument {
  id: string;
  collectionId: CollectionId;
  content: string;
  metadata?: Record<string, unknown>;
  
  // Source info
  source?: {
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
}

export interface RAGRequest {
  collectionIds: CollectionId[];
  query: string;
  modelId: ModelId;
  
  // Retrieval
  topK?: number;
  minScore?: number;
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
}

// =============================================================================
// VISUAL APP BUILDER
// =============================================================================

export type ComponentType = 
  | "layout" | "container" | "grid" | "flex" | "stack"
  | "text" | "heading" | "paragraph" | "link" | "code"
  | "button" | "input" | "textarea" | "select" | "checkbox" | "radio" | "switch" | "slider"
  | "form" | "table" | "list" | "card" | "modal" | "drawer" | "tabs" | "accordion"
  | "image" | "video" | "audio" | "file" | "icon"
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
  
  // Appearance
  backgroundColor?: string;
  color?: string;
  borderRadius?: string;
  border?: string;
  boxShadow?: string;
  
  // Typography
  fontSize?: string;
  fontWeight?: string;
  textAlign?: string;
  lineHeight?: string;
  
  // Custom
  custom?: Record<string, string>;
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
  
  // Pages
  pages: AppPage[];
  
  // Global
  globalStyles: string;
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
export type ContractTemplate = 
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
  template?: ContractTemplate;
  
  // Source
  sourceCode: string;
  abi?: ContractABI;
  bytecode?: string;
  
  // Compilation
  compilerVersion: string;
  optimizerRuns?: number;
  compiled: boolean;
  compiledAt?: number;
  
  // Deployment
  deployments: ContractDeployment[];
  
  // Verification
  verified: boolean;
  verifiedAt?: number;
  
  // Metadata
  createdAt: number;
  updatedAt: number;
}

export interface ContractABI {
  name: string;
  type: "function" | "event" | "constructor" | "fallback" | "receive";
  inputs: ABIParam[];
  outputs?: ABIParam[];
  stateMutability?: "pure" | "view" | "nonpayable" | "payable";
}

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
export type PipelineStatus = "idle" | "queued" | "running" | "success" | "failed" | "cancelled";

export interface Pipeline {
  id: PipelineId;
  name: string;
  description?: string;
  projectId: string;
  
  // Triggers
  triggers: PipelineTriggerConfig[];
  
  // Stages
  stages: PipelineStageConfig[];
  
  // Environment
  environment: Record<string, string>;
  secrets: string[];
  
  // Config
  timeout: number;
  concurrent: boolean;
  
  // Stats
  lastRunAt?: number;
  lastStatus?: PipelineStatus;
  successCount: number;
  failureCount: number;
  
  createdAt: number;
  updatedAt: number;
}

export interface PipelineTriggerConfig {
  type: PipelineTrigger;
  branch?: string;
  paths?: string[];
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
  artifacts?: {
    paths: string[];
    expireIn?: string;
  };
  
  // Parallel
  parallel?: boolean;
  matrix?: Record<string, string[]>;
}

export interface PipelineRun {
  id: string;
  pipelineId: PipelineId;
  status: PipelineStatus;
  trigger: PipelineTrigger;
  triggeredBy?: string;
  
  // Progress
  currentStage?: string;
  stageResults: StageResult[];
  
  // Timing
  startedAt: number;
  finishedAt?: number;
  duration?: number;
  
  // Artifacts
  artifacts: string[];
  logs: string;
}

export interface StageResult {
  name: string;
  status: PipelineStatus;
  startedAt: number;
  finishedAt?: number;
  duration?: number;
  logs: string;
  exitCode?: number;
}

// =============================================================================
// CRYPTO PAYMENT GATEWAY
// =============================================================================

export type PaymentNetwork = "ethereum" | "polygon" | "arbitrum" | "optimism" | "base" | "solana" | "bitcoin";
export type PaymentStatus = "pending" | "confirming" | "confirmed" | "failed" | "expired" | "refunded";
export type PaymentType = "one_time" | "subscription" | "escrow" | "streaming";

export interface PaymentGatewayConfig {
  enabledNetworks: PaymentNetwork[];
  acceptedTokens: TokenConfig[];
  
  // Wallet
  receiverWallet: string;
  
  // Callbacks
  webhookUrl?: string;
  redirectUrl?: string;
  
  // Options
  autoConvert?: boolean;
  convertTo?: string;
  minConfirmations: number;
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
  
  // Addresses
  fromAddress?: string;
  toAddress: string;
  
  // Timing
  createdAt: number;
  paidAt?: number;
  confirmedAt?: number;
  
  // Metadata
  metadata?: Record<string, unknown>;
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

// =============================================================================
// COLLABORATIVE WORKSPACE (CRDT)
// =============================================================================

export type ConflictResolution = "last_write_wins" | "first_write_wins" | "merge" | "manual";
export type SyncStatus = "synced" | "syncing" | "pending" | "conflict" | "offline";

export interface Workspace {
  id: WorkspaceId;
  name: string;
  description?: string;
  
  // Ownership
  ownerId: string;
  members: WorkspaceMember[];
  
  // Documents
  documents: CollaborativeDocument[];
  
  // Sync
  syncEnabled: boolean;
  lastSyncAt?: number;
  syncStatus: SyncStatus;
  
  // Config
  conflictResolution: ConflictResolution;
  
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
  type: "text" | "json" | "code" | "canvas" | "table";
  
  // Content (CRDT state)
  content: unknown;
  crdtState?: Uint8Array;
  
  // Version
  version: number;
  localVersion: number;
  
  // Cursors
  cursors: UserCursor[];
  
  // History
  history: DocumentChange[];
  
  // Sync
  syncStatus: SyncStatus;
  pendingChanges: DocumentChange[];
  
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
export type FineTuneStatus = "pending" | "preparing" | "training" | "evaluating" | "completed" | "failed";

export interface FineTuneJob {
  id: FineTuneJobId;
  name: string;
  description?: string;
  
  // Base model
  baseModelId: ModelId;
  outputModelId?: ModelId;
  
  // Method
  method: FineTuneMethod;
  
  // Dataset
  datasetId: string;
  validationSplit?: number;
  
  // Hyperparameters
  hyperparameters: FineTuneHyperparameters;
  
  // Status
  status: FineTuneStatus;
  progress: number;
  currentEpoch?: number;
  
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
  status: "pending" | "processing" | "completed" | "failed";
  
  // Input
  prompt: string;
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
  jobId: MediaJobId;
  type: MediaType;
  path: string;
  url?: string;
  
  // Metadata
  width?: number;
  height?: number;
  duration?: number;
  size: number;
  format: string;
  
  // Generation info
  seed: number;
  prompt: string;
  
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
  id: AnalyticsId;
  type: AnalyticsEventType;
  name: string;
  
  // Context
  sessionId: string;
  userId?: string;
  anonymousId: string;
  
  // Page
  page?: {
    path: string;
    title: string;
    referrer?: string;
  };
  
  // Properties
  properties: Record<string, unknown>;
  
  // Timing
  timestamp: number;
  duration?: number;
  
  // Device
  device: DeviceInfo;
  
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
  | "sum" | "avg" | "min" | "max";

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
