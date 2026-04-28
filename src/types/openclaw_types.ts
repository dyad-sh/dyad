/**
 * OpenClaw Integration Types
 * Types for OpenClaw AI Gateway integration with JoyCreate
 * 
 * OpenClaw provides a local WebSocket gateway that:
 * - Routes messages between AI providers
 * - Supports plugins for channels (WhatsApp, Telegram, etc.)
 * - Enables local-first AI with optional cloud fallback
 */

// =============================================================================
// PROVIDER CONFIGURATION
// =============================================================================

export interface OpenClawAIProvider {
  name: string;
  type: "ollama" | "anthropic" | "openai" | "lmstudio" | "claude-code" | "deepseek" | "google" | "openai-compat" | "custom";
  apiKey?: string;
  baseURL?: string;
  model: string;
  enabled: boolean;
  priority: number; // Lower = higher priority
  capabilities: OpenClawCapability[];
  maxTokens?: number;
  temperature?: number;
  costPerToken?: number; // For routing decisions
}

export type OpenClawCapability =
  | "chat"              // Basic conversation
  | "code"              // Code generation/analysis
  | "vision"            // Image understanding
  | "function-calling"  // Tool use
  | "embedding"         // Vector embeddings
  | "reasoning"         // Complex reasoning
  | "agentic"           // Autonomous agent tasks
  | "creative"          // Creative writing/generation
  | "analysis"          // Data analysis
  | "local-only";       // Runs only locally

export interface OpenClawConfig {
  gateway: OpenClawGatewayConfig;
  aiProviders: Record<string, OpenClawAIProvider>;
  defaultProvider: string;
  fallbackProvider?: string;
  routing: OpenClawRoutingConfig;
  plugins: OpenClawPluginConfig[];
  security: OpenClawSecurityConfig;
}

export interface OpenClawGatewayConfig {
  host: string;
  port: number;
  /** Port the external OpenClaw daemon binds to (default 18790) */
  daemonPort: number;
  protocol: "ws" | "wss";
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  enabled: boolean;
}

export interface OpenClawRoutingConfig {
  mode: "priority" | "capability" | "cost" | "round-robin" | "smart";
  preferLocal: boolean;          // Prefer Ollama/LM Studio when available
  useCloudForComplex: boolean;   // Use Anthropic for complex tasks
  maxLocalRetries: number;
  costThreshold?: number;        // Switch to local if cost exceeds threshold
  latencyThreshold?: number;     // Switch providers if latency too high
}

export interface OpenClawPluginConfig {
  id: string;
  name: string;
  type: "channel" | "skill" | "tool" | "integration";
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface OpenClawSecurityConfig {
  allowRemoteConnections: boolean;
  allowedOrigins: string[];
  authRequired: boolean;
  authToken?: string;
}

// =============================================================================
// GATEWAY STATUS & MESSAGES
// =============================================================================

export type OpenClawGatewayStatus = 
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface OpenClawGatewayState {
  status: OpenClawGatewayStatus;
  connectedAt?: number;
  lastHeartbeat?: number;
  reconnectAttempts: number;
  error?: string;
  version?: string;
  activePlugins: string[];
  connectedClients: number;
  /** True when operating in bridge mode (client to external OpenClaw gateway) */
  bridged?: boolean;
}

export type OpenClawMessageType =
  | "chat"              // Chat message
  | "completion"        // Text completion
  | "embedding"         // Generate embedding
  | "tool-call"         // Execute tool
  | "agent-task"        // Autonomous agent task
  | "skill-invoke"      // Invoke a skill
  | "event"             // Event notification
  | "control"           // Control message
  | "error"             // Error message
  | "heartbeat";        // Keep-alive

export interface OpenClawMessage {
  id: string;
  type: OpenClawMessageType;
  from: OpenClawMessageSource;
  to?: OpenClawMessageTarget;
  payload: unknown;
  timestamp: number;
  replyTo?: string;
  metadata?: OpenClawMessageMetadata;
}

export interface OpenClawMessageSource {
  type: "user" | "assistant" | "system" | "plugin" | "agent" | "workflow";
  id: string;
  name?: string;
}

export interface OpenClawMessageTarget {
  type: "provider" | "plugin" | "agent" | "workflow" | "broadcast";
  id: string;
}

export interface OpenClawMessageMetadata {
  provider?: string;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
  cost?: number;
  cached?: boolean;
  localProcessed?: boolean;
}

// =============================================================================
// CHAT & COMPLETION
// =============================================================================

export interface OpenClawChatRequest {
  messages: OpenClawChatMessage[];
  provider?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: OpenClawTool[];
  stream?: boolean;
  systemPrompt?: string;
  capabilities?: OpenClawCapability[]; // Required capabilities for routing
  preferLocal?: boolean; // Prefer local AI providers (Ollama) over cloud
}

export interface OpenClawChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: OpenClawToolCall[];
}

export interface OpenClawChatResponse {
  id: string;
  message: OpenClawChatMessage;
  finishReason: "stop" | "length" | "tool_calls" | "error";
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
  latencyMs: number;
  localProcessed: boolean;
}

export interface OpenClawStreamChunk {
  id: string;
  delta: string;
  finishReason?: string;
  toolCallDelta?: Partial<OpenClawToolCall>;
}

// =============================================================================
// TOOLS & SKILLS
// =============================================================================

export interface OpenClawTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler?: string; // Function name or MCP tool reference
}

export interface OpenClawToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface OpenClawToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

export interface OpenClawSkill {
  id: string;
  name: string;
  description: string;
  triggerPatterns: string[]; // Regex patterns
  handler: string;
  examples: Array<{
    input: string;
    output: string;
  }>;
  enabled: boolean;
}

// =============================================================================
// AGENT INTEGRATION
// =============================================================================

export interface OpenClawAgentTask {
  id: string;
  type: "research" | "build" | "analyze" | "optimize" | "automate" | "custom";
  objective: string;
  context?: string;
  constraints?: string[];
  provider?: string; // Force specific provider
  preferLocal?: boolean;
  maxIterations?: number;
  timeout?: number;
}

export interface OpenClawAgentTaskResult {
  taskId: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  result?: unknown;
  artifacts?: OpenClawArtifact[];
  iterations: number;
  tokensUsed: number;
  providersUsed: string[];
  error?: string;
}

export interface OpenClawArtifact {
  id: string;
  type: "code" | "file" | "data" | "config" | "documentation";
  name: string;
  content: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// N8N INTEGRATION
// =============================================================================

export interface OpenClawN8nBridge {
  enabled: boolean;
  webhookUrl: string;
  apiKey?: string;
  workflows: OpenClawN8nWorkflowMapping[];
  eventSubscriptions: OpenClawN8nEventSubscription[];
}

export interface OpenClawN8nWorkflowMapping {
  id: string;
  name: string;
  n8nWorkflowId: string;
  triggerType: "message" | "skill" | "event" | "schedule";
  triggerPattern?: string;
  enabled: boolean;
}

export interface OpenClawN8nEventSubscription {
  eventType: string;
  n8nWorkflowId: string;
  filter?: Record<string, unknown>;
}

// =============================================================================
// CLAUDE CODE INTEGRATION
// =============================================================================

export interface ClaudeCodeConfig {
  enabled: boolean;
  workspacePath?: string;
  autoApprove: boolean;
  maxFileEdits?: number;
  allowedOperations: ClaudeCodeOperation[];
  sandboxMode: boolean;
}

export type ClaudeCodeOperation =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "create_file"
  | "delete_file"
  | "run_command"
  | "search_code"
  | "analyze_code"
  | "refactor"
  | "test_generation";

export interface ClaudeCodeTask {
  id: string;
  type: ClaudeCodeOperation | "composite";
  description: string;
  targetPath?: string;
  content?: string;
  searchQuery?: string;
  command?: string;
  subtasks?: ClaudeCodeTask[];
}

export interface ClaudeCodeResult {
  taskId: string;
  success: boolean;
  changes?: Array<{
    type: "create" | "modify" | "delete";
    path: string;
    diff?: string;
  }>;
  output?: string;
  error?: string;
}

// =============================================================================
// EVENTS
// =============================================================================

export type OpenClawEventType =
  | "gateway:connected"
  | "gateway:disconnected"
  | "gateway:error"
  | "provider:switched"
  | "provider:error"
  | "message:received"
  | "message:sent"
  | "tool:invoked"
  | "tool:completed"
  | "skill:triggered"
  | "agent:task:started"
  | "agent:task:completed"
  | "n8n:workflow:triggered"
  | "n8n:workflow:completed"
  | "claude-code:task:started"
  | "claude-code:task:completed";

export interface OpenClawEvent {
  type: OpenClawEventType;
  timestamp: number;
  data: unknown;
  source?: string;
}

// =============================================================================
// DEFAULT CONFIGURATIONS
// =============================================================================

export const DEFAULT_OPENCLAW_CONFIG: OpenClawConfig = {
  gateway: {
    host: "127.0.0.1",
    port: 18792,
    daemonPort: 18790,
    protocol: "ws",
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
    enabled: true,
  },
  aiProviders: {
    ollama: {
      name: "Ollama (Local)",
      type: "ollama",
      baseURL: "http://localhost:11434",
      model: "llama3.2:3b",
      enabled: true,
      priority: 1, // Highest priority - prefer local
      capabilities: ["chat", "code", "reasoning", "local-only"],
      temperature: 0.7,
    },
    anthropic: {
      name: "Anthropic Claude",
      type: "anthropic",
      model: "claude-sonnet-4-5",
      enabled: true,
      priority: 2,
      capabilities: ["chat", "code", "vision", "function-calling", "reasoning", "agentic", "creative", "analysis"],
      temperature: 0.7,
    },
    "claude-code": {
      name: "Claude Code (Agentic)",
      type: "claude-code",
      model: "claude-sonnet-4-5",
      enabled: false,
      priority: 3,
      capabilities: ["code", "agentic", "function-calling", "reasoning"],
      temperature: 0.3,
    },
    openai: {
      name: "OpenAI",
      type: "openai",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-5.1",
      enabled: false,
      priority: 2,
      capabilities: ["chat", "code", "vision", "function-calling", "reasoning", "creative", "analysis"],
      temperature: 0.7,
    },
    deepseek: {
      name: "DeepSeek",
      type: "deepseek",
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      enabled: true,
      priority: 3,
      capabilities: ["chat", "code", "reasoning", "analysis"],
      temperature: 0.7,
    },
    google: {
      name: "Google Gemini",
      type: "google",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      enabled: true,
      priority: 3,
      capabilities: ["chat", "code", "vision", "reasoning", "creative", "analysis"],
      temperature: 0.7,
    },
  },
  defaultProvider: "ollama",
  fallbackProvider: "anthropic",
  routing: {
    mode: "smart",
    preferLocal: true,
    useCloudForComplex: true,
    maxLocalRetries: 2,
    costThreshold: 0.10, // 10 cents
    latencyThreshold: 10000, // 10 seconds
  },
  plugins: [],
  security: {
    allowRemoteConnections: false,
    allowedOrigins: ["http://localhost:*", "http://127.0.0.1:*", "file://*"],
    authRequired: false,
  },
};

export const DEFAULT_CLAUDE_CODE_CONFIG: ClaudeCodeConfig = {
  enabled: false,
  autoApprove: false,
  maxFileEdits: 10,
  allowedOperations: [
    "read_file",
    "write_file",
    "edit_file",
    "create_file",
    "search_code",
    "analyze_code",
  ],
  sandboxMode: true,
};

// =============================================================================
// DATA PIPELINE - SCRAPING, COLLECTION & IMAGE GENERATION
// =============================================================================

export type OpenClawDataCapability =
  | "scraping"
  | "data-collection"
  | "image-generation"
  | "audio-generation"
  | "web-search"
  | "document-extraction";

/**
 * Configuration for AI-enhanced web scraping
 */
export interface OpenClawScrapingConfig {
  /** URLs to scrape */
  urls: string[];
  
  /** Scraping type */
  type: "web" | "api" | "rss" | "sitemap" | "document";
  
  /** Use AI to intelligently extract content */
  aiExtraction?: {
    enabled: boolean;
    /** Use local Ollama for extraction analysis */
    preferLocal: boolean;
    /** Extraction instructions for the AI */
    instructions?: string;
    /** Schema for structured extraction */
    outputSchema?: Record<string, string>;
  };
  
  /** CSS/XPath selectors for manual extraction */
  selectors?: {
    content?: string;
    title?: string;
    author?: string;
    date?: string;
    images?: string;
    links?: string;
    custom?: Record<string, string>;
  };
  
  /** Crawling options */
  crawl?: {
    enabled: boolean;
    maxDepth?: number;
    maxPages?: number;
    followExternal?: boolean;
    urlPattern?: string;
  };
  
  /** Rate limiting */
  rateLimit?: {
    requestsPerSecond?: number;
    delayBetweenRequests?: number;
    maxConcurrent?: number;
  };
  
  /** Output format */
  output?: {
    format: "text" | "html" | "json" | "markdown";
    includeMetadata?: boolean;
    extractImages?: boolean;
    extractLinks?: boolean;
  };
  
  /** Content filters */
  filters?: {
    minContentLength?: number;
    maxContentLength?: number;
    mustContain?: string[];
    mustNotContain?: string[];
    languageFilter?: string[];
  };
}

/**
 * Result from AI-enhanced scraping
 */
export interface OpenClawScrapingResult {
  success: boolean;
  jobId: string;
  url: string;
  
  /** Raw scraped content */
  rawContent?: string;
  
  /** AI-extracted structured data */
  extractedData?: {
    title?: string;
    content: string;
    summary?: string;
    entities?: Array<{ name: string; type: string; value: string }>;
    sentiment?: "positive" | "negative" | "neutral";
    topics?: string[];
    metadata?: Record<string, unknown>;
  };
  
  /** Images found/downloaded */
  images?: Array<{
    url: string;
    localPath?: string;
    altText?: string;
    caption?: string;
  }>;
  
  /** Provider used for AI extraction */
  aiProvider?: string;
  
  /** Processing stats */
  stats?: {
    fetchTimeMs: number;
    extractionTimeMs?: number;
    contentLength: number;
  };
  
  error?: string;
}

/**
 * Configuration for AI-enhanced image generation
 */
export interface OpenClawImageGenConfig {
  /** Base prompt for image generation */
  prompt: string;
  
  /** Negative prompt */
  negativePrompt?: string;
  
  /** Use AI to enhance/expand the prompt */
  aiPromptEnhancement?: {
    enabled: boolean;
    /** Use local Ollama for prompt enhancement */
    preferLocal: boolean;
    /** Style hints for enhancement */
    style?: string;
    /** Expand prompt to be more detailed */
    expandPrompt?: boolean;
    /** Add quality/technical terms */
    addQualityTerms?: boolean;
  };
  
  /** Image dimensions */
  width?: number;
  height?: number;
  
  /** Generation model */
  model?: "stable-diffusion-1.5" | "stable-diffusion-xl" | "stable-diffusion-3" | "sdxl-turbo" | string;
  
  /** Generation parameters */
  steps?: number;
  cfgScale?: number;
  sampler?: "euler" | "euler_a" | "dpmpp_2m" | "ddim" | "lms";
  seed?: number;
  
  /** Number of images to generate */
  batchSize?: number;
  
  /** Backend to use */
  backend?: "automatic1111" | "comfyui" | "diffusers";
  
  /** Save to dataset */
  saveToDataset?: {
    enabled: boolean;
    datasetId?: string;
    tags?: string[];
  };
}

/**
 * Result from AI-enhanced image generation
 */
export interface OpenClawImageGenResult {
  success: boolean;
  jobId: string;
  
  /** Original prompt */
  originalPrompt: string;
  
  /** AI-enhanced prompt (if enhancement was enabled) */
  enhancedPrompt?: string;
  
  /** Generated images */
  images: Array<{
    id: string;
    path: string;
    width: number;
    height: number;
    seed: number;
    metadata?: Record<string, unknown>;
  }>;
  
  /** Provider used for prompt enhancement */
  aiProvider?: string;
  
  /** Generation stats */
  stats?: {
    promptEnhancementTimeMs?: number;
    generationTimeMs: number;
    model: string;
  };
  
  error?: string;
}

/**
 * Data collection pipeline configuration
 */
export interface OpenClawDataPipelineConfig {
  /** Pipeline name */
  name: string;
  
  /** Pipeline description */
  description?: string;
  
  /** Data sources */
  sources: Array<{
    type: "scraping" | "api" | "file" | "stream";
    config: OpenClawScrapingConfig | Record<string, unknown>;
  }>;
  
  /** Processing steps */
  processing: Array<{
    type: "ai-transform" | "filter" | "dedupe" | "enrich" | "validate";
    config: {
      /** Use local Ollama for processing */
      preferLocal?: boolean;
      /** AI instructions for transformation */
      instructions?: string;
      /** Filter conditions */
      conditions?: Record<string, unknown>;
    };
  }>;
  
  /** Output destination */
  output: {
    type: "dataset" | "file" | "webhook" | "n8n";
    config: {
      datasetId?: string;
      filePath?: string;
      webhookUrl?: string;
      n8nWorkflowId?: string;
    };
  };
  
  /** Schedule for recurring collection */
  schedule?: {
    enabled: boolean;
    cron?: string;
    interval?: number;
  };
}

/**
 * Data pipeline execution result
 */
export interface OpenClawPipelineResult {
  success: boolean;
  pipelineId: string;
  pipelineName: string;
  
  /** Items collected */
  itemsCollected: number;
  
  /** Items processed */
  itemsProcessed: number;
  
  /** Items output */
  itemsOutput: number;
  
  /** Processing details */
  stages: Array<{
    name: string;
    status: "success" | "failed" | "skipped";
    itemsIn: number;
    itemsOut: number;
    duration: number;
    error?: string;
  }>;
  
  /** AI providers used */
  aiProvidersUsed: string[];
  
  /** Total duration */
  totalDuration: number;
  
  error?: string;
}

/**
 * Unified data operation request through OpenClaw
 */
export interface OpenClawDataRequest {
  type: "scrape" | "generate-image" | "run-pipeline" | "collect";
  
  /** Request ID for tracking */
  requestId: string;
  
  /** Scraping config (when type is "scrape") */
  scrapingConfig?: OpenClawScrapingConfig;
  
  /** Image generation config (when type is "generate-image") */
  imageGenConfig?: OpenClawImageGenConfig;
  
  /** Pipeline config (when type is "run-pipeline") */
  pipelineConfig?: OpenClawDataPipelineConfig;
  
  /** AI routing preferences */
  aiRouting?: {
    preferLocal: boolean;
    allowCloudFallback: boolean;
    maxCost?: number;
  };
  
  /** Associated app/context */
  appId?: string;
  conversationId?: string;
}

/**
 * Unified data operation response
 */
export interface OpenClawDataResponse {
  requestId: string;
  type: OpenClawDataRequest["type"];
  success: boolean;
  
  /** Scraping result */
  scrapingResult?: OpenClawScrapingResult;
  
  /** Image generation result */
  imageGenResult?: OpenClawImageGenResult;
  
  /** Pipeline result */
  pipelineResult?: OpenClawPipelineResult;
  
  /** Which AI provider was used */
  aiProvider?: string;
  
  /** Cost incurred (for cloud providers) */
  cost?: number;
  
  error?: string;
}

// =============================================================================
// DEFAULT DATA PIPELINE CONFIGURATIONS
// =============================================================================

export const DEFAULT_SCRAPING_CONFIG: Partial<OpenClawScrapingConfig> = {
  type: "web",
  aiExtraction: {
    enabled: true,
    preferLocal: true,
  },
  rateLimit: {
    requestsPerSecond: 1,
    delayBetweenRequests: 1000,
    maxConcurrent: 3,
  },
  output: {
    format: "markdown",
    includeMetadata: true,
    extractImages: true,
    extractLinks: true,
  },
};

export const DEFAULT_IMAGE_GEN_CONFIG: Partial<OpenClawImageGenConfig> = {
  width: 1024,
  height: 1024,
  model: "stable-diffusion-xl",
  steps: 30,
  cfgScale: 7.5,
  sampler: "euler_a",
  batchSize: 1,
  backend: "diffusers",
  aiPromptEnhancement: {
    enabled: true,
    preferLocal: true,
    expandPrompt: true,
    addQualityTerms: true,
  },
};

export const DEFAULT_PIPELINE_CONFIG: Partial<OpenClawDataPipelineConfig> = {
  processing: [
    {
      type: "ai-transform",
      config: {
        preferLocal: true,
        instructions: "Extract key information and summarize the content.",
      },
    },
    {
      type: "dedupe",
      config: {},
    },
  ],
  output: {
    type: "dataset",
    config: {},
  },
};
