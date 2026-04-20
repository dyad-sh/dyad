/**
 * Enhanced Neural Builder Types
 *
 * Complete ML/AI model development studio. Existing builder has:
 * - Overview, Designer, Training, Transfer Learning, A/B Tests, Analytics,
 *   Edge Deploy, Integrations (8 tabs)
 *
 * We ADD:
 * 1. MODEL ZOO: Browse & download pre-trained models (HuggingFace, Ollama, ONNX Hub)
 * 2. DATASET STUDIO: Upload, annotate, augment, split, version datasets
 * 3. EXPERIMENT TRACKER: MLflow-style experiment comparison
 * 4. HYPERPARAMETER TUNING: Grid search, random search, Bayesian optimization
 * 5. MODEL EVALUATION: Comprehensive metrics, confusion matrices, ROC curves
 * 6. FINE-TUNING: LoRA, QLoRA, full fine-tune with custom data
 * 7. PROMPT ENGINEERING: Test prompts, build prompt pipelines, A/B test prompts
 * 8. RAG BUILDER: Vector store, embeddings, retrieval pipeline builder
 * 9. MODEL QUANTIZATION: INT8, INT4, GPTQ, AWQ for size reduction
 * 10. SERVING & INFERENCE: Deploy models as APIs, batch inference
 * 11. MODEL COMPARISON: Side-by-side eval with same inputs
 * 12. PIPELINE BUILDER: Drag-and-drop ML pipeline (data → preprocess → train → eval → deploy)
 * 13. COST ESTIMATOR: Token costs, compute costs, ROI calculator
 * 14. SAFETY & ALIGNMENT: Red-teaming, guardrails, content filtering
 * 15. FEDERATED LEARNING: Train across distributed nodes
 * 16. CELESTIA ANCHORING: Model provenance on-chain
 */

// ============================================================================
// MODEL ZOO
// ============================================================================

export type ModelSource = "huggingface" | "ollama" | "onnx-hub" | "pytorch-hub" | "tensorflow-hub" | "joycreate-marketplace" | "local" | "custom";
export type ModelFramework = "pytorch" | "tensorflow" | "onnx" | "jax" | "gguf" | "safetensors" | "custom";
export type ModelTask =
  | "text-generation"
  | "text-classification"
  | "token-classification"
  | "question-answering"
  | "summarization"
  | "translation"
  | "fill-mask"
  | "image-classification"
  | "object-detection"
  | "image-segmentation"
  | "image-generation"
  | "audio-classification"
  | "speech-recognition"
  | "text-to-speech"
  | "embedding"
  | "reranking"
  | "code-generation"
  | "multi-modal"
  | "reinforcement-learning"
  | "tabular"
  | "custom"
  ;

export interface ModelZooEntry {
  id: string;
  name: string;
  source: ModelSource;
  task: ModelTask;
  framework: ModelFramework;
  description: string;
  
  /** Model specs */
  parameters: number; // in billions
  contextLength: number;
  languages: string[];
  license: string;
  
  /** Files */
  size: number; // bytes
  quantizations: QuantizationVariant[];
  
  /** Performance */
  benchmarks: ModelBenchmark[];
  
  /** Metadata */
  author: string;
  tags: string[];
  downloads: number;
  likes: number;
  lastUpdated: string;
  
  /** Local status */
  downloadStatus: "not-downloaded" | "downloading" | "downloaded" | "cached";
  localPath?: string;
}

export interface QuantizationVariant {
  name: string;
  method: "fp32" | "fp16" | "bf16" | "int8" | "int4" | "gptq" | "awq" | "gguf-q4" | "gguf-q5" | "gguf-q8";
  size: number;
  perplexityDelta: number;
}

export interface ModelBenchmark {
  name: string;
  metric: string;
  value: number;
  baseline?: number;
  date: string;
}

// ============================================================================
// DATASET STUDIO
// ============================================================================

export interface Dataset {
  id: string;
  name: string;
  description: string;
  type: DatasetType;
  
  /** Storage */
  format: "json" | "jsonl" | "csv" | "parquet" | "arrow" | "hf-datasets" | "sqlite" | "custom";
  size: number;
  rowCount: number;
  columnCount: number;
  
  /** Schema */
  columns: DatasetColumn[];
  
  /** Splits */
  splits: DatasetSplit[];
  
  /** Versioning */
  version: string;
  versions: DatasetVersion[];
  
  /** Quality metrics */
  quality: DatasetQuality;
  
  /** Annotations */
  annotationConfig?: AnnotationConfig;
  
  /** Augmentation */
  augmentations: DataAugmentation[];
  
  /** Celestia anchor */
  celestiaAnchor?: { height: number; hash: string };
  
  createdAt: string;
  updatedAt: string;
}

export type DatasetType = "text" | "chat" | "instruction" | "classification" | "ner" | "qa" | "translation" | "code" | "image" | "audio" | "tabular" | "multi-modal";

export interface DatasetColumn {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "image" | "audio" | "embedding";
  nullable: boolean;
  stats?: {
    nullCount: number;
    uniqueCount: number;
    min?: any;
    max?: any;
    mean?: number;
    std?: number;
    distribution?: Record<string, number>;
  };
}

export interface DatasetSplit {
  name: "train" | "validation" | "test" | string;
  rowCount: number;
  percentage: number;
}

export interface DatasetVersion {
  version: string;
  rowCount: number;
  changes: string;
  createdAt: string;
  hash: string;
}

export interface DatasetQuality {
  overallScore: number;
  issues: DatasetIssue[];
  duplicateRate: number;
  missingRate: number;
  labelDistribution?: Record<string, number>;
  classBalance?: number;
}

export interface DatasetIssue {
  type: "missing-values" | "duplicates" | "class-imbalance" | "outliers" | "format-error" | "encoding-error" | "bias";
  severity: "critical" | "warning" | "info";
  description: string;
  affectedRows: number;
  autoFixAvailable: boolean;
}

export interface AnnotationConfig {
  type: "classification" | "ner" | "qa" | "preference" | "rating" | "custom";
  labels: string[];
  guidelines: string;
  minAnnotatorsPerItem: number;
  progress: { annotated: number; total: number };
}

export interface DataAugmentation {
  id: string;
  name: string;
  type: "synonym-replace" | "back-translate" | "paraphrase" | "noise-inject" | "oversample" | "undersample" | "smote" | "mixup" | "cutout" | "rotation" | "custom";
  config: Record<string, any>;
  applied: boolean;
  addedRows: number;
}

// ============================================================================
// EXPERIMENT TRACKER
// ============================================================================

export interface Experiment {
  id: string;
  name: string;
  description: string;
  projectId: string;
  
  /** Runs */
  runs: ExperimentRun[];
  
  /** Best run */
  bestRunId?: string;
  bestMetric?: { name: string; value: number };
  
  /** Tags */
  tags: string[];
  
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentRun {
  id: string;
  experimentId: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  
  /** Configuration */
  config: {
    model: string;
    datasetId: string;
    hyperparameters: Record<string, any>;
    trainingConfig: TrainingRunConfig;
  };
  
  /** Results */
  metrics: Record<string, number>;
  metricHistory: Record<string, { step: number; value: number }[]>;
  artifacts: ExperimentArtifact[];
  
  /** Resources */
  duration: number;
  tokensUsed: number;
  cost: number;
  gpu?: string;
  
  /** Logs */
  logs: string[];
  
  startedAt?: string;
  completedAt?: string;
}

export interface TrainingRunConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  optimizer: "adam" | "adamw" | "sgd" | "adagrad" | "rmsprop" | "lion";
  scheduler: "linear" | "cosine" | "polynomial" | "constant" | "warmup-cosine";
  warmupSteps: number;
  weightDecay: number;
  gradientAccumulation: number;
  maxGradNorm: number;
  fp16: boolean;
  bf16: boolean;
  evaluationStrategy: "steps" | "epoch";
  evaluationSteps: number;
  saveStrategy: "steps" | "epoch" | "best";
  earlyStopping?: { patience: number; metric: string; direction: "minimize" | "maximize" };
}

export interface ExperimentArtifact {
  name: string;
  type: "model" | "checkpoint" | "plot" | "log" | "config" | "data";
  path: string;
  size: number;
}

// ============================================================================
// HYPERPARAMETER TUNING
// ============================================================================

export interface HyperparameterSearch {
  id: string;
  name: string;
  experimentId: string;
  
  strategy: "grid" | "random" | "bayesian" | "evolutionary" | "hyperband";
  
  /** Parameter space */
  parameterSpace: HyperparameterDef[];
  
  /** Objective */
  objective: {
    metric: string;
    direction: "minimize" | "maximize";
  };
  
  /** Budget */
  maxTrials: number;
  maxDuration: number;
  maxCost: number;
  
  /** Results */
  trials: HyperparameterTrial[];
  bestTrial?: string;
  
  status: "running" | "completed" | "cancelled";
  startedAt: string;
  completedAt?: string;
}

export interface HyperparameterDef {
  name: string;
  type: "float" | "int" | "categorical" | "log-float" | "log-int";
  min?: number;
  max?: number;
  choices?: any[];
  default?: any;
}

export interface HyperparameterTrial {
  id: string;
  number: number;
  parameters: Record<string, any>;
  metrics: Record<string, number>;
  status: "running" | "completed" | "failed" | "pruned";
  duration: number;
  cost: number;
}

// ============================================================================
// FINE-TUNING
// ============================================================================

export interface FineTuneJob {
  id: string;
  name: string;
  
  /** Base model */
  baseModel: string;
  baseModelSource: ModelSource;
  
  /** Method */
  method: "full" | "lora" | "qlora" | "prefix-tuning" | "prompt-tuning" | "adapter";
  
  /** LoRA config */
  loraConfig?: {
    rank: number;
    alpha: number;
    dropout: number;
    targetModules: string[];
    quantization?: "int4" | "int8" | "nf4";
  };
  
  /** Dataset */
  datasetId: string;
  datasetSplit: string;
  
  /** Training */
  trainingConfig: TrainingRunConfig;
  
  /** Status */
  status: "preparing" | "training" | "evaluating" | "completed" | "failed" | "cancelled";
  progress: number;
  currentEpoch: number;
  currentStep: number;
  totalSteps: number;
  
  /** Results */
  metrics?: Record<string, number>;
  outputModelPath?: string;
  
  /** Timing and cost */
  startedAt?: string;
  completedAt?: string;
  estimatedTimeRemaining?: number;
  cost: number;
}

// ============================================================================
// PROMPT ENGINEERING
// ============================================================================

export interface PromptLab {
  id: string;
  name: string;
  
  /** Prompts to test */
  prompts: PromptVariant[];
  
  /** Test cases */
  testCases: PromptTestCase[];
  
  /** Models to test against */
  models: string[];
  
  /** Results */
  results: PromptTestResult[];
  
  /** Best prompt */
  bestPromptId?: string;
  
  createdAt: string;
}

export interface PromptVariant {
  id: string;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: string[];
  temperature: number;
  maxTokens: number;
}

export interface PromptTestCase {
  id: string;
  name: string;
  inputs: Record<string, string>;
  expectedOutput?: string;
  evaluationCriteria: string[];
}

export interface PromptTestResult {
  promptId: string;
  testCaseId: string;
  modelId: string;
  output: string;
  scores: Record<string, number>;
  latency: number;
  tokens: { input: number; output: number };
  cost: number;
}

// ============================================================================
// RAG BUILDER
// ============================================================================

export interface RagPipeline {
  id: string;
  name: string;
  description: string;
  
  /** Document sources */
  sources: RagSource[];
  
  /** Embedding config */
  embedding: {
    model: string;
    dimensions: number;
    chunkSize: number;
    chunkOverlap: number;
    chunkStrategy: "fixed" | "sentence" | "paragraph" | "semantic" | "recursive";
  };
  
  /** Vector store */
  vectorStore: {
    provider: "chroma" | "pinecone" | "weaviate" | "qdrant" | "milvus" | "faiss" | "pgvector" | "in-memory";
    collectionName: string;
    documentCount: number;
    vectorCount: number;
    indexType: string;
  };
  
  /** Retrieval */
  retrieval: {
    strategy: "similarity" | "mmr" | "reranking" | "hybrid" | "multi-query" | "self-query";
    topK: number;
    threshold: number;
    rerankerModel?: string;
  };
  
  /** Generation */
  generation: {
    model: string;
    promptTemplate: string;
    maxTokens: number;
    temperature: number;
    citeSources: boolean;
  };
  
  /** Evaluation */
  evaluation?: RagEvaluation;
  
  status: "building" | "ready" | "updating" | "error";
  createdAt: string;
}

export interface RagSource {
  id: string;
  name: string;
  type: "file" | "url" | "api" | "database" | "notion" | "confluence" | "github" | "gdrive" | "s3";
  path: string;
  documentCount: number;
  lastSync: string;
  autoSync: boolean;
}

export interface RagEvaluation {
  faithfulness: number;
  answerRelevancy: number;
  contextPrecision: number;
  contextRecall: number;
  harmfulness: number;
  testCases: number;
  lastEvaluated: string;
}

// ============================================================================
// MODEL SERVING & INFERENCE
// ============================================================================

export interface ModelServingConfig {
  id: string;
  modelId: string;
  name: string;
  
  /** Deployment */
  target: "local" | "docker" | "kubernetes" | "serverless" | "edge" | "joycreate-cloud";
  endpoint?: string;
  status: "deploying" | "running" | "stopped" | "error" | "scaling";
  
  /** Scaling */
  replicas: number;
  minReplicas: number;
  maxReplicas: number;
  autoScale: boolean;
  
  /** Performance */
  batchSize: number;
  maxConcurrency: number;
  timeoutMs: number;
  
  /** Monitoring */
  requestCount: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  uptime: number;
  
  /** Cost */
  costPerRequest: number;
  totalCost: number;
}

// ============================================================================
// SAFETY & ALIGNMENT
// ============================================================================

export interface SafetyConfig {
  /** Guardrails */
  inputGuardrails: GuardrailRule[];
  outputGuardrails: GuardrailRule[];
  
  /** Red-teaming */
  redTeamResults: RedTeamResult[];
  
  /** Content filtering */
  contentFilter: {
    enabled: boolean;
    categories: ContentCategory[];
    threshold: number;
  };
  
  /** Bias detection */
  biasResults: BiasResult[];
  
  /** Toxicity monitoring */
  toxicityScore: number;
}

export interface GuardrailRule {
  id: string;
  name: string;
  type: "regex" | "classifier" | "semantic" | "length" | "format" | "custom";
  pattern?: string;
  action: "block" | "warn" | "modify" | "log";
  enabled: boolean;
}

export interface RedTeamResult {
  id: string;
  attack: string;
  category: "jailbreak" | "prompt-injection" | "data-extraction" | "bias" | "harmful-content" | "hallucination";
  success: boolean;
  response: string;
  severity: "critical" | "high" | "medium" | "low";
  timestamp: string;
}

export interface ContentCategory {
  name: string;
  enabled: boolean;
  threshold: number;
}

export interface BiasResult {
  dimension: string;
  score: number;
  examples: string[];
  recommendation: string;
}

// ============================================================================
// COST ESTIMATOR
// ============================================================================

export interface CostEstimate {
  /** Training costs */
  training: {
    tokensEstimated: number;
    computeHours: number;
    costEstimate: number;
  };
  
  /** Inference costs */
  inference: {
    requestsPerDay: number;
    avgTokensPerRequest: number;
    dailyCost: number;
    monthlyCost: number;
  };
  
  /** Storage costs */
  storage: {
    modelSize: number;
    datasetSize: number;
    vectorStoreSize: number;
    monthlyCost: number;
  };
  
  /** Total */
  totalMonthly: number;
  roi?: {
    timesSavedPerMonth: number;
    valueSavedPerMonth: number;
    breakEvenMonths: number;
  };
}

// ============================================================================
// ML PIPELINE BUILDER
// ============================================================================

export interface MLPipeline {
  id: string;
  name: string;
  description: string;
  
  /** Nodes in the pipeline */
  nodes: PipelineNode[];
  /** Connections between nodes */
  connections: PipelineConnection[];
  
  /** Execution */
  status: "draft" | "running" | "completed" | "failed";
  runs: MLPipelineRun[];
  
  /** Schedule */
  schedule?: { type: "manual" | "cron" | "trigger"; expression?: string };
  
  createdAt: string;
}

export interface PipelineNode {
  id: string;
  type: "data-source" | "preprocess" | "augment" | "split" | "feature-engineer" | "train" | "evaluate" | "tune" | "quantize" | "export" | "deploy" | "monitor" | "custom";
  name: string;
  config: Record<string, any>;
  position: { x: number; y: number };
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface PipelineConnection {
  from: string;
  to: string;
  dataType: string;
}

export interface MLPipelineRun {
  id: string;
  status: "running" | "completed" | "failed";
  nodeResults: Record<string, { status: string; output: any; duration: number }>;
  totalDuration: number;
  startedAt: string;
  completedAt?: string;
}
