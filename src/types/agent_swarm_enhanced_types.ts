/**
 * Enhanced Agent Swarm System Types
 *
 * Exhaustive type system for a production-grade multi-agent swarm.
 * Extends the existing agent_swarm.ts with everything needed for:
 *
 * 1. SWARM TOPOLOGIES: Hierarchical, mesh, star, ring, tree, graph, hybrid
 * 2. AGENT LIFECYCLE: Spawn, train, specialize, replicate, evolve, retire
 * 3. TASK DECOMPOSITION: Auto-split complex tasks into sub-tasks
 * 4. CONSENSUS PROTOCOLS: Voting, quorum, leader election, Byzantine fault tolerance
 * 5. SHARED MEMORY: Vector store, knowledge graph, working memory
 * 6. COMMUNICATION: Direct, broadcast, publish-subscribe, blackboard, stigmergy
 * 7. RESOURCE MANAGEMENT: Token budgets, compute allocation, cost tracking
 * 8. SWARM INTELLIGENCE: Emergent behavior, collective optimization
 * 9. APP INTEGRATION: Agents operate on JoyCreate apps
 * 10. SUBAGENT BRIDGE: OpenClaw sessions ↔ Swarm agents
 * 11. MODEL ROUTING: Per-agent model selection, fallback chains
 * 12. TOOL ORCHESTRATION: MCP servers, n8n workflows, API tools
 * 13. EVALUATION: Automated scoring, A/B testing, fitness functions
 * 14. PERSISTENCE: Save/load swarms, checkpoint state, resume
 * 15. OBSERVABILITY: Traces, metrics, logs, cost per agent
 */

// Re-use branded IDs from existing system
export type SwarmId = string & { __brand: "SwarmId" };
export type AgentNodeId = string & { __brand: "AgentNodeId" };
export type WitnessId = string & { __brand: "WitnessId" };
export type MessageId = string & { __brand: "MessageId" };
export type KnowledgeId = string & { __brand: "KnowledgeId" };
export type TaskId = string & { __brand: "TaskId" };
export type PipelineId = string & { __brand: "PipelineId" };
export type ToolId = string & { __brand: "ToolId" };
export type BlueprintId = string & { __brand: "BlueprintId" };

// ============================================================================
// 1. SWARM TOPOLOGIES
// ============================================================================

export type SwarmTopology =
  | "hierarchical"   // Tree with coordinator → workers
  | "mesh"           // Every agent connects to every other
  | "star"           // Central hub with spoke agents
  | "ring"           // Agents form a ring, pass work around
  | "tree"           // Multi-level hierarchy
  | "pipeline"       // Sequential processing chain
  | "graph"          // Arbitrary directed graph
  | "hybrid"         // Mix of topologies
  | "swarm"          // Fully decentralized, emergent behavior
  | "market"         // Agents bid on tasks, market-driven allocation
  ;

export interface TopologyConfig {
  type: SwarmTopology;
  /** Max depth for hierarchical/tree */
  maxDepth?: number;
  /** Max connections per node for mesh/graph */
  maxConnections?: number;
  /** Allow dynamic restructuring */
  dynamic: boolean;
  /** Auto-optimize topology based on performance */
  autoOptimize: boolean;
  /** Custom adjacency matrix for graph topology */
  adjacencyMatrix?: Record<string, string[]>;
}

export interface TopologyEdge {
  from: AgentNodeId;
  to: AgentNodeId;
  weight: number;
  bidirectional: boolean;
  type: "command" | "data" | "knowledge" | "feedback" | "heartbeat";
  latency?: number;
  bandwidth?: number;
}

// ============================================================================
// 2. ENHANCED AGENT
// ============================================================================

export type EnhancedAgentStatus =
  | "spawning"
  | "initializing"
  | "idle"
  | "thinking"
  | "executing"
  | "waiting"
  | "blocked"
  | "paused"
  | "learning"
  | "replicating"
  | "evolving"
  | "retiring"
  | "error"
  | "terminated"
  ;

export type AgentSpecialization =
  | "generalist"
  | "coder"
  | "researcher"
  | "writer"
  | "analyst"
  | "designer"
  | "tester"
  | "reviewer"
  | "planner"
  | "debugger"
  | "devops"
  | "security"
  | "data-engineer"
  | "ml-engineer"
  | "product-manager"
  | "ux-designer"
  | "marketing"
  | "sales"
  | "customer-support"
  | "legal"
  | "finance"
  | "custom"
  ;

export interface EnhancedAgent {
  id: AgentNodeId;
  name: string;
  displayName: string;
  swarmId: SwarmId;
  
  /** What kind of agent */
  specialization: AgentSpecialization;
  role: AgentRole;
  status: EnhancedAgentStatus;
  
  /** Parent agent (for hierarchical) */
  parentId?: AgentNodeId;
  /** Child agents */
  childIds: AgentNodeId[];
  /** Connected agents (for mesh/graph) */
  connectionIds: AgentNodeId[];
  
  /** Model configuration */
  model: AgentModelConfig;
  /** System prompt */
  systemPrompt: string;
  /** Personality traits (affects behavior) */
  personality: AgentPersonality;
  
  /** Tools this agent can use */
  tools: AgentToolBinding[];
  /** Skills this agent has learned */
  skills: AgentSkill[];
  /** Capabilities */
  capabilities: AgentCapability[];
  
  /** Memory systems */
  memory: EnhancedAgentMemory;
  /** Resource allocation */
  resources: AgentResourceAllocation;
  /** Performance metrics */
  metrics: EnhancedAgentMetrics;
  
  /** Current task */
  currentTask?: TaskAssignment;
  /** Task queue */
  taskQueue: TaskAssignment[];
  /** Completed tasks */
  completedTasks: number;
  
  /** App integration */
  appBindings: AgentAppBinding[];
  /** OpenClaw session link */
  openClawSession?: OpenClawSessionLink;
  /** JoyCreate agent link */
  joyCreateAgentId?: number;
  
  /** Lineage tracking */
  lineage: AgentLineage;
  /** Fitness score for evolution */
  fitness: number;
  
  /** Timestamps */
  createdAt: string;
  lastActiveAt: string;
  retiredAt?: string;
}

// ============================================================================
// 3. MODEL CONFIGURATION
// ============================================================================

export interface AgentModelConfig {
  /** Primary model */
  primary: ModelSpec;
  /** Fallback chain */
  fallbacks: ModelSpec[];
  /** Use different models for different tasks */
  routing: ModelRoutingRule[];
  /** Token budget per turn */
  maxTokensPerTurn: number;
  /** Total token budget */
  totalTokenBudget: number;
  /** Tokens used so far */
  tokensUsed: number;
  /** Temperature */
  temperature: number;
  /** Enable extended thinking */
  thinking: boolean;
  /** Thinking budget */
  thinkingBudget?: number;
}

export interface ModelSpec {
  provider: "anthropic" | "openai" | "google" | "deepseek" | "ollama" | "openrouter" | "custom";
  modelId: string;
  displayName: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsThinking: boolean;
}

export interface ModelRoutingRule {
  /** Task pattern to match */
  taskPattern: string;
  /** Model to use */
  model: ModelSpec;
  /** Max tokens for this route */
  maxTokens?: number;
  /** Override temperature */
  temperature?: number;
}

// ============================================================================
// 4. PERSONALITY & BEHAVIOR
// ============================================================================

export interface AgentPersonality {
  /** Autonomy: how much it acts without asking (0-1) */
  autonomy: number;
  /** Creativity: how creative vs conservative (0-1) */
  creativity: number;
  /** Thoroughness: depth vs speed (0-1) */
  thoroughness: number;
  /** Collaboration: team-player vs lone-wolf (0-1) */
  collaboration: number;
  /** Risk tolerance: cautious vs bold (0-1) */
  riskTolerance: number;
  /** Verbosity: how much it explains (0-1) */
  verbosity: number;
  /** Custom traits */
  traits: Record<string, number>;
}

// ============================================================================
// 5. TOOLS & SKILLS
// ============================================================================

export interface AgentToolBinding {
  id: ToolId;
  name: string;
  type: "mcp" | "n8n-workflow" | "api" | "function" | "browser" | "file-system" | "database" | "shell" | "custom";
  description: string;
  /** Configuration */
  config: Record<string, any>;
  /** Is this tool currently available? */
  available: boolean;
  /** Usage count */
  usageCount: number;
  /** Average latency */
  avgLatency: number;
  /** Success rate */
  successRate: number;
}

export interface AgentSkill {
  id: string;
  name: string;
  category: string;
  proficiency: number; // 0-100
  learnedFrom: "preset" | "training" | "observation" | "transfer" | "evolution";
  examples: number;
  lastUsed?: string;
}

export interface AgentCapability {
  name: string;
  description: string;
  enabled: boolean;
}

// ============================================================================
// 6. MEMORY SYSTEMS
// ============================================================================

export interface EnhancedAgentMemory {
  /** Short-term: current conversation context */
  shortTerm: MemorySlot[];
  /** Long-term: learned facts and patterns */
  longTerm: MemorySlot[];
  /** Episodic: specific task experiences */
  episodic: EpisodicMemory[];
  /** Procedural: how-to knowledge */
  procedural: ProceduralMemory[];
  /** Working memory: scratch pad for current reasoning */
  workingMemory: WorkingMemoryItem[];
  /** Shared knowledge graph */
  knowledgeGraphAccess: boolean;
  /** Vector store access */
  vectorStoreAccess: boolean;
  
  /** Memory limits */
  maxShortTerm: number;
  maxLongTerm: number;
  /** Total memory tokens used */
  tokensUsed: number;
}

export interface MemorySlot {
  id: string;
  content: string;
  type: "fact" | "observation" | "decision" | "instruction" | "context" | "feedback";
  importance: number; // 0-1
  accessCount: number;
  lastAccessed: string;
  createdAt: string;
  expiresAt?: string;
  source: AgentNodeId | "user" | "system" | "knowledge-graph";
  embedding?: number[];
}

export interface EpisodicMemory {
  id: string;
  taskId: TaskId;
  taskDescription: string;
  steps: string[];
  outcome: "success" | "failure" | "partial";
  lessons: string[];
  timestamp: string;
}

export interface ProceduralMemory {
  id: string;
  procedure: string;
  steps: string[];
  preconditions: string[];
  postconditions: string[];
  successRate: number;
  usageCount: number;
}

export interface WorkingMemoryItem {
  id: string;
  label: string;
  content: any;
  type: "variable" | "hypothesis" | "partial-result" | "constraint" | "goal";
  createdAt: string;
}

// ============================================================================
// 7. TASK DECOMPOSITION
// ============================================================================

export interface TaskAssignment {
  id: TaskId;
  title: string;
  description: string;
  type: TaskType;
  
  /** Task decomposition */
  parentTaskId?: TaskId;
  subtasks: TaskAssignment[];
  
  /** Assignment */
  assignedTo?: AgentNodeId;
  assignedBy?: AgentNodeId | "user" | "system";
  
  /** Dependencies */
  dependsOn: TaskId[];
  blockedBy: TaskId[];
  
  /** Priority and scheduling */
  priority: "critical" | "high" | "medium" | "low" | "background";
  deadline?: string;
  estimatedTokens?: number;
  estimatedTime?: string;
  
  /** Status */
  status: TaskStatus;
  progress: number; // 0-100
  
  /** Results */
  result?: TaskResult;
  artifacts: TaskArtifact[];
  
  /** Evaluation */
  evaluation?: TaskEvaluation;
  
  /** Timing */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export type TaskType =
  | "research"
  | "code"
  | "test"
  | "review"
  | "debug"
  | "design"
  | "write"
  | "analyze"
  | "plan"
  | "deploy"
  | "monitor"
  | "communicate"
  | "decide"
  | "teach"
  | "learn"
  | "custom"
  ;

export type TaskStatus =
  | "created"
  | "queued"
  | "assigned"
  | "in-progress"
  | "waiting-input"
  | "waiting-dependency"
  | "under-review"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying"
  ;

export interface TaskResult {
  success: boolean;
  output: any;
  summary: string;
  tokensUsed: number;
  cost: number;
  duration: number;
}

export interface TaskArtifact {
  id: string;
  name: string;
  type: "code" | "document" | "data" | "image" | "model" | "config" | "test" | "report";
  path?: string;
  content?: string;
  size: number;
  createdAt: string;
}

export interface TaskEvaluation {
  score: number; // 0-100
  evaluatedBy: AgentNodeId | "user" | "auto";
  criteria: EvaluationCriterion[];
  feedback: string;
  timestamp: string;
}

export interface EvaluationCriterion {
  name: string;
  score: number;
  weight: number;
  comment?: string;
}

// ============================================================================
// 8. COMMUNICATION PROTOCOLS
// ============================================================================

export type CommunicationProtocol =
  | "direct"           // Point-to-point
  | "broadcast"        // One to all
  | "multicast"        // One to group
  | "pub-sub"          // Topic-based
  | "blackboard"       // Shared workspace
  | "stigmergy"        // Indirect through environment
  | "contract-net"     // Task announcement + bidding
  | "auction"          // Competitive bidding
  | "negotiation"      // Back-and-forth
  | "voting"           // Democratic decision
  | "consensus"        // Agreement protocol
  ;

export interface SwarmMessage {
  id: MessageId;
  swarmId: SwarmId;
  from: AgentNodeId | "user" | "system";
  to: AgentNodeId | AgentNodeId[] | "all" | "coordinators" | "workers";
  type: MessageCategory;
  protocol: CommunicationProtocol;
  
  /** Content */
  subject: string;
  body: string;
  attachments: TaskArtifact[];
  
  /** Threading */
  replyTo?: MessageId;
  threadId?: string;
  
  /** Priority */
  priority: "urgent" | "high" | "normal" | "low";
  
  /** Delivery */
  deliveredTo: AgentNodeId[];
  readBy: AgentNodeId[];
  
  /** Timing */
  sentAt: string;
  expiresAt?: string;
}

export type MessageCategory =
  | "task-assignment"
  | "task-result"
  | "task-status"
  | "question"
  | "answer"
  | "feedback"
  | "knowledge-share"
  | "coordination"
  | "negotiation"
  | "vote"
  | "alert"
  | "heartbeat"
  | "capability-query"
  | "capability-response"
  | "bid"
  | "contract"
  ;

// ============================================================================
// 9. CONSENSUS PROTOCOLS
// ============================================================================

export type ConsensusAlgorithm =
  | "simple-majority"     // >50% agree
  | "supermajority"       // ≥2/3 agree
  | "unanimity"           // All agree
  | "quorum"              // Minimum participants
  | "weighted-vote"       // Votes weighted by fitness/reputation
  | "leader-election"     // Elect a leader, leader decides
  | "bft"                 // Byzantine fault tolerant
  | "raft"                // Raft consensus
  | "round-robin"         // Take turns deciding
  ;

export interface ConsensusRound {
  id: string;
  swarmId: SwarmId;
  topic: string;
  description: string;
  algorithm: ConsensusAlgorithm;
  
  /** Options to vote on */
  options: ConsensusOption[];
  /** Who can vote */
  voters: AgentNodeId[];
  /** Votes cast */
  votes: ConsensusVote[];
  /** Quorum required */
  quorum?: number;
  
  /** Result */
  status: "open" | "closed" | "decided" | "failed";
  winner?: string;
  decidedAt?: string;
  
  createdAt: string;
  deadline?: string;
}

export interface ConsensusOption {
  id: string;
  label: string;
  description: string;
  proposedBy: AgentNodeId;
}

export interface ConsensusVote {
  voterId: AgentNodeId;
  optionId: string;
  weight: number;
  reasoning: string;
  timestamp: string;
}

// ============================================================================
// 10. RESOURCE MANAGEMENT
// ============================================================================

export interface AgentResourceAllocation {
  /** Token budgets */
  tokens: {
    allocated: number;
    used: number;
    remaining: number;
    perTurnLimit: number;
    dailyLimit: number;
    dailyUsed: number;
  };
  
  /** Cost tracking */
  cost: {
    total: number;
    today: number;
    budget: number;
    currency: "USD";
    perTask: CostEntry[];
  };
  
  /** Compute allocation */
  compute: {
    priority: "high" | "normal" | "low" | "background";
    maxConcurrentTools: number;
    timeoutMs: number;
    retryLimit: number;
  };
  
  /** Rate limiting */
  rateLimit: {
    requestsPerMinute: number;
    requestsUsed: number;
    resetAt: string;
  };
}

export interface CostEntry {
  taskId: TaskId;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  timestamp: string;
}

// ============================================================================
// 11. METRICS & OBSERVABILITY
// ============================================================================

export interface EnhancedAgentMetrics {
  /** Task metrics */
  tasks: {
    total: number;
    completed: number;
    failed: number;
    avgDuration: number;
    avgScore: number;
    successRate: number;
    byType: Record<string, { count: number; avgScore: number }>;
  };
  
  /** Token metrics */
  tokens: {
    totalInput: number;
    totalOutput: number;
    avgPerTask: number;
    efficiency: number; // output quality per token
  };
  
  /** Cost metrics */
  cost: {
    total: number;
    avgPerTask: number;
    costPerQualityPoint: number;
  };
  
  /** Communication metrics */
  communication: {
    messagesSent: number;
    messagesReceived: number;
    avgResponseTime: number;
    collaborationScore: number;
  };
  
  /** Tool usage metrics */
  toolUsage: {
    totalCalls: number;
    byTool: Record<string, { count: number; avgLatency: number; successRate: number }>;
  };
  
  /** Learning metrics */
  learning: {
    skillsLearned: number;
    memoryRetention: number;
    adaptationRate: number;
  };
  
  /** Fitness for evolution */
  fitness: {
    current: number;
    history: { timestamp: string; value: number }[];
    rank: number; // within swarm
  };
}

export interface SwarmMetrics {
  swarmId: SwarmId;
  
  /** Overall metrics */
  agents: {
    total: number;
    active: number;
    idle: number;
    error: number;
    byRole: Record<string, number>;
    bySpecialization: Record<string, number>;
  };
  
  /** Task metrics */
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    queued: number;
    failed: number;
    throughput: number; // tasks per hour
    avgLatency: number;
  };
  
  /** Resource metrics */
  resources: {
    totalTokensUsed: number;
    totalCost: number;
    costPerTask: number;
    efficiency: number;
  };
  
  /** Communication health */
  communication: {
    totalMessages: number;
    avgLatency: number;
    bottlenecks: AgentNodeId[];
  };
  
  /** Swarm intelligence */
  intelligence: {
    collectiveScore: number;
    emergentBehaviors: string[];
    convergenceRate: number;
    diversityIndex: number;
  };
  
  /** Time series */
  timeSeries: {
    throughput: { timestamp: string; value: number }[];
    cost: { timestamp: string; value: number }[];
    fitness: { timestamp: string; value: number }[];
    agentCount: { timestamp: string; value: number }[];
  };
}

// ============================================================================
// 12. APP & SUBAGENT INTEGRATION
// ============================================================================

export interface AgentAppBinding {
  appId: number;
  appName: string;
  bindingType: "builder" | "tester" | "monitor" | "maintainer" | "deployer" | "support";
  permissions: ("read" | "write" | "deploy" | "delete" | "admin")[];
  projectPath?: string;
  chatId?: number;
}

export interface OpenClawSessionLink {
  sessionKey: string;
  sessionType: "main" | "isolated" | "persistent";
  agentId?: string;
  runtime: "subagent" | "acp";
  status: "active" | "idle" | "completed" | "error";
  lastMessage?: string;
  lastActivity: string;
}

// ============================================================================
// 13. EVOLUTION & GENETIC ALGORITHMS
// ============================================================================

export interface EvolutionConfig {
  enabled: boolean;
  /** Population size */
  populationSize: number;
  /** How many survive each generation */
  survivalRate: number;
  /** Mutation rate (0-1) */
  mutationRate: number;
  /** Crossover rate (0-1) */
  crossoverRate: number;
  /** Fitness function */
  fitnessFunction: FitnessFunction;
  /** Generations before stopping */
  maxGenerations: number;
  /** Current generation */
  currentGeneration: number;
  /** Elite preservation */
  eliteCount: number;
  /** Selection strategy */
  selectionStrategy: "tournament" | "roulette" | "rank" | "elitist";
}

export interface FitnessFunction {
  /** Weighted criteria */
  criteria: {
    name: string;
    weight: number;
    metric: string; // path in metrics
    targetDirection: "maximize" | "minimize";
  }[];
}

export interface EvolutionGeneration {
  number: number;
  population: AgentNodeId[];
  bestFitness: number;
  avgFitness: number;
  worstFitness: number;
  survivors: AgentNodeId[];
  newborns: AgentNodeId[];
  mutations: MutationRecord[];
  timestamp: string;
}

export interface MutationRecord {
  agentId: AgentNodeId;
  type: "system-prompt" | "temperature" | "tools" | "personality" | "model" | "specialization";
  before: any;
  after: any;
}

// ============================================================================
// 14. SWARM BLUEPRINTS (Templates)
// ============================================================================

export interface SwarmBlueprint {
  id: BlueprintId;
  name: string;
  description: string;
  category: "development" | "research" | "content" | "analysis" | "support" | "operations" | "creative" | "custom";
  
  /** Agent templates */
  agents: SwarmAgentTemplate[];
  /** Topology */
  topology: TopologyConfig;
  /** Communication protocol */
  protocol: CommunicationProtocol;
  /** Consensus algorithm */
  consensus: ConsensusAlgorithm;
  
  /** Evolution config */
  evolution?: EvolutionConfig;
  
  /** Resource budgets */
  tokenBudget: number;
  costBudget: number;
  
  /** Metadata */
  author: string;
  version: string;
  tags: string[];
  uses: number;
  rating: number;
  
  createdAt: string;
}

export interface SwarmAgentTemplate {
  name: string;
  role: AgentRole;
  specialization: AgentSpecialization;
  systemPrompt: string;
  personality: AgentPersonality;
  model: Partial<AgentModelConfig>;
  tools: string[];
  count: number;
}

export type AgentRole =
  | "coordinator"
  | "worker"
  | "specialist"
  | "scout"
  | "synthesizer"
  | "validator"
  | "witness"
  | "replicator"
  | "researcher"
  | "planner"
  | "executor"
  | "reviewer"
  | "teacher"
  | "learner"
  ;

// ============================================================================
// 15. PIPELINE ORCHESTRATION
// ============================================================================

export interface SwarmPipeline {
  id: PipelineId;
  name: string;
  description: string;
  swarmId: SwarmId;
  
  /** Pipeline stages */
  stages: PipelineStage[];
  /** Global inputs */
  inputs: PipelineIO[];
  /** Global outputs */
  outputs: PipelineIO[];
  
  /** Execution */
  status: "draft" | "running" | "paused" | "completed" | "failed";
  currentStage?: number;
  runs: PipelineRun[];
  
  /** Scheduling */
  schedule?: {
    type: "manual" | "cron" | "trigger" | "continuous";
    expression?: string;
    trigger?: string;
  };
  
  createdAt: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  type: "sequential" | "parallel" | "conditional" | "loop" | "map-reduce";
  
  /** Agents involved */
  agentIds: AgentNodeId[];
  /** Or auto-assign from pool */
  autoAssign?: {
    role?: AgentRole;
    specialization?: AgentSpecialization;
    count: number;
  };
  
  /** Task definition */
  task: {
    type: TaskType;
    prompt: string;
    inputs: string[];
    expectedOutputs: string[];
    maxRetries: number;
    timeoutMs: number;
  };
  
  /** Condition for conditional type */
  condition?: string;
  /** Loop config */
  loopConfig?: { maxIterations: number; exitCondition: string };
  /** Map-reduce config */
  mapReduceConfig?: { splitBy: string; reduceBy: string };
  
  /** Quality gate */
  qualityGate?: {
    minScore: number;
    evaluator: AgentNodeId | "auto";
  };
}

export interface PipelineIO {
  name: string;
  type: "text" | "code" | "data" | "file" | "model" | "config";
  description: string;
  required: boolean;
  value?: any;
}

export interface PipelineRun {
  id: string;
  pipelineId: PipelineId;
  status: "running" | "completed" | "failed" | "cancelled";
  stages: PipelineStageResult[];
  totalDuration: number;
  totalCost: number;
  totalTokens: number;
  startedAt: string;
  completedAt?: string;
}

export interface PipelineStageResult {
  stageId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  agentId?: AgentNodeId;
  result?: any;
  duration: number;
  cost: number;
  tokens: number;
  error?: string;
}

// ============================================================================
// 16. ENHANCED SWARM (Top-level)
// ============================================================================

export interface EnhancedSwarm {
  id: SwarmId;
  name: string;
  description: string;
  status: SwarmStatus;
  
  /** Topology */
  topology: TopologyConfig;
  edges: TopologyEdge[];
  
  /** Agents */
  agents: EnhancedAgent[];
  
  /** Communication */
  protocol: CommunicationProtocol;
  messages: SwarmMessage[];
  
  /** Consensus */
  consensus: ConsensusAlgorithm;
  consensusRounds: ConsensusRound[];
  
  /** Tasks */
  taskQueue: TaskAssignment[];
  completedTasks: TaskAssignment[];
  
  /** Pipelines */
  pipelines: SwarmPipeline[];
  
  /** Knowledge */
  sharedKnowledge: SharedKnowledge[];
  knowledgeGraph?: KnowledgeGraphConfig;
  
  /** Evolution */
  evolution?: EvolutionConfig;
  generations: EvolutionGeneration[];
  
  /** Metrics */
  metrics: SwarmMetrics;
  
  /** Resource tracking */
  totalTokensUsed: number;
  totalCost: number;
  tokenBudget: number;
  costBudget: number;
  
  /** Blueprint this was created from */
  blueprintId?: BlueprintId;
  
  /** App bindings */
  appBindings: AgentAppBinding[];
  
  /** Persistence */
  checkpoints: SwarmCheckpoint[];
  lastCheckpoint?: string;
  
  createdAt: string;
  updatedAt: string;
}

export type SwarmStatus =
  | "created"
  | "initializing"
  | "running"
  | "paused"
  | "optimizing"
  | "evolving"
  | "completed"
  | "error"
  | "archived"
  ;

export interface SharedKnowledge {
  id: KnowledgeId;
  title: string;
  content: string;
  type: "fact" | "pattern" | "procedure" | "policy" | "lesson" | "artifact" | "reference";
  contributors: AgentNodeId[];
  accessCount: number;
  importance: number;
  tags: string[];
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeGraphConfig {
  enabled: boolean;
  nodes: number;
  edges: number;
  lastUpdated: string;
}

export interface SwarmCheckpoint {
  id: string;
  name: string;
  timestamp: string;
  agentCount: number;
  taskCount: number;
  totalCost: number;
  fitness: number;
  size: number;
}

// ============================================================================
// 17. SWARM EVENTS
// ============================================================================

export type EnhancedSwarmEventType =
  | "swarm:created"
  | "swarm:started"
  | "swarm:paused"
  | "swarm:resumed"
  | "swarm:completed"
  | "swarm:error"
  | "swarm:checkpoint"
  | "agent:spawned"
  | "agent:terminated"
  | "agent:error"
  | "agent:replicated"
  | "agent:evolved"
  | "agent:specialized"
  | "agent:tool-used"
  | "task:created"
  | "task:assigned"
  | "task:started"
  | "task:completed"
  | "task:failed"
  | "task:decomposed"
  | "message:sent"
  | "message:received"
  | "consensus:started"
  | "consensus:decided"
  | "pipeline:started"
  | "pipeline:stage-complete"
  | "pipeline:completed"
  | "evolution:generation-complete"
  | "knowledge:created"
  | "knowledge:updated"
  | "resource:budget-warning"
  | "resource:budget-exceeded"
  | "topology:restructured"
  ;

export interface EnhancedSwarmEvent {
  id: string;
  swarmId: SwarmId;
  type: EnhancedSwarmEventType;
  agentId?: AgentNodeId;
  taskId?: TaskId;
  pipelineId?: PipelineId;
  description: string;
  data: Record<string, any>;
  severity: "info" | "warning" | "error" | "critical";
  timestamp: string;
}
