/**
 * Model Factory Types
 * Complete type definitions for model training, fine-tuning, and model management
 * with LoRA/QLoRA support for low GPU systems.
 */

// =============================================================================
// BRANDED TYPES
// =============================================================================

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type TrainingJobId = Brand<string, "TrainingJobId">;
export type ModelFactoryId = Brand<string, "ModelFactoryId">;
export type AdapterId = Brand<string, "AdapterId">;
export type DatasetId = Brand<string, "DatasetId">;
export type CheckpointId = Brand<string, "CheckpointId">;

// =============================================================================
// TRAINING METHODS
// =============================================================================

/** Training methods optimized for low GPU memory */
export type TrainingMethod =
  | "lora"           // Low-Rank Adaptation - minimal GPU memory
  | "qlora"          // Quantized LoRA - even lower memory
  | "dora"           // Weight-Decomposed Low-Rank Adaptation
  | "adalora"        // Adaptive LoRA
  | "prefix-tuning"  // Prefix tuning for lightweight fine-tuning
  | "prompt-tuning"  // Soft prompts
  | "ia3"            // Infused Adapter by Inhibiting and Amplifying Inner Activations
  | "lokr"           // Low-Rank Kronecker Product
  | "oft"            // Orthogonal Fine-Tuning
  | "full";          // Full fine-tuning (requires more GPU)

export type QuantizationMethod =
  | "none"
  | "4bit"           // 4-bit quantization
  | "8bit"           // 8-bit quantization
  | "nf4"            // Normal Float 4
  | "fp4"            // Float Point 4
  | "gptq"           // GPTQ quantization
  | "awq"            // Activation-aware Weight Quantization
  | "ggml";          // GGML quantization (for llama.cpp)

export type TrainingBackend =
  | "transformers"   // HuggingFace Transformers
  | "unsloth"        // Unsloth - 2x faster, 60% less memory
  | "axolotl"        // Axolotl framework
  | "llamafactory"   // LLaMA-Factory
  | "mlx"            // Apple MLX (for Mac)
  | "onnx"           // ONNX Runtime Training
  | "trl";           // TRL (Transformer Reinforcement Learning)

// =============================================================================
// MODEL FACTORY CONFIGURATION
// =============================================================================

export interface ModelFactoryConfig {
  id: ModelFactoryId;
  name: string;
  description?: string;
  
  // Paths
  modelsDir: string;
  datasetsDir: string;
  checkpointsDir: string;
  outputDir: string;
  cacheDir?: string;
  
  // Default settings
  defaultBackend: TrainingBackend;
  defaultMethod: TrainingMethod;
  defaultQuantization: QuantizationMethod;
  
  // GPU configuration
  gpuConfig: GPUConfig;
  
  // Memory optimization
  memoryConfig: MemoryConfig;
  
  createdAt: number;
  updatedAt: number;
}

export interface GPUConfig {
  // Auto-detect or manual
  autoDetect: boolean;
  
  // Detected/configured values
  hasGPU: boolean;
  gpuType?: "nvidia" | "amd" | "intel" | "apple" | "none";
  gpuName?: string;
  vramTotal?: number;  // MB
  vramAvailable?: number;
  cudaVersion?: string;
  
  // Optimization flags
  useFlashAttention: boolean;
  useBetterTransformer: boolean;
  useTensorCores: boolean;
  
  // Multi-GPU
  multiGPU: boolean;
  gpuIds?: number[];
  parallelMode?: "data" | "model" | "pipeline";
}

export interface MemoryConfig {
  // CPU offloading for low VRAM
  cpuOffload: boolean;
  offloadRatio: number;  // 0-1, portion to offload
  
  // Gradient checkpointing
  gradientCheckpointing: boolean;
  checkpointingRatio?: number;
  
  // Memory limits
  maxGPUMemory?: number;  // MB
  maxCPUMemory?: number;  // MB
  
  // Optimization techniques
  useDeepSpeed: boolean;
  deepSpeedStage?: 1 | 2 | 3;
  useFSDP: boolean;  // Fully Sharded Data Parallel
  
  // Cache
  useDiskCache: boolean;
  cacheSize?: number;  // MB
}

// =============================================================================
// TRAINING JOB
// =============================================================================

export type TrainingStatus =
  | "queued"
  | "initializing"
  | "loading_model"
  | "loading_dataset"
  | "training"
  | "evaluating"
  | "saving"
  | "merging"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface TrainingJob {
  id: TrainingJobId;
  name: string;
  description?: string;
  
  // Model
  baseModel: BaseModelConfig;
  outputModel?: OutputModelConfig;
  
  // Training method
  method: TrainingMethod;
  methodConfig: TrainingMethodConfig;
  
  // Dataset
  dataset: DatasetConfig;
  
  // Hyperparameters
  hyperparameters: TrainingHyperparameters;
  
  // Hardware
  backend: TrainingBackend;
  gpuConfig?: GPUConfig;
  memoryConfig?: MemoryConfig;
  
  // Status
  status: TrainingStatus;
  progress: TrainingProgress;
  error?: TrainingError;
  
  // Checkpoints
  checkpoints: TrainingCheckpoint[];
  bestCheckpoint?: CheckpointId;
  
  // Metrics
  metrics: TrainingMetrics;
  evaluationResults?: EvaluationResults;
  
  // Timing
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  estimatedCompletion?: number;
  
  // Metadata
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface BaseModelConfig {
  // Source
  source: "huggingface" | "local" | "ollama" | "url";
  modelId: string;  // HF model ID or local path
  revision?: string;  // Git revision/branch
  
  // Model info
  modelType: "llama" | "mistral" | "qwen" | "phi" | "gemma" | "gpt2" | "falcon" | "mpt" | "custom";
  architecture?: string;
  parameters?: number;
  contextLength?: number;
  
  // Quantization for loading
  loadQuantization?: QuantizationMethod;
  loadIn8bit?: boolean;
  loadIn4bit?: boolean;
  
  // Trust/access
  trustRemoteCode?: boolean;
  useAuthToken?: boolean;
  tokenEnvVar?: string;
}

export interface OutputModelConfig {
  // Output
  outputDir: string;
  outputName: string;
  
  // Format
  saveFormat: "safetensors" | "pytorch" | "gguf" | "onnx" | "mlx";
  
  // Merge options
  mergeAdapter: boolean;
  mergeMethod?: "linear" | "ties" | "dare" | "passthrough";
  
  // Quantization for export
  exportQuantization?: QuantizationMethod;
  ggufQuantTypes?: string[];  // For GGUF export: "Q4_K_M", "Q5_K_M", etc.
  
  // Push to hub
  pushToHub?: boolean;
  hubModelId?: string;
  hubPrivate?: boolean;
}

// =============================================================================
// TRAINING METHOD CONFIGS
// =============================================================================

export type TrainingMethodConfig =
  | LoRAConfig
  | QLoRAConfig
  | DoRAConfig
  | AdaLoRAConfig
  | PrefixTuningConfig
  | PromptTuningConfig
  | IA3Config
  | LoKrConfig
  | OFTConfig
  | FullFineTuningConfig;

export interface LoRAConfig {
  method: "lora";
  
  // LoRA parameters
  rank: number;              // r: typically 8-64, lower = less memory
  alpha: number;             // scaling factor, typically rank * 2
  dropout: number;           // 0-0.3
  
  // Target modules
  targetModules: string[];   // e.g., ["q_proj", "v_proj", "k_proj", "o_proj"]
  modulesToSave?: string[];  // Additional modules to train
  
  // Bias
  bias: "none" | "all" | "lora_only";
  
  // Fan in/out
  fanInFanOut?: boolean;
  
  // RSLoRA
  useRSLoRA?: boolean;
  
  // DoRA features (without full DoRA)
  useDora?: boolean;
}

export interface QLoRAConfig extends LoRAConfig {
  method: "qlora";
  
  // Quantization
  bitsAndBytes: {
    load4bit: boolean;
    bnb4bitComputeDtype: "float16" | "bfloat16" | "float32";
    bnb4bitQuantType: "nf4" | "fp4";
    bnb4bitUseDoubleQuant: boolean;
  };
}

export interface DoRAConfig extends LoRAConfig {
  method: "dora";
  
  // DoRA specific
  ephemeralGpuOffload: boolean;
}

export interface AdaLoRAConfig extends LoRAConfig {
  method: "adalora";
  
  // AdaLoRA specific - adaptive rank
  initRank: number;
  targetRank: number;
  deltaT: number;
  beta1: number;
  beta2: number;
  orthoLambda: number;
  totalStep?: number;
  warmupSteps?: number;
}

export interface PrefixTuningConfig {
  method: "prefix-tuning";
  
  numVirtualTokens: number;
  prefixProjection: boolean;
  encoderHiddenSize?: number;
  tokenDim?: number;
  numTransformerSubmodules?: number;
  numAttentionHeads?: number;
  numLayers?: number;
}

export interface PromptTuningConfig {
  method: "prompt-tuning";
  
  numVirtualTokens: number;
  promptTuningInitText?: string;
  tokenizerNameOrPath?: string;
  tokenizerKwargs?: Record<string, unknown>;
}

export interface IA3Config {
  method: "ia3";
  
  targetModules: string[];
  feedforwardModules: string[];
  initIA3Weights: boolean;
}

export interface LoKrConfig {
  method: "lokr";
  
  rank: number;
  alpha: number;
  targetModules: string[];
  decomposeBoth: boolean;
  factorHalf: boolean;
}

export interface OFTConfig {
  method: "oft";
  
  rank: number;
  targetModules: string[];
  moduleDropout: number;
  initWeights: boolean;
}

export interface FullFineTuningConfig {
  method: "full";
  
  freezeLayers?: string[];  // Layers to freeze
  unfreezeLastN?: number;   // Unfreeze last N layers only
}

// =============================================================================
// DATASET
// =============================================================================

export type DatasetFormat =
  | "alpaca"           // Instruction format
  | "sharegpt"         // ShareGPT conversation format
  | "dolly"            // Databricks Dolly format
  | "oasst"            // OpenAssistant format
  | "vicuna"           // Vicuna format
  | "raw"              // Raw text
  | "completion"       // Prompt-completion pairs
  | "chat"             // Multi-turn chat
  | "custom";          // Custom template

export interface DatasetConfig {
  id?: DatasetId;
  
  // Source
  source: "huggingface" | "local" | "json" | "jsonl" | "csv" | "parquet";
  path: string;
  subset?: string;
  revision?: string;
  
  // Format
  format: DatasetFormat;
  template?: DatasetTemplate;
  
  // Columns
  textColumn?: string;
  instructionColumn?: string;
  inputColumn?: string;
  outputColumn?: string;
  systemColumn?: string;
  conversationsColumn?: string;
  
  // Processing
  maxLength?: number;
  truncation?: boolean;
  padding?: boolean;
  
  // Split
  trainSplit?: string;
  evalSplit?: string;
  testSplit?: string;
  validationRatio?: number;
  
  // Filtering
  minLength?: number;
  maxSamples?: number;
  shuffle?: boolean;
  seed?: number;
}

export interface DatasetTemplate {
  // Template string with placeholders
  promptTemplate: string;
  responseTemplate?: string;
  systemTemplate?: string;
  
  // Separators
  inputSeparator?: string;
  outputSeparator?: string;
  
  // Special tokens
  bosToken?: string;
  eosToken?: string;
  padToken?: string;
}

// =============================================================================
// HYPERPARAMETERS
// =============================================================================

export interface TrainingHyperparameters {
  // Basic
  epochs: number;
  batchSize: number;
  microBatchSize?: number;
  gradientAccumulationSteps: number;
  
  // Learning rate
  learningRate: number;
  lrScheduler: LRSchedulerType;
  warmupSteps?: number;
  warmupRatio?: number;
  
  // Optimizer
  optimizer: OptimizerType;
  adamBeta1?: number;
  adamBeta2?: number;
  adamEpsilon?: number;
  weightDecay?: number;
  
  // Regularization
  maxGradNorm?: number;
  dropout?: number;
  labelSmoothing?: number;
  
  // Precision
  mixedPrecision: "no" | "fp16" | "bf16";
  tf32?: boolean;
  
  // Evaluation
  evalSteps?: number;
  evalBatchSize?: number;
  evalAccumulation?: number;
  
  // Saving
  saveSteps?: number;
  saveTotalLimit?: number;
  saveOnlyModel?: boolean;
  
  // Logging
  loggingSteps?: number;
  reportTo?: ("tensorboard" | "wandb" | "none")[];
  
  // Early stopping
  earlyStoppingPatience?: number;
  earlyStoppingThreshold?: number;
  earlyStoppingMetric?: string;
  
  // Reproducibility
  seed?: number;
  
  // NEFTune (Noise Embeddings)
  neftuneNoiseAlpha?: number;
  
  // Group samples by length
  groupByLength?: boolean;
}

export type LRSchedulerType =
  | "linear"
  | "cosine"
  | "cosine_with_restarts"
  | "polynomial"
  | "constant"
  | "constant_with_warmup"
  | "inverse_sqrt"
  | "reduce_lr_on_plateau";

export type OptimizerType =
  | "adamw"
  | "adamw_8bit"    // 8-bit AdamW for memory savings
  | "adamw_bnb"     // bitsandbytes AdamW
  | "paged_adamw"   // Paged AdamW for CPU offload
  | "paged_adamw_8bit"
  | "sgd"
  | "adagrad"
  | "adafactor"
  | "lion"
  | "lion_8bit";

// =============================================================================
// PROGRESS & METRICS
// =============================================================================

export interface TrainingProgress {
  // Overall
  phase: TrainingStatus;
  percentage: number;
  
  // Epochs
  currentEpoch: number;
  totalEpochs: number;
  
  // Steps
  currentStep: number;
  totalSteps: number;
  
  // Current batch
  currentBatch?: number;
  batchesPerEpoch?: number;
  
  // Time
  elapsedTime: number;
  estimatedTimeRemaining?: number;
  tokensPerSecond?: number;
  samplesPerSecond?: number;
  
  // Memory
  gpuMemoryUsed?: number;
  gpuMemoryTotal?: number;
  cpuMemoryUsed?: number;
  
  // Current metrics
  currentLoss?: number;
  currentLearningRate?: number;
}

export interface TrainingMetrics {
  // Loss history
  trainLoss: LossDataPoint[];
  evalLoss?: LossDataPoint[];
  
  // Learning rate history
  learningRateHistory: { step: number; lr: number }[];
  
  // Gradient norms
  gradientNorms?: { step: number; norm: number }[];
  
  // Custom metrics
  customMetrics?: Record<string, MetricDataPoint[]>;
  
  // Summary
  bestTrainLoss?: number;
  bestEvalLoss?: number;
  bestStep?: number;
  
  // Timing
  totalTrainingTime?: number;
  averageStepTime?: number;
}

export interface LossDataPoint {
  step: number;
  epoch: number;
  loss: number;
  timestamp: number;
}

export interface MetricDataPoint {
  step: number;
  epoch: number;
  value: number;
  timestamp: number;
}

// =============================================================================
// CHECKPOINTS
// =============================================================================

export interface TrainingCheckpoint {
  id: CheckpointId;
  jobId: TrainingJobId;
  
  // Location
  path: string;
  
  // Training state
  epoch: number;
  step: number;
  
  // Metrics at checkpoint
  trainLoss: number;
  evalLoss?: number;
  
  // Size
  sizeBytes: number;
  
  // Flags
  isBest: boolean;
  isLatest: boolean;
  
  // Timing
  createdAt: number;
}

// =============================================================================
// EVALUATION
// =============================================================================

export interface EvaluationResults {
  // Basic metrics
  evalLoss: number;
  perplexity: number;
  
  // Generation metrics
  bleuScore?: number;
  rougeScores?: {
    rouge1: number;
    rouge2: number;
    rougeL: number;
    rougeLsum: number;
  };
  
  // Accuracy metrics
  accuracy?: number;
  f1Score?: number;
  exactMatch?: number;
  
  // Benchmark results
  benchmarks?: BenchmarkResult[];
  
  // Human evaluation
  humanEvaluation?: HumanEvalResult[];
  
  // Samples
  generatedSamples?: GenerationSample[];
}

export interface BenchmarkResult {
  name: string;
  score: number;
  details?: Record<string, number>;
  timestamp: number;
}

export interface HumanEvalResult {
  evaluatorId: string;
  rating: number;  // 1-5
  feedback?: string;
  timestamp: number;
}

export interface GenerationSample {
  prompt: string;
  expected?: string;
  generated: string;
  metrics?: Record<string, number>;
}

// =============================================================================
// ERRORS
// =============================================================================

export interface TrainingError {
  code: TrainingErrorCode;
  message: string;
  details?: string;
  stack?: string;
  timestamp: number;
  
  // Recovery
  recoverable: boolean;
  suggestedAction?: string;
}

export type TrainingErrorCode =
  | "OUT_OF_MEMORY"
  | "MODEL_NOT_FOUND"
  | "DATASET_NOT_FOUND"
  | "INVALID_CONFIG"
  | "CUDA_ERROR"
  | "CHECKPOINT_ERROR"
  | "NETWORK_ERROR"
  | "PERMISSION_ERROR"
  | "CANCELLED"
  | "UNKNOWN";

// =============================================================================
// ADAPTERS (LoRA weights)
// =============================================================================

export interface LoRAAdapter {
  id: AdapterId;
  name: string;
  description?: string;
  
  // Source
  trainingJobId?: TrainingJobId;
  source: "trained" | "imported" | "hub";
  
  // Base model compatibility
  baseModelId: string;
  baseModelType: string;
  
  // Adapter info
  method: TrainingMethod;
  rank: number;
  alpha: number;
  targetModules: string[];
  
  // Files
  path: string;
  configPath?: string;
  sizeBytes: number;
  
  // Merge status
  isMerged: boolean;
  mergedModelPath?: string;
  
  // Performance
  evalLoss?: number;
  benchmarkScores?: Record<string, number>;
  
  // Metadata
  tags?: string[];
  metadata?: Record<string, unknown>;
  
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// MODEL FACTORY API REQUESTS/RESPONSES
// =============================================================================

export interface CreateTrainingJobRequest {
  name: string;
  description?: string;
  
  baseModel: BaseModelConfig;
  method: TrainingMethod;
  methodConfig: Partial<TrainingMethodConfig>;
  dataset: DatasetConfig;
  hyperparameters: Partial<TrainingHyperparameters>;
  
  outputConfig?: Partial<OutputModelConfig>;
  gpuConfig?: Partial<GPUConfig>;
  memoryConfig?: Partial<MemoryConfig>;
  backend?: TrainingBackend;
  
  tags?: string[];
}

export interface UpdateTrainingJobRequest {
  id: TrainingJobId;
  name?: string;
  description?: string;
  hyperparameters?: Partial<TrainingHyperparameters>;
  tags?: string[];
}

export interface TrainingJobListResponse {
  jobs: TrainingJob[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StartTrainingRequest {
  jobId: TrainingJobId;
  resume?: boolean;
  fromCheckpoint?: CheckpointId;
}

export interface ExportModelRequest {
  jobId: TrainingJobId;
  format: "safetensors" | "pytorch" | "gguf" | "onnx" | "mlx";
  quantization?: QuantizationMethod;
  ggufQuantTypes?: string[];
  mergeAdapter?: boolean;
  outputPath?: string;
}

export interface ImportAdapterRequest {
  name: string;
  path: string;
  baseModelId: string;
  description?: string;
}

// =============================================================================
// SYSTEM INFO
// =============================================================================

export interface SystemCapabilities {
  // GPU
  hasGPU: boolean;
  gpuInfo?: GPUInfo[];
  
  // CPU
  cpuCores: number;
  cpuModel: string;
  
  // Memory
  totalRAM: number;
  availableRAM: number;
  
  // Storage
  availableStorage: number;
  
  // Dependencies
  hasPython: boolean;
  pythonVersion?: string;
  hasTorch: boolean;
  torchVersion?: string;
  hasCuda: boolean;
  cudaVersion?: string;
  hasTransformers: boolean;
  transformersVersion?: string;
  hasBitsAndBytes: boolean;
  hasUnsloth: boolean;
  
  // Recommended settings
  recommendedMethod: TrainingMethod;
  recommendedQuantization: QuantizationMethod;
  maxBatchSize: number;
  recommendedBackend: TrainingBackend;
}

export interface GPUInfo {
  index: number;
  name: string;
  vendor: "nvidia" | "amd" | "intel" | "apple";
  vramTotal: number;
  vramUsed: number;
  vramFree: number;
  computeCapability?: string;
  driverVersion?: string;
  temperature?: number;
  utilization?: number;
}

// =============================================================================
// EVENTS
// =============================================================================

export type TrainingEvent =
  | { type: "status_changed"; jobId: TrainingJobId; status: TrainingStatus }
  | { type: "progress_updated"; jobId: TrainingJobId; progress: TrainingProgress }
  | { type: "metrics_updated"; jobId: TrainingJobId; metrics: Partial<TrainingMetrics> }
  | { type: "checkpoint_saved"; jobId: TrainingJobId; checkpoint: TrainingCheckpoint }
  | { type: "error"; jobId: TrainingJobId; error: TrainingError }
  | { type: "completed"; jobId: TrainingJobId; results: EvaluationResults };

export interface TrainingEventCallback {
  (event: TrainingEvent): void;
}
