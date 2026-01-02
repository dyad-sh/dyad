/**
 * Unified Asset Types for JoyCreate Asset Studio
 * All asset types that can be created locally and monetized on JoyMarketplace
 */

// Base asset interface
export interface BaseAsset {
  id: string;
  name: string;
  description?: string;
  version: string;
  author: string;
  license: "free" | "commercial" | "subscription" | "pay-per-use";
  tags: string[];
  category: string;
  thumbnail?: string;
  readme?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  marketplaceId?: string;
  price?: number;
  downloads?: number;
  rating?: number;
}

// ==================== DATASETS ====================
export interface DatasetAsset extends BaseAsset {
  type: "dataset";
  format: "json" | "csv" | "parquet" | "jsonl" | "sqlite";
  schema: DatasetSchema;
  rowCount: number;
  sizeBytes: number;
  filePath: string;
  source?: "scraping" | "upload" | "generated" | "api" | "manual";
}

export interface DatasetSchema {
  fields: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "date" | "array" | "object";
    nullable: boolean;
    description?: string;
  }>;
}

// ==================== MODELS ====================
export interface ModelAsset extends BaseAsset {
  type: "model";
  modelType: "llm" | "embedding" | "classifier" | "regressor" | "image" | "audio" | "custom";
  framework: "pytorch" | "tensorflow" | "onnx" | "gguf" | "safetensors" | "custom";
  baseModel?: string;
  parameters?: number;
  quantization?: "fp32" | "fp16" | "int8" | "int4";
  contextLength?: number;
  inputFormat: string;
  outputFormat: string;
  filePath: string;
  configPath?: string;
  requirements?: string[];
}

// ==================== ALGORITHMS ====================
export interface AlgorithmAsset extends BaseAsset {
  type: "algorithm";
  language: "python" | "javascript" | "typescript" | "rust" | "go";
  algorithmType: "data-processing" | "ml-training" | "inference" | "optimization" | "analytics" | "automation" | "utility";
  entryPoint: string;
  inputs: AlgorithmIO[];
  outputs: AlgorithmIO[];
  dependencies: string[];
  filePath: string;
  testPath?: string;
  benchmarks?: {
    speed: string;
    memory: string;
    accuracy?: number;
  };
}

export interface AlgorithmIO {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  default?: any;
}

// ==================== SCHEMAS ====================
export interface SchemaAsset extends BaseAsset {
  type: "schema";
  schemaType: "json-schema" | "openapi" | "graphql" | "protobuf" | "avro" | "sql" | "drizzle" | "prisma";
  format: "json" | "yaml" | "graphql" | "proto" | "sql";
  content: string;
  filePath: string;
  entities?: string[];
  endpoints?: string[];
  validationRules?: Record<string, any>;
}

// ==================== AGENTS ====================
export interface AgentAsset extends BaseAsset {
  type: "agent";
  agentType: "conversational" | "task" | "autonomous" | "multi-agent" | "rag" | "tool-use";
  model: string;
  systemPrompt: string;
  tools: AgentTool[];
  knowledgeBases?: string[];
  memory?: "none" | "short-term" | "long-term" | "vector";
  configPath: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentTool {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: string;
}

// ==================== UI COMPONENTS ====================
export interface UIComponentAsset extends BaseAsset {
  type: "ui-component";
  componentType: "widget" | "page" | "layout" | "form" | "chart" | "table" | "card" | "modal" | "navigation";
  framework: "react" | "vue" | "svelte" | "html" | "web-component";
  styling: "tailwind" | "css" | "styled-components" | "css-modules" | "shadcn";
  responsive: boolean;
  darkMode: boolean;
  props: ComponentProp[];
  previewUrl?: string;
  filePath: string;
  dependencies: string[];
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  default?: any;
  description?: string;
}

// ==================== TEMPLATES ====================
export interface TemplateAsset extends BaseAsset {
  type: "template";
  templateType: "app" | "landing-page" | "dashboard" | "ecommerce" | "blog" | "portfolio" | "saas" | "document" | "email";
  stack: string[];
  features: string[];
  pages: string[];
  filePath: string;
  previewUrl?: string;
  setupInstructions?: string;
}

// ==================== WORKFLOWS ====================
export interface WorkflowAsset extends BaseAsset {
  type: "workflow";
  workflowType: "automation" | "data-pipeline" | "ai-chain" | "integration" | "etl" | "notification";
  platform: "n8n" | "zapier" | "make" | "custom" | "langchain";
  triggers: WorkflowTrigger[];
  actions: WorkflowAction[];
  connections: string[];
  filePath: string;
  schedule?: string;
}

export interface WorkflowTrigger {
  type: "webhook" | "schedule" | "event" | "manual" | "file";
  config: Record<string, any>;
}

export interface WorkflowAction {
  id: string;
  type: string;
  config: Record<string, any>;
  next?: string[];
}

// ==================== PROMPTS ====================
export interface PromptAsset extends BaseAsset {
  type: "prompt";
  promptType: "system" | "user" | "chain" | "few-shot" | "cot" | "rag";
  targetModel?: string;
  content: string;
  variables: PromptVariable[];
  examples?: Array<{ input: string; output: string }>;
  filePath: string;
  testCases?: Array<{ input: Record<string, string>; expectedOutput?: string }>;
}

export interface PromptVariable {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  required: boolean;
  default?: any;
}

// ==================== APIS ====================
export interface APIAsset extends BaseAsset {
  type: "api";
  apiType: "rest" | "graphql" | "grpc" | "websocket" | "trpc";
  baseUrl?: string;
  authentication: "none" | "api-key" | "oauth2" | "jwt" | "basic";
  endpoints: APIEndpoint[];
  rateLimits?: { requests: number; window: string };
  filePath: string;
  sdkPath?: string;
}

export interface APIEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  description?: string;
  requestSchema?: Record<string, any>;
  responseSchema?: Record<string, any>;
  examples?: Array<{ request: any; response: any }>;
}

// ==================== PLUGINS ====================
export interface PluginAsset extends BaseAsset {
  type: "plugin";
  pluginType: "integration" | "extension" | "connector" | "transformer" | "validator";
  targetPlatform: "joycreate" | "vscode" | "browser" | "node" | "electron";
  hooks: string[];
  settings: PluginSetting[];
  filePath: string;
  permissions?: string[];
}

export interface PluginSetting {
  key: string;
  type: "string" | "number" | "boolean" | "select" | "multiselect";
  label: string;
  default?: any;
  options?: Array<{ value: any; label: string }>;
}

// ==================== TRAINING DATA ====================
export interface TrainingDataAsset extends BaseAsset {
  type: "training-data";
  dataType: "instruction" | "conversation" | "qa" | "classification" | "ner" | "summarization" | "translation";
  format: "jsonl" | "parquet" | "csv" | "hf-dataset";
  samples: number;
  splitRatio?: { train: number; validation: number; test: number };
  quality?: "raw" | "cleaned" | "curated" | "verified";
  filePath: string;
  labelSchema?: Record<string, any>;
}

// ==================== EMBEDDINGS ====================
export interface EmbeddingAsset extends BaseAsset {
  type: "embedding";
  embeddingType: "document" | "code" | "image" | "audio" | "multimodal";
  model: string;
  dimensions: number;
  vectorCount: number;
  indexType: "flat" | "hnsw" | "ivf" | "pq";
  similarity: "cosine" | "euclidean" | "dot-product";
  filePath: string;
  metadataPath?: string;
}

// Union type of all assets
export type Asset =
  | DatasetAsset
  | ModelAsset
  | AlgorithmAsset
  | SchemaAsset
  | AgentAsset
  | UIComponentAsset
  | TemplateAsset
  | WorkflowAsset
  | PromptAsset
  | APIAsset
  | PluginAsset
  | TrainingDataAsset
  | EmbeddingAsset;

export type AssetType = Asset["type"];

// Asset category definitions
export const ASSET_CATEGORIES: Record<AssetType, {
  label: string;
  description: string;
  icon: string;
  color: string;
}> = {
  "dataset": {
    label: "Datasets",
    description: "Structured data collections for training and analysis",
    icon: "Database",
    color: "emerald",
  },
  "model": {
    label: "Models",
    description: "AI/ML models, fine-tuned weights, and configurations",
    icon: "Brain",
    color: "violet",
  },
  "algorithm": {
    label: "Algorithms",
    description: "Reusable code functions and processing logic",
    icon: "Code",
    color: "blue",
  },
  "schema": {
    label: "Schemas",
    description: "Data schemas, API definitions, and type systems",
    icon: "FileJson",
    color: "amber",
  },
  "agent": {
    label: "Agents",
    description: "AI agents with tools, memory, and workflows",
    icon: "Bot",
    color: "pink",
  },
  "ui-component": {
    label: "UI Components",
    description: "Reusable interface components and widgets",
    icon: "Layout",
    color: "cyan",
  },
  "template": {
    label: "Templates",
    description: "Full app templates and starter kits",
    icon: "FileCode",
    color: "orange",
  },
  "workflow": {
    label: "Workflows",
    description: "Automation flows and data pipelines",
    icon: "GitBranch",
    color: "indigo",
  },
  "prompt": {
    label: "Prompts",
    description: "AI prompt templates and chains",
    icon: "MessageSquare",
    color: "rose",
  },
  "api": {
    label: "APIs",
    description: "API definitions and client SDKs",
    icon: "Globe",
    color: "teal",
  },
  "plugin": {
    label: "Plugins",
    description: "Extensions and integrations",
    icon: "Puzzle",
    color: "purple",
  },
  "training-data": {
    label: "Training Data",
    description: "Curated datasets for model fine-tuning",
    icon: "GraduationCap",
    color: "lime",
  },
  "embedding": {
    label: "Embeddings",
    description: "Vector embeddings and indices",
    icon: "Boxes",
    color: "sky",
  },
};

// Marketplace listing
export interface AssetListing {
  asset: Asset;
  pricing: {
    type: "free" | "one-time" | "subscription" | "pay-per-use";
    amount?: number;
    currency?: string;
    billingPeriod?: "monthly" | "yearly";
    usageUnit?: string;
    usagePrice?: number;
  };
  visibility: "public" | "private" | "unlisted";
  status: "draft" | "pending" | "published" | "rejected";
  stats: {
    views: number;
    downloads: number;
    revenue: number;
    rating: number;
    reviews: number;
  };
}

// Asset bundle (collection of assets)
export interface AssetBundle extends BaseAsset {
  type: "bundle";
  assets: Array<{ assetId: string; assetType: AssetType }>;
  bundleType: "starter-kit" | "solution" | "integration-pack" | "learning-path";
}
