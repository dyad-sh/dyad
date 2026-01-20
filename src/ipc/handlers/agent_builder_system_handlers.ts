/**
 * Agent Builder Handlers
 * Comprehensive system for building, configuring, and managing AI agents
 * 
 * Features:
 * - Agent definition and configuration
 * - Tool/capability management
 * - Memory and context systems
 * - Agent templates and presets
 * - Multi-agent coordination
 * - Agent versioning
 * - Performance monitoring
 */

import { ipcMain, app, BrowserWindow } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";

const logger = log.scope("agent_builder");

// ============================================================================
// Types
// ============================================================================

type AgentStatus = "draft" | "active" | "paused" | "archived";
type AgentCapability = "text_generation" | "code_generation" | "data_analysis" | "image_processing" | "web_search" | "file_operations" | "api_calls" | "custom";
type MemoryType = "short_term" | "long_term" | "episodic" | "semantic" | "working";

interface Agent {
  id: string;
  name: string;
  description?: string;
  version: string;
  status: AgentStatus;
  type: AgentType;
  config: AgentConfig;
  tools: AgentTool[];
  memory: MemoryConfig;
  prompts: AgentPrompts;
  constraints: AgentConstraints;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  tags: string[];
  stats: AgentStats;
}

type AgentType = 
  | "assistant" | "worker" | "coordinator" | "specialist" 
  | "data_processor" | "code_assistant" | "research_agent" 
  | "automation_agent" | "custom";

interface AgentConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  responseFormat?: "text" | "json" | "markdown";
  streamResponse?: boolean;
  timeout?: number;
  retryPolicy?: {
    maxAttempts: number;
    delayMs: number;
  };
  customParameters?: Record<string, any>;
}

interface AgentTool {
  id: string;
  name: string;
  description: string;
  type: "builtin" | "custom" | "mcp" | "api" | "script";
  enabled: boolean;
  config: Record<string, any>;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  permissions?: string[];
  rateLimiting?: {
    maxCallsPerMinute: number;
    maxCallsPerHour: number;
  };
}

interface MemoryConfig {
  enabled: boolean;
  types: MemoryType[];
  shortTermLimit: number;
  longTermEnabled: boolean;
  longTermStorage?: "local" | "vector_db" | "hybrid";
  contextWindowSize: number;
  summarizationEnabled: boolean;
  summarizationThreshold: number;
}

interface AgentPrompts {
  system: string;
  userTemplate?: string;
  assistantPrefix?: string;
  examples?: Array<{
    user: string;
    assistant: string;
  }>;
  customPrompts?: Record<string, string>;
}

interface AgentConstraints {
  maxExecutionTime?: number;
  maxIterations?: number;
  maxToolCalls?: number;
  allowedDomains?: string[];
  blockedPatterns?: string[];
  outputValidation?: {
    enabled: boolean;
    schema?: Record<string, any>;
    customValidator?: string;
  };
  safetyFilters?: {
    enabled: boolean;
    level: "low" | "medium" | "high";
    customFilters?: string[];
  };
}

interface AgentStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageResponseTime: number;
  averageTokensUsed: number;
  lastExecutedAt?: Date;
  toolUsage: Record<string, number>;
}

interface AgentExecution {
  id: string;
  agentId: string;
  agentVersion: string;
  status: "running" | "completed" | "failed" | "cancelled";
  input: any;
  output?: any;
  context: ExecutionContext;
  steps: ExecutionStep[];
  metrics: ExecutionMetrics;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

interface ExecutionContext {
  sessionId?: string;
  userId?: string;
  parentExecutionId?: string;
  variables: Record<string, any>;
  memory: any[];
}

interface ExecutionStep {
  id: string;
  type: "thought" | "tool_call" | "observation" | "response";
  content: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  timestamp: Date;
  duration?: number;
}

interface ExecutionMetrics {
  totalDuration: number;
  thinkingTime: number;
  toolCallTime: number;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  toolCallCount: number;
  iterationCount: number;
}

interface AgentTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  agent: Omit<Agent, "id" | "createdAt" | "updatedAt" | "stats">;
}

interface AgentTeam {
  id: string;
  name: string;
  description?: string;
  agents: TeamMember[];
  coordinator?: string; // Agent ID
  communicationPattern: "broadcast" | "chain" | "hub_spoke" | "mesh";
  taskDistribution: "round_robin" | "capability_based" | "load_balanced" | "custom";
  sharedMemory: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TeamMember {
  agentId: string;
  role: string;
  capabilities: string[];
  priority: number;
}

// ============================================================================
// Storage
// ============================================================================

const agents: Map<string, Agent> = new Map();
const executions: Map<string, AgentExecution> = new Map();
const teams: Map<string, AgentTeam> = new Map();
const templates: Map<string, AgentTemplate> = new Map();
const sessions: Map<string, { agentId: string; memory: any[]; createdAt: Date }> = new Map();

function getAgentStorageDir(): string {
  return path.join(app.getPath("userData"), "agents");
}

async function initializeAgentStorage() {
  const storageDir = getAgentStorageDir();
  await fs.ensureDir(storageDir);
  await fs.ensureDir(path.join(storageDir, "executions"));
  await fs.ensureDir(path.join(storageDir, "memory"));
  
  // Load agents
  const agentsPath = path.join(storageDir, "agents.json");
  if (await fs.pathExists(agentsPath)) {
    const data = await fs.readJson(agentsPath);
    for (const a of data) {
      agents.set(a.id, {
        ...a,
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
        stats: a.stats || createDefaultStats(),
      });
    }
  }
  
  // Load teams
  const teamsPath = path.join(storageDir, "teams.json");
  if (await fs.pathExists(teamsPath)) {
    const data = await fs.readJson(teamsPath);
    for (const t of data) {
      teams.set(t.id, {
        ...t,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
      });
    }
  }
  
  // Initialize default templates
  initializeDefaultTemplates();
  
  logger.info(`Loaded ${agents.size} agents, ${teams.size} teams`);
}

function createDefaultStats(): AgentStats {
  return {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageResponseTime: 0,
    averageTokensUsed: 0,
    toolUsage: {},
  };
}

function initializeDefaultTemplates() {
  const defaultTemplates: AgentTemplate[] = [
    {
      id: "data-analyst",
      name: "Data Analyst",
      description: "Specialized agent for data analysis and visualization",
      category: "data",
      agent: {
        name: "Data Analyst",
        description: "Analyzes datasets, generates insights, and creates visualizations",
        version: "1.0.0",
        status: "active",
        type: "specialist",
        config: {
          model: "gpt-4",
          temperature: 0.3,
          maxTokens: 4096,
          responseFormat: "markdown",
        },
        tools: [
          { id: "sql-query", name: "SQL Query", description: "Execute SQL queries", type: "builtin", enabled: true, config: {} },
          { id: "data-viz", name: "Data Visualization", description: "Create charts and graphs", type: "builtin", enabled: true, config: {} },
          { id: "stats", name: "Statistical Analysis", description: "Perform statistical analysis", type: "builtin", enabled: true, config: {} },
        ],
        memory: {
          enabled: true,
          types: ["working", "short_term"],
          shortTermLimit: 50,
          longTermEnabled: false,
          contextWindowSize: 8000,
          summarizationEnabled: true,
          summarizationThreshold: 5000,
        },
        prompts: {
          system: `You are an expert data analyst. Your role is to:
1. Analyze datasets and identify patterns
2. Generate statistical insights
3. Create clear visualizations
4. Provide actionable recommendations

Always explain your methodology and be precise with numbers.`,
        },
        constraints: {
          maxIterations: 10,
          maxToolCalls: 20,
        },
        metadata: {},
        tags: ["data", "analysis", "visualization"],
      },
    },
    {
      id: "code-assistant",
      name: "Code Assistant",
      description: "Helps with code generation, review, and debugging",
      category: "development",
      agent: {
        name: "Code Assistant",
        description: "Expert coding assistant for multiple languages",
        version: "1.0.0",
        status: "active",
        type: "code_assistant",
        config: {
          model: "gpt-4",
          temperature: 0.2,
          maxTokens: 8192,
          responseFormat: "markdown",
        },
        tools: [
          { id: "code-exec", name: "Code Execution", description: "Execute code snippets", type: "builtin", enabled: true, config: {} },
          { id: "file-read", name: "File Read", description: "Read source files", type: "builtin", enabled: true, config: {} },
          { id: "file-write", name: "File Write", description: "Write to files", type: "builtin", enabled: true, config: {} },
          { id: "search", name: "Code Search", description: "Search codebase", type: "builtin", enabled: true, config: {} },
        ],
        memory: {
          enabled: true,
          types: ["working", "short_term"],
          shortTermLimit: 100,
          longTermEnabled: false,
          contextWindowSize: 16000,
          summarizationEnabled: true,
          summarizationThreshold: 10000,
        },
        prompts: {
          system: `You are an expert software engineer. Your role is to:
1. Write clean, efficient, and well-documented code
2. Review code and suggest improvements
3. Debug issues and explain root causes
4. Follow best practices and design patterns

Always explain your approach and consider edge cases.`,
        },
        constraints: {
          maxIterations: 15,
          maxToolCalls: 30,
        },
        metadata: {},
        tags: ["code", "development", "debugging"],
      },
    },
    {
      id: "research-agent",
      name: "Research Agent",
      description: "Conducts research and synthesizes information",
      category: "research",
      agent: {
        name: "Research Agent",
        description: "Searches, synthesizes, and summarizes information",
        version: "1.0.0",
        status: "active",
        type: "research_agent",
        config: {
          model: "gpt-4",
          temperature: 0.5,
          maxTokens: 4096,
          responseFormat: "markdown",
        },
        tools: [
          { id: "web-search", name: "Web Search", description: "Search the web", type: "builtin", enabled: true, config: {} },
          { id: "scrape", name: "Web Scraper", description: "Extract content from pages", type: "builtin", enabled: true, config: {} },
          { id: "summarize", name: "Summarizer", description: "Summarize long content", type: "builtin", enabled: true, config: {} },
        ],
        memory: {
          enabled: true,
          types: ["working", "short_term", "long_term"],
          shortTermLimit: 100,
          longTermEnabled: true,
          longTermStorage: "local",
          contextWindowSize: 8000,
          summarizationEnabled: true,
          summarizationThreshold: 6000,
        },
        prompts: {
          system: `You are a thorough research analyst. Your role is to:
1. Search for relevant information from multiple sources
2. Verify facts and cross-reference data
3. Synthesize findings into coherent reports
4. Cite sources and highlight uncertainties

Always be objective and distinguish between facts and interpretations.`,
        },
        constraints: {
          maxIterations: 20,
          maxToolCalls: 50,
          allowedDomains: ["*.edu", "*.gov", "*.org", "wikipedia.org"],
        },
        metadata: {},
        tags: ["research", "search", "synthesis"],
      },
    },
    {
      id: "automation-agent",
      name: "Automation Agent",
      description: "Automates repetitive tasks and workflows",
      category: "automation",
      agent: {
        name: "Automation Agent",
        description: "Executes automated workflows and tasks",
        version: "1.0.0",
        status: "active",
        type: "automation_agent",
        config: {
          model: "gpt-4",
          temperature: 0.1,
          maxTokens: 2048,
          responseFormat: "json",
        },
        tools: [
          { id: "http", name: "HTTP Client", description: "Make HTTP requests", type: "builtin", enabled: true, config: {} },
          { id: "file-ops", name: "File Operations", description: "File system operations", type: "builtin", enabled: true, config: {} },
          { id: "scheduler", name: "Scheduler", description: "Schedule tasks", type: "builtin", enabled: true, config: {} },
          { id: "n8n", name: "N8n Integration", description: "Trigger n8n workflows", type: "builtin", enabled: true, config: {} },
        ],
        memory: {
          enabled: true,
          types: ["working"],
          shortTermLimit: 20,
          longTermEnabled: false,
          contextWindowSize: 4000,
          summarizationEnabled: false,
          summarizationThreshold: 3000,
        },
        prompts: {
          system: `You are an automation specialist. Your role is to:
1. Execute predefined automation tasks
2. Handle errors gracefully with retries
3. Log all actions for audit trails
4. Notify on completion or failure

Be precise and reliable. Always validate inputs before executing actions.`,
        },
        constraints: {
          maxIterations: 50,
          maxToolCalls: 100,
          maxExecutionTime: 300000, // 5 minutes
        },
        metadata: {},
        tags: ["automation", "workflow", "tasks"],
      },
    },
    {
      id: "coordinator",
      name: "Team Coordinator",
      description: "Coordinates multiple agents to accomplish complex tasks",
      category: "coordination",
      agent: {
        name: "Team Coordinator",
        description: "Orchestrates multiple specialized agents",
        version: "1.0.0",
        status: "active",
        type: "coordinator",
        config: {
          model: "gpt-4",
          temperature: 0.4,
          maxTokens: 4096,
          responseFormat: "json",
        },
        tools: [
          { id: "delegate", name: "Delegate Task", description: "Assign task to agent", type: "builtin", enabled: true, config: {} },
          { id: "monitor", name: "Monitor Progress", description: "Check agent progress", type: "builtin", enabled: true, config: {} },
          { id: "aggregate", name: "Aggregate Results", description: "Combine agent outputs", type: "builtin", enabled: true, config: {} },
        ],
        memory: {
          enabled: true,
          types: ["working", "short_term"],
          shortTermLimit: 200,
          longTermEnabled: false,
          contextWindowSize: 8000,
          summarizationEnabled: true,
          summarizationThreshold: 6000,
        },
        prompts: {
          system: `You are a team coordinator. Your role is to:
1. Break down complex tasks into subtasks
2. Assign subtasks to appropriate specialized agents
3. Monitor progress and handle dependencies
4. Aggregate results into a coherent final output

Be strategic about task distribution and handle failures gracefully.`,
        },
        constraints: {
          maxIterations: 30,
          maxToolCalls: 100,
        },
        metadata: {},
        tags: ["coordination", "multi-agent", "orchestration"],
      },
    },
  ];
  
  for (const t of defaultTemplates) {
    templates.set(t.id, t);
  }
}

async function saveAgents() {
  const storageDir = getAgentStorageDir();
  await fs.writeJson(
    path.join(storageDir, "agents.json"),
    Array.from(agents.values()),
    { spaces: 2 }
  );
}

async function saveTeams() {
  const storageDir = getAgentStorageDir();
  await fs.writeJson(
    path.join(storageDir, "teams.json"),
    Array.from(teams.values()),
    { spaces: 2 }
  );
}

async function saveExecution(execution: AgentExecution) {
  const storageDir = getAgentStorageDir();
  await fs.writeJson(
    path.join(storageDir, "executions", `${execution.id}.json`),
    execution,
    { spaces: 2 }
  );
}

// ============================================================================
// Agent Execution Engine
// ============================================================================

async function executeAgentInternal(
  agent: Agent,
  input: any,
  context?: Partial<ExecutionContext>
): Promise<AgentExecution> {
  const executionId = uuidv4();
  const startTime = Date.now();
  
  const execution: AgentExecution = {
    id: executionId,
    agentId: agent.id,
    agentVersion: agent.version,
    status: "running",
    input,
    context: {
      sessionId: context?.sessionId,
      userId: context?.userId,
      parentExecutionId: context?.parentExecutionId,
      variables: context?.variables || {},
      memory: context?.memory || [],
    },
    steps: [],
    metrics: {
      totalDuration: 0,
      thinkingTime: 0,
      toolCallTime: 0,
      tokensUsed: { input: 0, output: 0, total: 0 },
      toolCallCount: 0,
      iterationCount: 0,
    },
    startedAt: new Date(),
  };
  
  executions.set(executionId, execution);
  
  try {
    // Load session memory if available
    if (context?.sessionId && sessions.has(context.sessionId)) {
      const session = sessions.get(context.sessionId)!;
      execution.context.memory = [...session.memory];
    }
    
    // Execute agent loop
    let iterationCount = 0;
    const maxIterations = agent.constraints.maxIterations || 10;
    let currentInput = input;
    
    while (iterationCount < maxIterations && execution.status === "running") {
      iterationCount++;
      execution.metrics.iterationCount = iterationCount;
      
      // Generate response (simulated - would integrate with actual LLM)
      const thinkingStart = Date.now();
      const thought = await generateAgentThought(agent, currentInput, execution.context);
      execution.metrics.thinkingTime += Date.now() - thinkingStart;
      
      execution.steps.push({
        id: uuidv4(),
        type: "thought",
        content: thought.reasoning,
        timestamp: new Date(),
      });
      
      if (thought.action === "respond") {
        // Final response
        execution.output = thought.response;
        execution.status = "completed";
        break;
      } else if (thought.action === "tool_call") {
        // Execute tool
        const toolStart = Date.now();
        const toolResult = await executeAgentTool(
          agent,
          thought.toolName!,
          thought.toolInput!,
          execution
        );
        execution.metrics.toolCallTime += Date.now() - toolStart;
        execution.metrics.toolCallCount++;
        
        execution.steps.push({
          id: uuidv4(),
          type: "tool_call",
          content: `Calling tool: ${thought.toolName}`,
          toolName: thought.toolName,
          toolInput: thought.toolInput,
          toolOutput: toolResult,
          timestamp: new Date(),
          duration: Date.now() - toolStart,
        });
        
        execution.steps.push({
          id: uuidv4(),
          type: "observation",
          content: JSON.stringify(toolResult),
          timestamp: new Date(),
        });
        
        // Update input for next iteration
        currentInput = {
          ...currentInput,
          lastToolResult: toolResult,
          toolHistory: execution.steps.filter(s => s.type === "tool_call"),
        };
      }
      
      // Check constraints
      if (agent.constraints.maxToolCalls && 
          execution.metrics.toolCallCount >= agent.constraints.maxToolCalls) {
        execution.output = { error: "Max tool calls exceeded", partialResult: currentInput };
        execution.status = "completed";
        break;
      }
      
      if (agent.constraints.maxExecutionTime && 
          Date.now() - startTime >= agent.constraints.maxExecutionTime) {
        execution.output = { error: "Execution timeout", partialResult: currentInput };
        execution.status = "failed";
        execution.error = "Execution timeout";
        break;
      }
    }
    
    // Update metrics
    execution.metrics.totalDuration = Date.now() - startTime;
    execution.completedAt = new Date();
    
    // Update agent stats
    updateAgentStats(agent, execution);
    
    // Update session memory
    if (context?.sessionId) {
      updateSessionMemory(context.sessionId, agent.id, execution);
    }
    
  } catch (error: any) {
    execution.status = "failed";
    execution.error = error.message;
    execution.completedAt = new Date();
    execution.metrics.totalDuration = Date.now() - startTime;
    
    // Update failure stats
    agent.stats.totalExecutions++;
    agent.stats.failedExecutions++;
    await saveAgents();
  }
  
  await saveExecution(execution);
  
  // Notify renderer
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("agent:execution-completed", {
      executionId,
      agentId: agent.id,
      status: execution.status,
      duration: execution.metrics.totalDuration,
    });
  }
  
  return execution;
}

async function generateAgentThought(
  agent: Agent,
  input: any,
  context: ExecutionContext
): Promise<{
  reasoning: string;
  action: "respond" | "tool_call";
  response?: any;
  toolName?: string;
  toolInput?: any;
}> {
  // This would integrate with actual LLM
  // For now, return simulated response
  
  const enabledTools = agent.tools.filter(t => t.enabled);
  
  // Simple heuristic: if input mentions a tool capability, call it
  const inputStr = JSON.stringify(input).toLowerCase();
  
  for (const tool of enabledTools) {
    if (inputStr.includes(tool.name.toLowerCase()) ||
        inputStr.includes(tool.description.toLowerCase())) {
      return {
        reasoning: `Input requires using ${tool.name}`,
        action: "tool_call",
        toolName: tool.name,
        toolInput: input,
      };
    }
  }
  
  // Default: generate response
  return {
    reasoning: "Processing input and generating response",
    action: "respond",
    response: {
      message: "Task completed successfully",
      input,
      processedAt: new Date(),
    },
  };
}

async function executeAgentTool(
  agent: Agent,
  toolName: string,
  toolInput: any,
  execution: AgentExecution
): Promise<any> {
  const tool = agent.tools.find(t => t.name === toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  if (!tool.enabled) throw new Error(`Tool is disabled: ${toolName}`);
  
  // Update tool usage stats
  agent.stats.toolUsage[toolName] = (agent.stats.toolUsage[toolName] || 0) + 1;
  
  // Execute based on tool type
  switch (tool.type) {
    case "builtin":
      return executeBuiltinTool(tool, toolInput);
    
    case "custom":
      return executeCustomTool(tool, toolInput);
    
    case "mcp":
      return executeMcpTool(tool, toolInput);
    
    case "api":
      return executeApiTool(tool, toolInput);
    
    case "script":
      return executeScriptTool(tool, toolInput);
    
    default:
      throw new Error(`Unknown tool type: ${tool.type}`);
  }
}

async function executeBuiltinTool(tool: AgentTool, input: any): Promise<any> {
  switch (tool.id) {
    case "sql-query":
      return { success: true, rows: [], message: "Query executed" };
    
    case "data-viz":
      return { success: true, chartType: "bar", data: input };
    
    case "stats":
      return { success: true, mean: 0, median: 0, std: 0 };
    
    case "code-exec":
      return { success: true, output: "", exitCode: 0 };
    
    case "file-read":
      return { success: true, content: "" };
    
    case "file-write":
      return { success: true, written: true };
    
    case "search":
      return { success: true, results: [] };
    
    case "web-search":
      return { success: true, results: [] };
    
    case "scrape":
      return { success: true, content: "" };
    
    case "summarize":
      return { success: true, summary: "" };
    
    case "http":
      return { success: true, status: 200, data: {} };
    
    case "file-ops":
      return { success: true, operation: input.operation };
    
    case "scheduler":
      return { success: true, scheduled: true };
    
    case "n8n":
      return { success: true, triggered: true };
    
    case "delegate":
      return { success: true, delegated: true, agentId: input.agentId };
    
    case "monitor":
      return { success: true, status: "running", progress: 0.5 };
    
    case "aggregate":
      return { success: true, aggregated: input };
    
    default:
      return { success: true, toolId: tool.id, input };
  }
}

async function executeCustomTool(tool: AgentTool, input: any): Promise<any> {
  const { handler } = tool.config;
  if (!handler) throw new Error("Custom tool handler not defined");
  
  const fn = new Function("input", "config", handler);
  return fn(input, tool.config);
}

async function executeMcpTool(tool: AgentTool, input: any): Promise<any> {
  const { serverName, toolName } = tool.config;
  // Would integrate with MCP client
  return { success: true, serverName, toolName, input };
}

async function executeApiTool(tool: AgentTool, input: any): Promise<any> {
  const { endpoint, method, headers } = tool.config;
  
  const response = await fetch(endpoint, {
    method: method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(input),
  });
  
  return response.json();
}

async function executeScriptTool(tool: AgentTool, input: any): Promise<any> {
  const { language, script } = tool.config;
  
  if (language === "javascript") {
    const fn = new Function("input", script);
    return fn(input);
  }
  
  throw new Error(`Unsupported script language: ${language}`);
}

function updateAgentStats(agent: Agent, execution: AgentExecution) {
  agent.stats.totalExecutions++;
  
  if (execution.status === "completed") {
    agent.stats.successfulExecutions++;
  } else {
    agent.stats.failedExecutions++;
  }
  
  // Update averages
  const total = agent.stats.totalExecutions;
  agent.stats.averageResponseTime = 
    (agent.stats.averageResponseTime * (total - 1) + execution.metrics.totalDuration) / total;
  agent.stats.averageTokensUsed =
    (agent.stats.averageTokensUsed * (total - 1) + execution.metrics.tokensUsed.total) / total;
  
  agent.stats.lastExecutedAt = new Date();
  
  saveAgents();
}

function updateSessionMemory(sessionId: string, agentId: string, execution: AgentExecution) {
  let session = sessions.get(sessionId);
  
  if (!session) {
    session = { agentId, memory: [], createdAt: new Date() };
    sessions.set(sessionId, session);
  }
  
  // Add execution summary to memory
  session.memory.push({
    executionId: execution.id,
    input: execution.input,
    output: execution.output,
    timestamp: new Date(),
  });
  
  // Trim memory if too large
  const agent = agents.get(agentId);
  const limit = agent?.memory.shortTermLimit || 50;
  
  if (session.memory.length > limit) {
    session.memory = session.memory.slice(-limit);
  }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerAgentBuilderSystemHandlers() {
  logger.info("Registering Agent Builder System handlers");

  app.whenReady().then(() => {
    initializeAgentStorage().catch(err => {
      logger.error("Failed to initialize agent storage:", err);
    });
  });

  // ========== Agent CRUD ==========

  ipcMain.handle("agent-builder:create-agent", async (_event, args: {
    name: string;
    description?: string;
    type?: AgentType;
    config?: Partial<AgentConfig>;
    tools?: AgentTool[];
    memory?: Partial<MemoryConfig>;
    prompts?: Partial<AgentPrompts>;
    constraints?: Partial<AgentConstraints>;
    tags?: string[];
  }) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      const agent: Agent = {
        id,
        name: args.name,
        description: args.description,
        version: "1.0.0",
        status: "draft",
        type: args.type || "assistant",
        config: {
          model: "gpt-4",
          temperature: 0.7,
          maxTokens: 4096,
          ...args.config,
        },
        tools: args.tools || [],
        memory: {
          enabled: true,
          types: ["working", "short_term"],
          shortTermLimit: 50,
          longTermEnabled: false,
          contextWindowSize: 8000,
          summarizationEnabled: true,
          summarizationThreshold: 6000,
          ...args.memory,
        },
        prompts: {
          system: "You are a helpful assistant.",
          ...args.prompts,
        },
        constraints: {
          maxIterations: 10,
          maxToolCalls: 20,
          ...args.constraints,
        },
        metadata: {},
        createdAt: now,
        updatedAt: now,
        tags: args.tags || [],
        stats: createDefaultStats(),
      };
      
      agents.set(id, agent);
      await saveAgents();
      
      return { success: true, agent };
    } catch (error) {
      logger.error("Create agent failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:create-from-template", async (_event, args: {
    templateId: string;
    name: string;
    description?: string;
    customizations?: Partial<Agent>;
  }) => {
    try {
      const template = templates.get(args.templateId);
      if (!template) throw new Error("Template not found");
      
      const id = uuidv4();
      const now = new Date();
      
      const agent: Agent = {
        ...template.agent,
        ...args.customizations,
        id,
        name: args.name,
        description: args.description || template.agent.description,
        createdAt: now,
        updatedAt: now,
        stats: createDefaultStats(),
      };
      
      agents.set(id, agent);
      await saveAgents();
      
      return { success: true, agent };
    } catch (error) {
      logger.error("Create from template failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:get-agent", async (_event, agentId: string) => {
    try {
      const agent = agents.get(agentId);
      if (!agent) throw new Error("Agent not found");
      
      return { success: true, agent };
    } catch (error) {
      logger.error("Get agent failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:list-agents", async (_event, args?: {
    status?: AgentStatus;
    type?: AgentType;
    tags?: string[];
    search?: string;
  }) => {
    try {
      let result = Array.from(agents.values());
      
      if (args?.status) {
        result = result.filter(a => a.status === args.status);
      }
      
      if (args?.type) {
        result = result.filter(a => a.type === args.type);
      }
      
      if (args?.tags?.length) {
        result = result.filter(a => args.tags!.some(t => a.tags.includes(t)));
      }
      
      if (args?.search) {
        const search = args.search.toLowerCase();
        result = result.filter(a =>
          a.name.toLowerCase().includes(search) ||
          a.description?.toLowerCase().includes(search)
        );
      }
      
      result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      
      return { success: true, agents: result };
    } catch (error) {
      logger.error("List agents failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:update-agent", async (_event, args: {
    agentId: string;
    updates: Partial<Omit<Agent, "id" | "createdAt" | "stats">>;
    bumpVersion?: boolean;
  }) => {
    try {
      const agent = agents.get(args.agentId);
      if (!agent) throw new Error("Agent not found");
      
      // Apply updates
      if (args.updates.name) agent.name = args.updates.name;
      if (args.updates.description !== undefined) agent.description = args.updates.description;
      if (args.updates.type) agent.type = args.updates.type;
      if (args.updates.status) agent.status = args.updates.status;
      if (args.updates.config) agent.config = { ...agent.config, ...args.updates.config };
      if (args.updates.tools) agent.tools = args.updates.tools;
      if (args.updates.memory) agent.memory = { ...agent.memory, ...args.updates.memory };
      if (args.updates.prompts) agent.prompts = { ...agent.prompts, ...args.updates.prompts };
      if (args.updates.constraints) agent.constraints = { ...agent.constraints, ...args.updates.constraints };
      if (args.updates.tags) agent.tags = args.updates.tags;
      if (args.updates.metadata) agent.metadata = { ...agent.metadata, ...args.updates.metadata };
      
      if (args.bumpVersion) {
        const [major, minor, patch] = agent.version.split(".").map(Number);
        agent.version = `${major}.${minor}.${patch + 1}`;
      }
      
      agent.updatedAt = new Date();
      
      await saveAgents();
      
      return { success: true, agent };
    } catch (error) {
      logger.error("Update agent failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:delete-agent", async (_event, agentId: string) => {
    try {
      if (!agents.has(agentId)) throw new Error("Agent not found");
      
      agents.delete(agentId);
      await saveAgents();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete agent failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:activate-agent", async (_event, agentId: string) => {
    try {
      const agent = agents.get(agentId);
      if (!agent) throw new Error("Agent not found");
      
      // Validate agent configuration
      if (!agent.prompts.system) throw new Error("Agent must have a system prompt");
      
      agent.status = "active";
      agent.updatedAt = new Date();
      
      await saveAgents();
      
      return { success: true, agent };
    } catch (error) {
      logger.error("Activate agent failed:", error);
      throw error;
    }
  });

  // ========== Tool Management ==========

  ipcMain.handle("agent-builder:add-tool", async (_event, args: {
    agentId: string;
    tool: Omit<AgentTool, "id">;
  }) => {
    try {
      const agent = agents.get(args.agentId);
      if (!agent) throw new Error("Agent not found");
      
      const tool: AgentTool = {
        ...args.tool,
        id: uuidv4(),
      };
      
      agent.tools.push(tool);
      agent.updatedAt = new Date();
      
      await saveAgents();
      
      return { success: true, tool };
    } catch (error) {
      logger.error("Add tool failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:update-tool", async (_event, args: {
    agentId: string;
    toolId: string;
    updates: Partial<Omit<AgentTool, "id">>;
  }) => {
    try {
      const agent = agents.get(args.agentId);
      if (!agent) throw new Error("Agent not found");
      
      const tool = agent.tools.find(t => t.id === args.toolId);
      if (!tool) throw new Error("Tool not found");
      
      Object.assign(tool, args.updates);
      agent.updatedAt = new Date();
      
      await saveAgents();
      
      return { success: true, tool };
    } catch (error) {
      logger.error("Update tool failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:remove-tool", async (_event, args: {
    agentId: string;
    toolId: string;
  }) => {
    try {
      const agent = agents.get(args.agentId);
      if (!agent) throw new Error("Agent not found");
      
      agent.tools = agent.tools.filter(t => t.id !== args.toolId);
      agent.updatedAt = new Date();
      
      await saveAgents();
      
      return { success: true };
    } catch (error) {
      logger.error("Remove tool failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:list-builtin-tools", async () => {
    try {
      const builtinTools = [
        { id: "sql-query", name: "SQL Query", description: "Execute SQL queries on datasets", category: "data" },
        { id: "data-viz", name: "Data Visualization", description: "Create charts and visualizations", category: "data" },
        { id: "stats", name: "Statistical Analysis", description: "Perform statistical calculations", category: "data" },
        { id: "code-exec", name: "Code Execution", description: "Execute code snippets", category: "development" },
        { id: "file-read", name: "File Read", description: "Read file contents", category: "filesystem" },
        { id: "file-write", name: "File Write", description: "Write to files", category: "filesystem" },
        { id: "search", name: "Code Search", description: "Search codebase", category: "development" },
        { id: "web-search", name: "Web Search", description: "Search the internet", category: "research" },
        { id: "scrape", name: "Web Scraper", description: "Extract content from web pages", category: "research" },
        { id: "summarize", name: "Summarizer", description: "Summarize long text", category: "nlp" },
        { id: "http", name: "HTTP Client", description: "Make HTTP requests", category: "integration" },
        { id: "scheduler", name: "Scheduler", description: "Schedule tasks", category: "automation" },
        { id: "n8n", name: "N8n Integration", description: "Trigger n8n workflows", category: "integration" },
        { id: "delegate", name: "Delegate Task", description: "Delegate to another agent", category: "multi-agent" },
        { id: "monitor", name: "Monitor Progress", description: "Monitor agent execution", category: "multi-agent" },
        { id: "aggregate", name: "Aggregate Results", description: "Combine multiple results", category: "multi-agent" },
      ];
      
      return { success: true, tools: builtinTools };
    } catch (error) {
      logger.error("List builtin tools failed:", error);
      throw error;
    }
  });

  // ========== Execution ==========

  ipcMain.handle("agent-builder:execute-agent", async (_event, args: {
    agentId: string;
    input: any;
    sessionId?: string;
    variables?: Record<string, any>;
    async?: boolean;
  }) => {
    try {
      const agent = agents.get(args.agentId);
      if (!agent) throw new Error("Agent not found");
      if (agent.status !== "active") throw new Error("Agent is not active");
      
      const execution = await executeAgentInternal(agent, args.input, {
        sessionId: args.sessionId,
        variables: args.variables,
      });
      
      return {
        success: execution.status === "completed",
        executionId: execution.id,
        status: execution.status,
        output: execution.output,
        metrics: execution.metrics,
        error: execution.error,
      };
    } catch (error) {
      logger.error("Execute agent failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:get-execution", async (_event, executionId: string) => {
    try {
      let execution = executions.get(executionId);
      
      if (!execution) {
        const execPath = path.join(getAgentStorageDir(), "executions", `${executionId}.json`);
        if (await fs.pathExists(execPath)) {
          execution = await fs.readJson(execPath);
        }
      }
      
      if (!execution) throw new Error("Execution not found");
      
      return { success: true, execution };
    } catch (error) {
      logger.error("Get execution failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:list-executions", async (_event, args?: {
    agentId?: string;
    status?: string;
    limit?: number;
  }) => {
    try {
      let result = Array.from(executions.values());
      
      if (args?.agentId) {
        result = result.filter(e => e.agentId === args.agentId);
      }
      
      if (args?.status) {
        result = result.filter(e => e.status === args.status);
      }
      
      result.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      
      if (args?.limit) {
        result = result.slice(0, args.limit);
      }
      
      return { success: true, executions: result };
    } catch (error) {
      logger.error("List executions failed:", error);
      throw error;
    }
  });

  // ========== Sessions ==========

  ipcMain.handle("agent-builder:create-session", async (_event, agentId: string) => {
    try {
      const agent = agents.get(agentId);
      if (!agent) throw new Error("Agent not found");
      
      const sessionId = uuidv4();
      sessions.set(sessionId, {
        agentId,
        memory: [],
        createdAt: new Date(),
      });
      
      return { success: true, sessionId };
    } catch (error) {
      logger.error("Create session failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:get-session", async (_event, sessionId: string) => {
    try {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("Session not found");
      
      return { success: true, session };
    } catch (error) {
      logger.error("Get session failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:clear-session", async (_event, sessionId: string) => {
    try {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("Session not found");
      
      session.memory = [];
      
      return { success: true };
    } catch (error) {
      logger.error("Clear session failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:end-session", async (_event, sessionId: string) => {
    try {
      sessions.delete(sessionId);
      return { success: true };
    } catch (error) {
      logger.error("End session failed:", error);
      throw error;
    }
  });

  // ========== Teams ==========

  ipcMain.handle("agent-builder:create-team", async (_event, args: {
    name: string;
    description?: string;
    agents: TeamMember[];
    coordinator?: string;
    communicationPattern?: string;
    taskDistribution?: string;
    sharedMemory?: boolean;
  }) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      // Validate agents exist
      for (const member of args.agents) {
        if (!agents.has(member.agentId)) {
          throw new Error(`Agent not found: ${member.agentId}`);
        }
      }
      
      const team: AgentTeam = {
        id,
        name: args.name,
        description: args.description,
        agents: args.agents,
        coordinator: args.coordinator,
        communicationPattern: (args.communicationPattern || "hub_spoke") as any,
        taskDistribution: (args.taskDistribution || "capability_based") as any,
        sharedMemory: args.sharedMemory ?? true,
        createdAt: now,
        updatedAt: now,
      };
      
      teams.set(id, team);
      await saveTeams();
      
      return { success: true, team };
    } catch (error) {
      logger.error("Create team failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:list-teams", async () => {
    try {
      const result = Array.from(teams.values());
      result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      
      return { success: true, teams: result };
    } catch (error) {
      logger.error("List teams failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:execute-team", async (_event, args: {
    teamId: string;
    task: any;
    variables?: Record<string, any>;
  }) => {
    try {
      const team = teams.get(args.teamId);
      if (!team) throw new Error("Team not found");
      
      // Get coordinator or first agent
      const coordinatorId = team.coordinator || team.agents[0]?.agentId;
      const coordinator = agents.get(coordinatorId);
      if (!coordinator) throw new Error("Coordinator agent not found");
      
      // Execute coordinator with team context
      const execution = await executeAgentInternal(coordinator, {
        task: args.task,
        team: {
          id: team.id,
          agents: team.agents.map(m => ({
            agentId: m.agentId,
            role: m.role,
            capabilities: m.capabilities,
          })),
        },
      }, {
        variables: {
          ...args.variables,
          teamId: team.id,
          isTeamExecution: true,
        },
      });
      
      return {
        success: execution.status === "completed",
        executionId: execution.id,
        status: execution.status,
        output: execution.output,
        error: execution.error,
      };
    } catch (error) {
      logger.error("Execute team failed:", error);
      throw error;
    }
  });

  // ========== Templates ==========

  ipcMain.handle("agent-builder:list-templates", async (_event, category?: string) => {
    try {
      let result = Array.from(templates.values());
      
      if (category) {
        result = result.filter(t => t.category === category);
      }
      
      return { success: true, templates: result };
    } catch (error) {
      logger.error("List templates failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:get-template", async (_event, templateId: string) => {
    try {
      const template = templates.get(templateId);
      if (!template) throw new Error("Template not found");
      
      return { success: true, template };
    } catch (error) {
      logger.error("Get template failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:save-as-template", async (_event, args: {
    agentId: string;
    name: string;
    description?: string;
    category: string;
  }) => {
    try {
      const agent = agents.get(args.agentId);
      if (!agent) throw new Error("Agent not found");
      
      const templateId = uuidv4();
      const template: AgentTemplate = {
        id: templateId,
        name: args.name,
        description: args.description,
        category: args.category,
        agent: {
          name: agent.name,
          description: agent.description,
          version: "1.0.0",
          status: "active",
          type: agent.type,
          config: { ...agent.config },
          tools: [...agent.tools],
          memory: { ...agent.memory },
          prompts: { ...agent.prompts },
          constraints: { ...agent.constraints },
          metadata: {},
          tags: [...agent.tags],
        },
      };
      
      templates.set(templateId, template);
      
      return { success: true, template };
    } catch (error) {
      logger.error("Save as template failed:", error);
      throw error;
    }
  });

  // ========== Stats & Metrics ==========

  ipcMain.handle("agent-builder:get-agent-stats", async (_event, agentId: string) => {
    try {
      const agent = agents.get(agentId);
      if (!agent) throw new Error("Agent not found");
      
      return { success: true, stats: agent.stats };
    } catch (error) {
      logger.error("Get agent stats failed:", error);
      throw error;
    }
  });

  ipcMain.handle("agent-builder:get-global-stats", async () => {
    try {
      const allAgents = Array.from(agents.values());
      
      const stats = {
        totalAgents: allAgents.length,
        activeAgents: allAgents.filter(a => a.status === "active").length,
        totalExecutions: allAgents.reduce((sum, a) => sum + a.stats.totalExecutions, 0),
        successRate: 0,
        averageResponseTime: 0,
        totalTeams: teams.size,
        activeSessions: sessions.size,
        agentsByType: {} as Record<string, number>,
        mostUsedTools: [] as Array<{ tool: string; count: number }>,
      };
      
      // Calculate success rate
      const totalSuccess = allAgents.reduce((sum, a) => sum + a.stats.successfulExecutions, 0);
      if (stats.totalExecutions > 0) {
        stats.successRate = totalSuccess / stats.totalExecutions;
      }
      
      // Calculate average response time
      const agentsWithExecutions = allAgents.filter(a => a.stats.totalExecutions > 0);
      if (agentsWithExecutions.length > 0) {
        stats.averageResponseTime = 
          agentsWithExecutions.reduce((sum, a) => sum + a.stats.averageResponseTime, 0) / 
          agentsWithExecutions.length;
      }
      
      // Count by type
      for (const agent of allAgents) {
        stats.agentsByType[agent.type] = (stats.agentsByType[agent.type] || 0) + 1;
      }
      
      // Aggregate tool usage
      const toolUsage: Record<string, number> = {};
      for (const agent of allAgents) {
        for (const [tool, count] of Object.entries(agent.stats.toolUsage)) {
          toolUsage[tool] = (toolUsage[tool] || 0) + count;
        }
      }
      
      stats.mostUsedTools = Object.entries(toolUsage)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tool, count]) => ({ tool, count }));
      
      return { success: true, stats };
    } catch (error) {
      logger.error("Get global stats failed:", error);
      throw error;
    }
  });

  logger.info("Agent Builder System handlers registered");
}
