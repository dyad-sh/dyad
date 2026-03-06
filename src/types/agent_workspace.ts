/**
 * Agent Workspace Types
 * End-to-end types for agent task execution, knowledge connectors,
 * and workspace management. Each agent has its own workspace with
 * tasks, knowledge sources, execution history, and tool configurations.
 */

// =============================================================================
// AGENT TASK TYPES
// =============================================================================

export type AgentTaskStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentTaskType =
  | "web_scrape"
  | "knowledge_query"
  | "document_process"
  | "api_call"
  | "code_execution"
  | "llm_inference"
  | "data_analysis"
  | "file_conversion"
  | "search"
  | "email"
  | "message"
  | "form_fill"
  | "summarize"
  | "custom";

export type ExecutionMode = "local" | "cloud" | "hybrid" | "n8n";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface AgentTask {
  id: string;
  agentId: number;
  name: string;
  description: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  priority: TaskPriority;
  executionMode: ExecutionMode;

  /** Tool ID from catalog used by this task */
  toolId?: string;
  /** Trigger ID that starts this task */
  triggerId?: string;

  /** Input parameters */
  input: Record<string, unknown>;
  /** Output/result of the task */
  output?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;

  /** Task dependencies (other task IDs that must complete first) */
  dependencies: string[];
  /** Whether this task repeats on a schedule */
  recurring: boolean;
  /** Cron expression for recurring tasks */
  cronExpression?: string;

  /** Execution history */
  executionCount: number;
  lastExecutedAt?: string;
  averageDurationMs?: number;

  /** n8n workflow node ID if synced */
  n8nNodeId?: string;

  createdAt: string;
  updatedAt: string;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  agentId: number;
  status: AgentTaskStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  logs: TaskExecutionLog[];
  /** Resources consumed */
  metrics: TaskExecutionMetrics;
}

export interface TaskExecutionLog {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: unknown;
}

export interface TaskExecutionMetrics {
  tokensUsed?: number;
  apiCalls?: number;
  bytesProcessed?: number;
  pagesScraped?: number;
  documentsProcessed?: number;
  executionMode: ExecutionMode;
}

// =============================================================================
// KNOWLEDGE SOURCE TYPES
// =============================================================================

export type KnowledgeSourceType =
  | "scraping_engine"
  | "ai_query"
  | "local_vault"
  | "local_file"
  | "api_endpoint"
  | "database"
  | "web_search"
  | "document_upload"
  | "rss_feed"
  | "manual";

export type KnowledgeSourceStatus =
  | "connected"
  | "syncing"
  | "error"
  | "disconnected"
  | "pending";

export interface AgentKnowledgeSource {
  id: string;
  agentId: number;
  name: string;
  description?: string;
  type: KnowledgeSourceType;
  status: KnowledgeSourceStatus;
  config: KnowledgeSourceConfig;

  /** Stats */
  totalDocuments: number;
  totalBytes: number;
  lastSyncAt?: string;
  syncIntervalMs?: number;
  autoSync: boolean;

  /** Filtering */
  filters?: KnowledgeSourceFilter;

  createdAt: string;
  updatedAt: string;
}

export type KnowledgeSourceConfig =
  | ScrapingKnowledgeConfig
  | AIQueryKnowledgeConfig
  | LocalVaultKnowledgeConfig
  | LocalFileKnowledgeConfig
  | ApiEndpointKnowledgeConfig
  | WebSearchKnowledgeConfig
  | DocumentUploadKnowledgeConfig
  | RssFeedKnowledgeConfig
  | ManualKnowledgeConfig;

export interface ScrapingKnowledgeConfig {
  type: "scraping_engine";
  /** URLs to scrape */
  urls: string[];
  /** Scraping template ID */
  templateId?: string;
  /** Crawl settings */
  crawl?: boolean;
  maxPages?: number;
  /** AI extraction */
  aiExtraction?: boolean;
  /** Schedule */
  schedule?: "once" | "daily" | "weekly" | "custom";
  /** Existing scraping job ID */
  jobId?: string;
}

export interface AIQueryKnowledgeConfig {
  type: "ai_query";
  /** The query/prompt to generate knowledge */
  query: string;
  /** Model to use */
  model?: string;
  /** Whether to use local LLM */
  preferLocal: boolean;
  /** Context window (2M for CAG) */
  contextWindow?: "standard" | "large" | "2m";
  /** Use CAG (Cache Augmented Generation) */
  useCag: boolean;
  /** Refresh interval */
  refreshInterval?: "manual" | "daily" | "weekly";
}

export interface LocalVaultKnowledgeConfig {
  type: "local_vault";
  /** Connector IDs from Local Vault */
  connectorIds: string[];
  /** Asset filters */
  assetTypes?: string[];
  /** Tags to filter by */
  tags?: string[];
}

export interface LocalFileKnowledgeConfig {
  type: "local_file";
  /** File paths to include */
  paths: string[];
  /** Glob patterns */
  patterns?: string[];
  /** Watch for changes */
  watchChanges: boolean;
}

export interface ApiEndpointKnowledgeConfig {
  type: "api_endpoint";
  /** API URL */
  url: string;
  /** HTTP method */
  method: "GET" | "POST";
  /** Headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: unknown;
  /** JSON path to data */
  dataPath?: string;
  /** Poll interval ms */
  pollIntervalMs?: number;
}

export interface WebSearchKnowledgeConfig {
  type: "web_search";
  /** Search queries */
  queries: string[];
  /** Search engine */
  engine: "google" | "perplexity" | "bing";
  /** Max results per query */
  maxResults: number;
  /** Auto-refresh */
  autoRefresh: boolean;
}

export interface DocumentUploadKnowledgeConfig {
  type: "document_upload";
  /** Uploaded document paths */
  documentPaths: string[];
  /** Processing mode */
  processingMode: "text" | "ocr" | "ai_extract";
  /** Chunk for RAG */
  chunkSize: number;
  chunkOverlap: number;
}

export interface RssFeedKnowledgeConfig {
  type: "rss_feed";
  /** Feed URLs */
  feedUrls: string[];
  /** Poll interval */
  pollIntervalMs: number;
  /** Max items to keep */
  maxItems: number;
}

export interface ManualKnowledgeConfig {
  type: "manual";
  /** Free-text entries */
  entries: Array<{
    title: string;
    content: string;
    tags?: string[];
  }>;
}

export interface KnowledgeSourceFilter {
  /** Minimum content length */
  minContentLength?: number;
  /** Maximum content length */
  maxContentLength?: number;
  /** Include only these content types */
  contentTypes?: string[];
  /** Tags to include */
  includeTags?: string[];
  /** Tags to exclude */
  excludeTags?: string[];
  /** Date range */
  dateFrom?: string;
  dateTo?: string;
}

// =============================================================================
// KNOWLEDGE QUERY RESULT
// =============================================================================

export interface KnowledgeQueryResult {
  sourceId: string;
  sourceName: string;
  sourceType: KnowledgeSourceType;
  results: KnowledgeItem[];
  totalResults: number;
  queryTimeMs: number;
}

export interface KnowledgeItem {
  id: string;
  title?: string;
  content: string;
  url?: string;
  relevanceScore: number;
  metadata?: Record<string, unknown>;
  sourceType: KnowledgeSourceType;
  createdAt: string;
}

// =============================================================================
// AGENT WORKSPACE
// =============================================================================

export interface AgentWorkspace {
  agentId: number;
  agentName: string;
  agentType: string;

  /** All tasks for this agent */
  tasks: AgentTask[];
  /** All knowledge sources */
  knowledgeSources: AgentKnowledgeSource[];
  /** Active trigger count */
  activeTriggers: number;
  /** Active tool count */
  activeTools: number;

  /** Execution summary */
  stats: AgentWorkspaceStats;
}

export interface AgentWorkspaceStats {
  totalTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalExecutions: number;
  totalKnowledgeSources: number;
  totalKnowledgeDocuments: number;
  totalKnowledgeBytes: number;
  lastActivityAt?: string;
}

// =============================================================================
// IPC REQUEST / RESPONSE TYPES
// =============================================================================

export interface CreateAgentTaskRequest {
  agentId: number;
  name: string;
  description: string;
  type: AgentTaskType;
  toolId?: string;
  triggerId?: string;
  priority?: TaskPriority;
  executionMode?: ExecutionMode;
  input?: Record<string, unknown>;
  dependencies?: string[];
  recurring?: boolean;
  cronExpression?: string;
}

export interface UpdateAgentTaskRequest {
  id: string;
  name?: string;
  description?: string;
  type?: AgentTaskType;
  priority?: TaskPriority;
  executionMode?: ExecutionMode;
  input?: Record<string, unknown>;
  dependencies?: string[];
  toolId?: string;
  triggerId?: string;
  recurring?: boolean;
  cronExpression?: string;
}

export interface ExecuteTaskRequest {
  taskId: string;
  /** Override input parameters for this execution */
  inputOverrides?: Record<string, unknown>;
  /** Force a specific execution mode */
  forceMode?: ExecutionMode;
}

export interface AddKnowledgeSourceRequest {
  agentId: number;
  name: string;
  description?: string;
  type: KnowledgeSourceType;
  config: KnowledgeSourceConfig;
  autoSync?: boolean;
  syncIntervalMs?: number;
  filters?: KnowledgeSourceFilter;
}

export interface UpdateKnowledgeSourceRequest {
  id: string;
  name?: string;
  description?: string;
  config?: Partial<KnowledgeSourceConfig>;
  autoSync?: boolean;
  syncIntervalMs?: number;
  filters?: KnowledgeSourceFilter;
}

export interface QueryKnowledgeRequest {
  agentId: number;
  query: string;
  /** Specific source IDs to query (empty = all) */
  sourceIds?: string[];
  maxResults?: number;
  minRelevance?: number;
}

export interface SuggestedToolsRequest {
  agentId: number;
  agentType?: string;
  taskTypes?: AgentTaskType[];
}

// =============================================================================
// TOOL CONFIGURATION PER AGENT
// =============================================================================

export interface AgentToolConfig {
  toolId: string;
  agentId: number;
  /** Custom parameters for this agent */
  customParams: Record<string, unknown>;
  /** Whether using local model for this tool */
  preferLocal: boolean;
  /** API keys / credentials */
  credentialId?: string;
  /** Max executions per hour */
  rateLimit?: number;
  /** Whether to auto-approve */
  autoApprove: boolean;
  enabled: boolean;
}

// =============================================================================
// SUGGESTED TOOLS BY AGENT TYPE
// =============================================================================

export const AGENT_TYPE_SUGGESTED_TOOLS: Record<string, string[]> = {
  chatbot: [
    "llm",
    "advanced-knowledge-search",
    "summarize",
    "web-scraper-tool",
    "cag-knowledge",
  ],
  task: [
    "llm",
    "code-execution",
    "http-request",
    "data-analysis",
    "web-scraper-tool",
    "form-fill",
  ],
  "multi-agent": [
    "llm",
    "advanced-knowledge-search",
    "code-execution",
    "http-request",
    "web-scraper-tool",
    "perplexity-search",
    "google-scrape",
  ],
  workflow: [
    "llm",
    "send-email",
    "slack-message",
    "google-docs",
    "http-request",
    "data-analysis",
  ],
  rag: [
    "advanced-knowledge-search",
    "cag-knowledge",
    "llm",
    "summarize",
    "pdf-conversion",
    "markdown-conversion",
    "document-extraction",
    "document-parse",
  ],
};

// =============================================================================
// TASK TYPE TO TOOL MAPPING
// =============================================================================

export const TASK_TYPE_TOOLS: Record<AgentTaskType, string[]> = {
  web_scrape: ["web-scraper-tool", "google-scrape"],
  knowledge_query: ["advanced-knowledge-search", "cag-knowledge", "perplexity-search"],
  document_process: ["document-extraction", "document-parse", "pdf-conversion", "markdown-conversion", "edit-document"],
  api_call: ["http-request"],
  code_execution: ["code-execution"],
  llm_inference: ["llm", "summarize"],
  data_analysis: ["data-analysis"],
  file_conversion: ["pdf-conversion", "markdown-conversion"],
  search: ["google-search", "perplexity-search", "google-scrape"],
  email: ["send-email"],
  message: ["slack-message"],
  form_fill: ["form-fill"],
  summarize: ["summarize", "cag-knowledge"],
  custom: ["llm", "code-execution", "http-request"],
};
