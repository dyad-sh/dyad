/**
 * Agent Orchestrator Types
 * Complete type definitions for the autonomous meta-agent orchestration system
 *
 * This system unifies:
 * - Agent Swarm (multi-agent coordination)
 * - Autonomous Agents (self-directed missions)
 * - Agent Factory (custom agent creation)
 * - OpenClaw CNS (AI routing localâ†”cloud)
 * - Voice Assistant (speech I/O)
 * - n8n (workflow automation)
 */

// =============================================================================
// BRANDED TYPES
// =============================================================================

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type OrchestrationId = Brand<string, "OrchestrationId">;
export type MetaAgentId = Brand<string, "MetaAgentId">;
export type TaskNodeId = Brand<string, "TaskNodeId">;
export type PlanId = Brand<string, "PlanId">;
export type ExecutionTraceId = Brand<string, "ExecutionTraceId">;

// =============================================================================
// INPUT MODALITY â€” how the user communicates with the orchestrator
// =============================================================================

export type InputModality = "text" | "voice" | "nlp_command" | "api";

export interface OrchestratorInput {
  modality: InputModality;
  /** Raw text (typed or transcribed) */
  text: string;
  /** Original audio path when modality is "voice" */
  audioPath?: string;
  /** Structured NLP intent parsed from text */
  intent?: ParsedIntent;
  /** Optional context from the current session */
  context?: Record<string, unknown>;
}

export interface ParsedIntent {
  action: string;
  entities: IntentEntity[];
  confidence: number;
  rawText: string;
}

export interface IntentEntity {
  type: string;
  value: string;
  start: number;
  end: number;
  confidence: number;
}

// =============================================================================
// EXECUTION MODE â€” where agents run
// =============================================================================

export type ExecutionMode = "local" | "cloud" | "hybrid";

export interface ExecutionConfig {
  mode: ExecutionMode;
  /** Prefer local Ollama for simple tasks */
  preferLocal: boolean;
  /** Maximum parallel agents */
  maxParallelAgents: number;
  /** Timeout per task in ms */
  taskTimeoutMs: number;
  /** Timeout for entire orchestration in ms */
  orchestrationTimeoutMs: number;
  /** MCP server URLs for cloud execution */
  mcpEndpoints: string[];
  /** API endpoints for external services */
  apiEndpoints: Record<string, string>;
  /** Use n8n for workflow orchestration */
  useN8n: boolean;
  /** Ollama model to use for local inference */
  localModel: string;
  /** Cloud model to use for complex tasks */
  cloudModel: string;
}

// =============================================================================
// AGENT CAPABILITY â€” what an agent can do
// =============================================================================

export type AgentCapabilityType =
  | "text_generation"
  | "code_generation"
  | "code_review"
  | "data_analysis"
  | "web_scraping"
  | "file_operations"
  | "api_calls"
  | "image_generation"
  | "voice_processing"
  | "research"
  | "planning"
  | "debugging"
  | "testing"
  | "deployment"
  | "monitoring"
  | "communication"
  | "task_management"
  | "meta_agent_creation"
  | "workflow_automation"
  | "knowledge_retrieval";

export interface AgentCapability {
  type: AgentCapabilityType;
  proficiency: number; // 0-1
  description: string;
  requiredTools?: string[];
}

// =============================================================================
// META-AGENT â€” an agent that creates other agents
// =============================================================================

export type MetaAgentStatus = "idle" | "analyzing" | "planning" | "creating_agents" | "orchestrating" | "completed" | "failed";

export interface MetaAgent {
  id: MetaAgentId;
  name: string;
  description: string;
  status: MetaAgentStatus;
  capabilities: AgentCapability[];
  /** Agent creation templates this meta-agent can use */
  templates: AgentTemplate[];
  /** History of orchestrations this meta-agent has performed */
  orchestrationHistory: OrchestrationId[];
  /** Configuration for how this meta-agent creates agents */
  creationConfig: AgentCreationConfig;
  /** Statistics */
  stats: MetaAgentStats;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  type: AgentTemplateType;
  capabilities: AgentCapabilityType[];
  systemPrompt: string;
  tools: string[];
  modelPreference: "local" | "cloud" | "auto";
  /** Estimated complexity 1-10 */
  complexityLevel: number;
}

export type AgentTemplateType =
  | "researcher"
  | "coder"
  | "reviewer"
  | "tester"
  | "deployer"
  | "data_analyst"
  | "writer"
  | "planner"
  | "coordinator"
  | "scraper"
  | "communicator"
  | "monitor"
  | "custom";

export interface AgentCreationConfig {
  /** Use swarm for multi-agent coordination */
  useSwarm: boolean;
  /** Use autonomous agent system for self-directed agents */
  useAutonomousAgents: boolean;
  /** Use agent factory for persistent agents */
  useAgentFactory: boolean;
  /** Route through OpenClaw CNS */
  useOpenClawCNS: boolean;
  /** Default execution mode */
  defaultExecutionMode: ExecutionMode;
  /** Max agents to create per orchestration */
  maxAgentsPerOrchestration: number;
  /** Auto-replicate agents when overloaded */
  autoReplicate: boolean;
}

export interface MetaAgentStats {
  totalOrchestrations: number;
  agentsCreated: number;
  tasksCompleted: number;
  tasksFailed: number;
  averageCompletionTimeMs: number;
  successRate: number;
}

// =============================================================================
// TASK DECOMPOSITION â€” breaking user intent into sub-tasks
// =============================================================================

export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex" | "expert";

export type TaskNodeStatus =
  | "pending"
  | "queued"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "retrying";

export interface TaskNode {
  id: TaskNodeId;
  name: string;
  description: string;
  status: TaskNodeStatus;
  priority: TaskPriority;
  complexity: TaskComplexity;
  /** Required capabilities to fulfill this task */
  requiredCapabilities: AgentCapabilityType[];
  /** Dependencies â€” task IDs that must complete first */
  dependencies: TaskNodeId[];
  /** Agent assigned to this task */
  assignedAgentId?: string;
  /** Swarm agent ID if running in swarm */
  swarmAgentId?: string;
  /** Autonomous agent ID if self-directed */
  autonomousAgentId?: string;
  /** Skill ID if fulfilled by a skill instead of an agent */
  skillId?: number;
  /** Input data from parent or dependencies */
  input?: Record<string, unknown>;
  /** Output data produced */
  output?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Retry count */
  retryCount: number;
  maxRetries: number;
  /** Execution mode for this specific task */
  executionMode: ExecutionMode;
  /** Timestamps */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Duration in ms */
  durationMs?: number;
}

// =============================================================================
// ORCHESTRATION PLAN â€” the full execution plan for a user request
// =============================================================================

export type PlanStatus =
  | "draft"
  | "analyzing"
  | "decomposing"
  | "creating_agents"
  | "executing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface OrchestrationPlan {
  id: PlanId;
  orchestrationId: OrchestrationId;
  /** The original user input */
  userInput: OrchestratorInput;
  /** Parsed high-level objective */
  objective: string;
  /** Task graph â€” nodes with dependency edges */
  tasks: TaskNode[];
  /** Execution order â€” topologically sorted task IDs */
  executionOrder: TaskNodeId[];
  /** Agents that will be created for this plan */
  agentAssignments: AgentAssignment[];
  /** Estimated total time */
  estimatedDurationMs: number;
  /** Estimated complexity */
  overallComplexity: TaskComplexity;
  status: PlanStatus;
  /** AI reasoning for the decomposition */
  reasoning: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAssignment {
  taskId: TaskNodeId;
  templateId: string;
  agentName: string;
  capabilities: AgentCapabilityType[];
  executionMode: ExecutionMode;
  /** Created agent ID (filled after creation) */
  createdAgentId?: string;
  /** Which system created this agent */
  createdVia?: "swarm" | "autonomous" | "factory";
}

// =============================================================================
// ORCHESTRATION â€” the top-level entity
// =============================================================================

export type OrchestrationStatus =
  | "received"
  | "parsing_input"
  | "decomposing_task"
  | "planning"
  | "creating_agents"
  | "executing"
  | "monitoring"
  | "aggregating_results"
  | "completed"
  | "failed"
  | "cancelled";

export interface Orchestration {
  id: OrchestrationId;
  /** The meta-agent managing this orchestration */
  metaAgentId: MetaAgentId;
  /** User input that triggered this orchestration */
  input: OrchestratorInput;
  /** The execution plan */
  plan?: OrchestrationPlan;
  /** Current status */
  status: OrchestrationStatus;
  /** Execution configuration */
  executionConfig: ExecutionConfig;
  /** Swarm ID if using swarm coordination */
  swarmId?: string;
  /** Results aggregated from all tasks */
  results?: OrchestrationResult;
  /** Execution trace for debugging */
  trace: ExecutionTraceEntry[];
  /** Error if failed */
  error?: string;
  /** Progress 0-100 */
  progress: number;
  /** Timestamps */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Total duration in ms */
  durationMs?: number;
}

export interface OrchestrationResult {
  /** Combined output from all tasks */
  summary: string;
  /** Individual task results */
  taskResults: Record<string, unknown>;
  /** Artifacts produced (files, code, data) */
  artifacts: OrchestrationArtifact[];
  /** Statistics */
  stats: OrchestrationResultStats;
}

export interface OrchestrationArtifact {
  id: string;
  name: string;
  type: "file" | "code" | "data" | "report" | "deployment" | "model";
  path?: string;
  content?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface OrchestrationResultStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  totalAgentsCreated: number;
  totalDurationMs: number;
  tokensUsed: number;
  localInferences: number;
  cloudInferences: number;
}

export interface ExecutionTraceEntry {
  id: ExecutionTraceId;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  data?: Record<string, unknown>;
}

// =============================================================================
// COMMUNICATION CHANNELS â€” OpenClaw integration
// =============================================================================

export type CommunicationChannel = "openclaw_cns" | "ollama" | "n8n" | "mcp" | "api" | "voice";

export interface CommunicationConfig {
  channels: CommunicationChannel[];
  /** OpenClaw CNS config */
  cns: {
    preferLocal: boolean;
    localModel: string;
    cloudModel: string;
  };
  /** n8n config */
  n8n: {
    enabled: boolean;
    autoCreateWorkflows: boolean;
  };
  /** MCP endpoints */
  mcp: {
    endpoints: string[];
    timeout: number;
  };
}

// =============================================================================
// LONG-TERM TASK SUPPORT
// =============================================================================

export type LongTermTaskStatus = "active" | "paused" | "waiting" | "checkpoint" | "completed" | "failed";

export interface LongTermTaskConfig {
  /** Enable checkpoint/resume for long tasks */
  enableCheckpoints: boolean;
  /** Checkpoint interval in ms */
  checkpointIntervalMs: number;
  /** Maximum runtime before forced checkpoint */
  maxRuntimeBeforeCheckpointMs: number;
  /** Persist state to disk */
  persistState: boolean;
  /** Resume from last checkpoint on restart */
  autoResume: boolean;
}

export interface TaskCheckpoint {
  id: string;
  orchestrationId: OrchestrationId;
  taskId: TaskNodeId;
  timestamp: string;
  state: Record<string, unknown>;
  progress: number;
  /** Can resume from this checkpoint */
  resumable: boolean;
}

// =============================================================================
// IPC REQUEST / RESPONSE TYPES
// =============================================================================

/** Submit a new task to the orchestrator */
export interface SubmitTaskRequest {
  input: OrchestratorInput;
  executionConfig?: Partial<ExecutionConfig>;
  communicationConfig?: Partial<CommunicationConfig>;
  longTermConfig?: Partial<LongTermTaskConfig>;
}

export interface SubmitTaskResponse {
  orchestrationId: OrchestrationId;
  status: OrchestrationStatus;
  estimatedDurationMs?: number;
}

/** Get orchestration status */
export interface OrchestrationStatusResponse {
  orchestration: Orchestration;
  activeTasks: TaskNode[];
  completedTasks: TaskNode[];
  failedTasks: TaskNode[];
}

/** Get meta-agent info */
export interface MetaAgentInfo {
  metaAgent: MetaAgent;
  activeOrchestrations: number;
  totalOrchestrations: number;
}

/** Orchestrator dashboard data */
export interface OrchestratorDashboard {
  metaAgent: MetaAgent;
  activeOrchestrations: Orchestration[];
  recentOrchestrations: Orchestration[];
  systemStatus: SystemStatus;
  capabilities: AgentCapability[];
}

export interface SystemStatus {
  ollamaAvailable: boolean;
  n8nAvailable: boolean;
  openclawCnsInitialized: boolean;
  voiceAvailable: boolean;
  swarmActive: boolean;
  activeAgents: number;
  activeSwarms: number;
  activeMissions: number;
  cpuUsage?: number;
  memoryUsageMb?: number;
}

// =============================================================================
// EVENTS
// =============================================================================

export type OrchestratorEventType =
  | "orchestration:started"
  | "orchestration:plan:created"
  | "orchestration:agents:created"
  | "orchestration:task:started"
  | "orchestration:task:completed"
  | "orchestration:task:failed"
  | "orchestration:progress"
  | "orchestration:completed"
  | "orchestration:failed"
  | "orchestration:cancelled"
  | "meta-agent:created"
  | "meta-agent:thinking"
  | "agent:spawned"
  | "agent:terminated"
  | "voice:transcribed"
  | "checkpoint:saved"
  | "checkpoint:restored";

export interface OrchestratorEvent {
  type: OrchestratorEventType;
  timestamp: string;
  orchestrationId?: OrchestrationId;
  taskId?: TaskNodeId;
  data: Record<string, unknown>;
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  mode: "hybrid",
  preferLocal: true,
  maxParallelAgents: 5,
  taskTimeoutMs: 300_000,       // 5 minutes per task
  orchestrationTimeoutMs: 3_600_000, // 1 hour per orchestration
  mcpEndpoints: [],
  apiEndpoints: {},
  useN8n: true,
  localModel: "llama3.2",
  cloudModel: "claude-sonnet-4-5",
};

export const DEFAULT_COMMUNICATION_CONFIG: CommunicationConfig = {
  channels: ["openclaw_cns", "ollama"],
  cns: {
    preferLocal: true,
    localModel: "llama3.2",
    cloudModel: "claude-sonnet-4-5",
  },
  n8n: {
    enabled: true,
    autoCreateWorkflows: false,
  },
  mcp: {
    endpoints: [],
    timeout: 30_000,
  },
};

export const DEFAULT_LONG_TERM_CONFIG: LongTermTaskConfig = {
  enableCheckpoints: true,
  checkpointIntervalMs: 300_000,  // 5 minutes
  maxRuntimeBeforeCheckpointMs: 600_000, // 10 minutes
  persistState: true,
  autoResume: true,
};

export const DEFAULT_AGENT_CREATION_CONFIG: AgentCreationConfig = {
  useSwarm: true,
  useAutonomousAgents: true,
  useAgentFactory: true,
  useOpenClawCNS: true,
  defaultExecutionMode: "hybrid",
  maxAgentsPerOrchestration: 10,
  autoReplicate: false,
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "tpl_researcher",
    name: "Researcher",
    description: "Gathers information, searches the web, and synthesizes findings",
    type: "researcher",
    capabilities: ["research", "text_generation", "web_scraping", "knowledge_retrieval"],
    systemPrompt: "You are a thorough researcher. Gather information, verify facts, and provide well-sourced summaries.",
    tools: ["web_search", "document_reader", "knowledge_base"],
    modelPreference: "auto",
    complexityLevel: 5,
  },
  {
    id: "tpl_coder",
    name: "Coder",
    description: "Generates, reviews, and refactors code",
    type: "coder",
    capabilities: ["code_generation", "code_review", "debugging", "testing"],
    systemPrompt: "You are an expert software engineer. Write clean, tested, maintainable code.",
    tools: ["code_editor", "terminal", "git", "package_manager"],
    modelPreference: "cloud",
    complexityLevel: 7,
  },
  {
    id: "tpl_reviewer",
    name: "Code Reviewer",
    description: "Reviews code for quality, security, and best practices",
    type: "reviewer",
    capabilities: ["code_review", "debugging"],
    systemPrompt: "You are a meticulous code reviewer. Check for bugs, security issues, and best practices.",
    tools: ["code_editor", "linter"],
    modelPreference: "auto",
    complexityLevel: 5,
  },
  {
    id: "tpl_tester",
    name: "Tester",
    description: "Creates and runs tests for code",
    type: "tester",
    capabilities: ["testing", "code_generation", "debugging"],
    systemPrompt: "You are a QA engineer. Write comprehensive tests and ensure code quality.",
    tools: ["test_runner", "code_editor", "terminal"],
    modelPreference: "auto",
    complexityLevel: 6,
  },
  {
    id: "tpl_deployer",
    name: "Deployer",
    description: "Handles deployment, CI/CD, and infrastructure",
    type: "deployer",
    capabilities: ["deployment", "monitoring", "file_operations"],
    systemPrompt: "You are a DevOps engineer. Handle deployments safely with proper rollback plans.",
    tools: ["docker", "terminal", "cloud_provider"],
    modelPreference: "auto",
    complexityLevel: 8,
  },
  {
    id: "tpl_data_analyst",
    name: "Data Analyst",
    description: "Analyzes data, creates visualizations, and generates reports",
    type: "data_analyst",
    capabilities: ["data_analysis", "text_generation", "file_operations"],
    systemPrompt: "You are a data analyst. Analyze data thoroughly and present insights clearly.",
    tools: ["data_processor", "chart_generator", "file_reader"],
    modelPreference: "auto",
    complexityLevel: 6,
  },
  {
    id: "tpl_writer",
    name: "Writer",
    description: "Creates content, documentation, and creative writing",
    type: "writer",
    capabilities: ["text_generation", "research"],
    systemPrompt: "You are a skilled writer. Create clear, engaging content tailored to the audience.",
    tools: ["text_editor", "grammar_checker"],
    modelPreference: "local",
    complexityLevel: 4,
  },
  {
    id: "tpl_planner",
    name: "Planner",
    description: "Creates project plans, breaks down tasks, and manages timelines",
    type: "planner",
    capabilities: ["planning", "task_management", "text_generation"],
    systemPrompt: "You are a project planner. Break complex projects into actionable tasks with clear timelines.",
    tools: ["task_manager", "calendar", "document_editor"],
    modelPreference: "auto",
    complexityLevel: 5,
  },
  {
    id: "tpl_coordinator",
    name: "Coordinator",
    description: "Coordinates between agents, manages communication, resolves conflicts",
    type: "coordinator",
    capabilities: ["communication", "task_management", "planning"],
    systemPrompt: "You are a team coordinator. Facilitate communication, resolve conflicts, and ensure smooth workflow.",
    tools: ["messaging", "task_tracker"],
    modelPreference: "auto",
    complexityLevel: 6,
  },
  {
    id: "tpl_scraper",
    name: "Web Scraper",
    description: "Scrapes web pages and extracts structured data",
    type: "scraper",
    capabilities: ["web_scraping", "data_analysis", "file_operations"],
    systemPrompt: "You are a web scraping specialist. Extract data cleanly and respect rate limits.",
    tools: ["web_scraper", "data_parser", "file_writer"],
    modelPreference: "local",
    complexityLevel: 4,
  },
  {
    id: "tpl_monitor",
    name: "Monitor",
    description: "Monitors systems, alerts on issues, tracks metrics",
    type: "monitor",
    capabilities: ["monitoring", "communication", "data_analysis"],
    systemPrompt: "You are a system monitor. Watch for anomalies and alert promptly with context.",
    tools: ["metrics_collector", "alerting", "log_analyzer"],
    modelPreference: "local",
    complexityLevel: 3,
  },
];
