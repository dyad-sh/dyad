/**
 * Agent Factory Types
 * Complete type definitions for creating, training, and managing AI agents
 * with support for custom model training and LoRA adapters.
 */

import type {
  TrainingJobId,
  AdapterId,
  TrainingMethod,
  TrainingHyperparameters,
  DatasetConfig,
  LoRAAdapter,
  TrainingJob,
  TrainingProgress,
  SystemCapabilities,
} from "./model_factory_types";

// =============================================================================
// BRANDED TYPES
// =============================================================================

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type AgentFactoryId = Brand<string, "AgentFactoryId">;
export type CustomAgentId = Brand<string, "CustomAgentId">;
export type AgentVersionId = Brand<string, "AgentVersionId">;
export type SkillId = Brand<string, "SkillId">;
export type PersonalityId = Brand<string, "PersonalityId">;

// =============================================================================
// AGENT TYPES
// =============================================================================

export type AgentType =
  | "conversational"   // Chat-focused agent
  | "task"             // Task execution agent
  | "coding"           // Code generation/review
  | "research"         // Research and analysis
  | "creative"         // Creative writing/content
  | "data"             // Data analysis
  | "multimodal"       // Vision + text
  | "tool-use"         // Tool/function calling
  | "autonomous"       // Self-directed agent
  | "custom";          // Custom type

export type AgentPersonality =
  | "professional"
  | "friendly"
  | "concise"
  | "detailed"
  | "creative"
  | "analytical"
  | "supportive"
  | "neutral"
  | "custom";

export type AgentCapability =
  | "text_generation"
  | "code_generation"
  | "code_review"
  | "summarization"
  | "translation"
  | "question_answering"
  | "reasoning"
  | "math"
  | "vision"
  | "function_calling"
  | "web_search"
  | "file_operations"
  | "data_analysis"
  | "creative_writing"
  | "structured_output";

// =============================================================================
// CUSTOM AGENT
// =============================================================================

export interface CustomAgent {
  id: CustomAgentId;
  name: string;
  displayName: string;
  description: string;
  avatar?: string;
  
  // Type and personality
  type: AgentType;
  personality: AgentPersonality;
  
  // Model configuration
  modelConfig: AgentModelConfig;
  
  // Training
  trainingConfig?: AgentTrainingConfig;
  trainingJob?: TrainingJob;
  trainingStatus?: AgentTrainingStatus;
  
  // Adapters
  adapters: AgentAdapter[];
  activeAdapter?: AdapterId;
  
  // Behavior
  systemPrompt: string;
  behaviorConfig: AgentBehaviorConfig;
  
  // Skills
  skills: AgentSkill[];
  
  // Tools
  tools: AgentTool[];
  
  // Knowledge
  knowledgeBases: AgentKnowledgeRef[];
  
  // Guardrails
  guardrails: AgentGuardrails;
  
  // Versioning
  version: string;
  versions: AgentVersion[];
  
  // Status
  status: "draft" | "training" | "ready" | "deployed" | "deprecated";
  isPublic: boolean;
  
  // Metrics
  metrics?: AgentMetrics;
  
  // Metadata
  tags?: string[];
  metadata?: Record<string, unknown>;
  
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

// =============================================================================
// MODEL CONFIGURATION
// =============================================================================

export interface AgentModelConfig {
  // Base model
  baseModel: AgentBaseModel;
  
  // Adapter (if using fine-tuned)
  useAdapter: boolean;
  adapterId?: AdapterId;
  adapterPath?: string;
  
  // Inference settings
  inferenceConfig: InferenceConfig;
  
  // Fallback
  fallbackModel?: AgentBaseModel;
}

export interface AgentBaseModel {
  provider: "ollama" | "lmstudio" | "transformers" | "custom" | "cloud";
  modelId: string;
  modelName: string;
  
  // Cloud provider (if applicable)
  cloudProvider?: "openai" | "anthropic" | "google" | "azure";
  
  // Local path (if applicable)
  localPath?: string;
  
  // Capabilities
  capabilities: AgentCapability[];
  contextLength: number;
  
  // Quantization
  quantization?: string;
}

export interface InferenceConfig {
  // Generation
  maxTokens: number;
  temperature: number;
  topP: number;
  topK?: number;
  repetitionPenalty?: number;
  
  // Stopping
  stopSequences?: string[];
  
  // Streaming
  streamResponse: boolean;
  
  // Timeout
  timeoutMs?: number;
  
  // Batch
  maxConcurrent?: number;
}

// =============================================================================
// TRAINING CONFIGURATION
// =============================================================================

export type AgentTrainingStatus =
  | "not_started"
  | "preparing_data"
  | "queued"
  | "training"
  | "evaluating"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentTrainingConfig {
  // Training mode
  mode: "finetune" | "adapter" | "distillation" | "rlhf" | "dpo";
  
  // Method
  method: TrainingMethod;
  
  // Dataset
  dataset: AgentDataset;
  
  // Hyperparameters
  hyperparameters: Partial<TrainingHyperparameters>;
  
  // Training-specific configs
  fineTuneConfig?: FineTuneConfig;
  rlhfConfig?: RLHFConfig;
  dpoConfig?: DPOConfig;
  distillationConfig?: DistillationConfig;
  
  // Hardware
  useGPU: boolean;
  gpuMemoryLimit?: number;
  
  // Optimization for low GPU
  lowGPUMode: boolean;
  lowGPUSettings?: LowGPUSettings;
  
  // Schedule
  scheduleTraining?: boolean;
  scheduledTime?: number;
}

export interface AgentDataset {
  // Source
  sources: DatasetSource[];
  
  // Processing
  template: ConversationTemplate;
  
  // Augmentation
  augmentation?: DataAugmentation;
  
  // Validation
  validationSplit: number;
  minQuality?: number;
}

export interface DatasetSource {
  type: "conversations" | "instructions" | "feedback" | "examples" | "custom";
  source: "local" | "huggingface" | "generated" | "imported";
  path: string;
  count?: number;
}

export interface ConversationTemplate {
  format: "alpaca" | "sharegpt" | "chatml" | "llama2" | "vicuna" | "custom";
  systemPromptColumn?: string;
  instructionColumn?: string;
  inputColumn?: string;
  outputColumn?: string;
  customTemplate?: string;
}

export interface DataAugmentation {
  enabled: boolean;
  paraphrasing?: boolean;
  backTranslation?: boolean;
  noiseInjection?: boolean;
  augmentRatio?: number;
}

export interface FineTuneConfig {
  // LoRA config (for low GPU)
  loraRank: number;
  loraAlpha: number;
  loraDropout: number;
  targetModules: string[];
  
  // Quantization
  use4bit: boolean;
  use8bit: boolean;
  quantType: "nf4" | "fp4";
  
  // Memory optimization
  gradientCheckpointing: boolean;
  cpuOffload: boolean;
}

export interface RLHFConfig {
  rewardModel: string;
  ppoEpochs: number;
  ppoClipRange: number;
  valueCoef: number;
  entropyCoef: number;
  maxGradNorm: number;
}

export interface DPOConfig {
  beta: number;
  labelSmoothing: number;
  lossType: "sigmoid" | "hinge" | "ipo";
  referenceModel?: string;
}

export interface DistillationConfig {
  teacherModel: string;
  temperature: number;
  alphaKD: number;
  alphaCE: number;
}

export interface LowGPUSettings {
  // Memory optimization
  maxGPUMemoryMB: number;
  useGradientCheckpointing: boolean;
  useCPUOffload: boolean;
  offloadRatio: number;
  
  // Quantization
  loadIn4bit: boolean;
  loadIn8bit: boolean;
  
  // Batch optimization
  microBatchSize: number;
  gradientAccumulation: number;
  
  // Backend optimization
  useUnsloth: boolean;
  useFlashAttention: boolean;
  useBetterTransformer: boolean;
  
  // DeepSpeed
  useDeepSpeed: boolean;
  deepSpeedStage: 1 | 2 | 3;
}

// =============================================================================
// ADAPTERS
// =============================================================================

export interface AgentAdapter {
  id: AdapterId;
  name: string;
  description?: string;
  
  // Source
  source: "trained" | "imported" | "marketplace";
  trainingJobId?: TrainingJobId;
  
  // Compatibility
  baseModelId: string;
  
  // Config
  method: TrainingMethod;
  rank?: number;
  alpha?: number;
  
  // Files
  path: string;
  sizeBytes: number;
  
  // Performance
  benchmarks?: Record<string, number>;
  userRating?: number;
  
  // Status
  status: "ready" | "loading" | "error";
  isActive: boolean;
  
  createdAt: number;
}

// =============================================================================
// BEHAVIOR & SKILLS
// =============================================================================

export interface AgentBehaviorConfig {
  // Response style
  responseStyle: "concise" | "detailed" | "conversational" | "formal" | "casual";
  defaultTone: string;
  
  // Thinking
  useChainOfThought: boolean;
  showReasoningSteps: boolean;
  
  // Safety
  refuseHarmful: boolean;
  acknowledgeUncertainty: boolean;
  citeSources: boolean;
  
  // Memory
  useMemory: boolean;
  memoryConfig?: MemoryConfig;
  
  // Context
  contextWindowUsage: "conservative" | "balanced" | "aggressive";
  
  // Output
  preferredOutputFormat?: "text" | "markdown" | "json" | "code";
  structuredOutput?: boolean;
}

export interface MemoryConfig {
  type: "conversation" | "episodic" | "semantic" | "all";
  maxConversationTurns: number;
  persistMemory: boolean;
  summarizeAfterTurns?: number;
}

export interface AgentSkill {
  id: SkillId;
  name: string;
  description: string;
  
  // Type
  type: "builtin" | "custom" | "trained";
  category: AgentCapability;
  
  // Implementation
  implementation: SkillImplementation;
  
  // Examples
  examples?: SkillExample[];
  
  // Status
  enabled: boolean;
  proficiency?: number;  // 0-100
  
  createdAt: number;
}

export interface SkillImplementation {
  type: "prompt" | "function" | "tool" | "workflow";
  
  // For prompt-based skills
  prompt?: string;
  
  // For function-based skills
  functionName?: string;
  functionCode?: string;
  
  // For tool-based skills
  toolId?: string;
  
  // For workflow-based skills
  workflowId?: string;
}

export interface SkillExample {
  input: string;
  expectedOutput: string;
  context?: string;
}

// =============================================================================
// TOOLS
// =============================================================================

export interface AgentTool {
  id: string;
  name: string;
  description: string;
  
  // Schema
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  
  // Implementation
  implementation: ToolImplementation;
  
  // Permissions
  requiresApproval: boolean;
  permissions: ToolPermission[];
  
  // Status
  enabled: boolean;
  
  // Usage
  usageCount?: number;
  lastUsedAt?: number;
}

export interface ToolImplementation {
  type: "builtin" | "custom" | "mcp" | "api";
  
  // For custom tools
  code?: string;
  
  // For MCP tools
  mcpServerId?: number;
  mcpToolName?: string;
  
  // For API tools
  apiEndpoint?: string;
  apiMethod?: string;
  apiHeaders?: Record<string, string>;
}

export type ToolPermission =
  | "file_read"
  | "file_write"
  | "network"
  | "shell"
  | "database"
  | "secrets";

// =============================================================================
// KNOWLEDGE BASES
// =============================================================================

export interface AgentKnowledgeRef {
  id: string;
  knowledgeBaseId: string;
  name: string;
  description?: string;
  
  // Access
  accessMode: "full" | "query_only" | "summary_only";
  
  // Retrieval config
  retrievalConfig: RetrievalConfig;
  
  // Status
  enabled: boolean;
  indexed: boolean;
  documentCount?: number;
}

export interface RetrievalConfig {
  topK: number;
  similarityThreshold: number;
  reranking: boolean;
  hybridSearch: boolean;
  contextWindow?: number;
}

// =============================================================================
// GUARDRAILS
// =============================================================================

export interface AgentGuardrails {
  // Content filters
  contentFilters: ContentFilter[];
  
  // Input validation
  inputValidation: InputValidation;
  
  // Output validation
  outputValidation: OutputValidation;
  
  // Rate limiting
  rateLimiting?: RateLimiting;
  
  // Custom rules
  customRules?: GuardrailRule[];
}

export interface ContentFilter {
  type: "toxicity" | "bias" | "pii" | "profanity" | "custom";
  enabled: boolean;
  threshold?: number;
  action: "block" | "warn" | "log";
}

export interface InputValidation {
  maxLength: number;
  minLength?: number;
  blockedPatterns?: string[];
  requiredPatterns?: string[];
  languageFilter?: string[];
}

export interface OutputValidation {
  maxLength: number;
  formatValidation?: boolean;
  factCheckEnabled?: boolean;
  citationRequired?: boolean;
}

export interface RateLimiting {
  requestsPerMinute: number;
  tokensPerMinute: number;
  concurrent: number;
}

export interface GuardrailRule {
  name: string;
  description?: string;
  condition: string;
  action: "block" | "modify" | "warn" | "log";
  message?: string;
}

// =============================================================================
// VERSIONING
// =============================================================================

export interface AgentVersion {
  id: AgentVersionId;
  agentId: CustomAgentId;
  version: string;
  
  // Changes
  changelog: string;
  
  // Snapshot
  configSnapshot: Partial<CustomAgent>;
  
  // Training
  trainingJobId?: TrainingJobId;
  adapterId?: AdapterId;
  
  // Performance
  benchmarks?: Record<string, number>;
  
  // Status
  status: "draft" | "released" | "deprecated";
  
  createdAt: number;
  createdBy?: string;
}

// =============================================================================
// METRICS
// =============================================================================

export interface AgentMetrics {
  // Usage
  totalConversations: number;
  totalMessages: number;
  totalTokensUsed: number;
  
  // Performance
  averageResponseTime: number;
  averageTokensPerResponse: number;
  
  // Quality
  userSatisfactionScore?: number;
  taskCompletionRate?: number;
  
  // Errors
  errorRate: number;
  guardrailTriggers: number;
  
  // Time-based
  dailyUsage?: { date: string; count: number }[];
  
  // Tool usage
  toolUsage?: { toolId: string; count: number }[];
}

// =============================================================================
// AGENT FACTORY API REQUESTS/RESPONSES
// =============================================================================

export interface CreateAgentRequest {
  name: string;
  displayName: string;
  description: string;
  type: AgentType;
  personality?: AgentPersonality;
  
  // Model
  baseModel: AgentBaseModel;
  
  // Behavior
  systemPrompt: string;
  behaviorConfig?: Partial<AgentBehaviorConfig>;
  
  // Training (optional)
  trainingConfig?: AgentTrainingConfig;
  
  // Guardrails
  guardrails?: Partial<AgentGuardrails>;
  
  // Metadata
  tags?: string[];
  avatar?: string;
}

export interface UpdateAgentRequest {
  id: CustomAgentId;
  name?: string;
  displayName?: string;
  description?: string;
  systemPrompt?: string;
  behaviorConfig?: Partial<AgentBehaviorConfig>;
  guardrails?: Partial<AgentGuardrails>;
  tags?: string[];
  avatar?: string;
}

export interface StartAgentTrainingRequest {
  agentId: CustomAgentId;
  config: AgentTrainingConfig;
}

export interface ImportAdapterToAgentRequest {
  agentId: CustomAgentId;
  adapterPath: string;
  name: string;
  description?: string;
}

export interface AddSkillRequest {
  agentId: CustomAgentId;
  skill: Omit<AgentSkill, "id" | "createdAt">;
}

export interface AddToolRequest {
  agentId: CustomAgentId;
  tool: Omit<AgentTool, "id" | "usageCount" | "lastUsedAt">;
}

export interface ConnectKnowledgeBaseRequest {
  agentId: CustomAgentId;
  knowledgeBaseId: string;
  accessMode: "full" | "query_only" | "summary_only";
  retrievalConfig?: Partial<RetrievalConfig>;
}

export interface AgentListResponse {
  agents: CustomAgent[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AgentTestRequest {
  agentId: CustomAgentId;
  input: string;
  context?: string;
  adapterId?: AdapterId;
}

export interface AgentTestResponse {
  output: string;
  reasoning?: string;
  toolCalls?: any[];
  tokensUsed: number;
  responseTimeMs: number;
  adapterId?: AdapterId;
}

// =============================================================================
// EVENTS
// =============================================================================

export type AgentFactoryEvent =
  | { type: "agent_created"; agent: CustomAgent }
  | { type: "agent_updated"; agent: CustomAgent }
  | { type: "agent_deleted"; agentId: CustomAgentId }
  | { type: "training_started"; agentId: CustomAgentId; jobId: TrainingJobId }
  | { type: "training_progress"; agentId: CustomAgentId; progress: TrainingProgress }
  | { type: "training_completed"; agentId: CustomAgentId; adapter: AgentAdapter }
  | { type: "training_failed"; agentId: CustomAgentId; error: string }
  | { type: "adapter_loaded"; agentId: CustomAgentId; adapterId: AdapterId }
  | { type: "adapter_unloaded"; agentId: CustomAgentId; adapterId: AdapterId };

export interface AgentFactoryEventCallback {
  (event: AgentFactoryEvent): void;
}

// =============================================================================
// TEMPLATES
// =============================================================================

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: AgentType;
  
  // Preview
  previewPrompt?: string;
  previewResponse?: string;
  
  // Config
  config: Partial<CreateAgentRequest>;
  
  // Training preset
  trainingPreset?: AgentTrainingConfig;
  
  // Popularity
  usageCount?: number;
  rating?: number;
  
  // Source
  source: "builtin" | "community" | "custom";
  author?: string;
  
  createdAt: number;
}

// =============================================================================
// MARKETPLACE INTEGRATION
// =============================================================================

export interface AgentMarketplaceListing {
  id: string;
  agentId: CustomAgentId;
  
  // Listing info
  title: string;
  description: string;
  shortDescription: string;
  
  // Media
  icon?: string;
  screenshots?: string[];
  demoVideo?: string;
  
  // Pricing
  pricing: "free" | "paid" | "subscription";
  price?: number;
  currency?: string;
  
  // Stats
  downloads: number;
  rating: number;
  reviews: number;
  
  // Compatibility
  requiredCapabilities?: AgentCapability[];
  minGPUMemory?: number;
  
  // Status
  status: "draft" | "pending" | "published" | "rejected";
  
  publishedAt?: number;
  updatedAt: number;
}
