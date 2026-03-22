/**
 * Studio AI Service
 * 
 * Unified AI service for all JoyCreate studios that integrates:
 * - Claude Code for agentic coding tasks
 * - Ollama for local AI processing (privacy-first)
 * - Anthropic for cloud fallback
 * 
 * Supported studios:
 * - Data Studio: Dataset generation, augmentation, quality analysis
 * - Document Studio: Document generation, content creation
 * - Asset Studio: Asset generation, code creation, schema design
 * - Agent Swarms: Agent inference, task execution, coordination
 * - Dataset Studio: Item generation, labeling, classification
 */

import { EventEmitter } from "events";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { getOpenClawGateway } from "@/lib/openclaw_gateway_service";
import { getOpenClawSystemIntegration } from "@/lib/openclaw_system_integration";
import type {
  OpenClawChatRequest,
  OpenClawChatResponse,
  ClaudeCodeTask,
  ClaudeCodeResult,
  OpenClawCapability,
} from "@/types/openclaw_types";

const logger = log.scope("studio_ai_service");

// =============================================================================
// TYPES
// =============================================================================

export type StudioType = 
  | "data-studio"
  | "document-studio"
  | "asset-studio"
  | "dataset-studio"
  | "agent-swarm";

export type AIProvider = "ollama" | "anthropic" | "claude-code" | "auto";

export interface StudioAIConfig {
  /** Preferred provider - 'auto' uses Ollama first, then Anthropic */
  preferredProvider: AIProvider;
  
  /** Use Claude Code for complex agentic tasks */
  useClaudeCode: boolean;
  
  /** Ollama model for local processing */
  ollamaModel: string;
  
  /** Anthropic model for cloud fallback */
  anthropicModel: string;
  
  /** Maximum tokens for generation */
  maxTokens: number;
  
  /** Temperature for generation */
  temperature: number;
  
  /** Enable streaming responses */
  stream: boolean;
  
  /** Privacy mode - only use local models */
  privacyMode: boolean;
}

export interface StudioAIRequest {
  id: string;
  studio: StudioType;
  operation: string;
  prompt: string;
  systemPrompt?: string;
  context?: Record<string, unknown>;
  config?: Partial<StudioAIConfig>;
  timestamp: number;
}

export interface StudioAIResponse {
  id: string;
  requestId: string;
  success: boolean;
  content?: string;
  structuredOutput?: unknown;
  provider: string;
  model: string;
  localProcessed: boolean;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  latencyMs: number;
  error?: string;
}

export interface ClaudeCodeStudioTask {
  id: string;
  studio: StudioType;
  operation: ClaudeCodeOperation;
  description: string;
  context?: Record<string, unknown>;
  files?: string[];
  codeContext?: string;
}

export type ClaudeCodeOperation =
  | "generate-code"
  | "analyze-code"
  | "refactor-code"
  | "generate-tests"
  | "generate-schema"
  | "generate-documentation"
  | "generate-dataset"
  | "augment-data"
  | "analyze-data"
  | "create-agent"
  | "optimize-agent"
  | "coordinate-swarm";

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

export const DEFAULT_STUDIO_AI_CONFIG: StudioAIConfig = {
  preferredProvider: "auto",
  useClaudeCode: true,
  ollamaModel: "llama3.1:8b",
  anthropicModel: "claude-3-5-sonnet-20241022",
  maxTokens: 4096,
  temperature: 0.7,
  stream: false,
  privacyMode: false,
};

// =============================================================================
// STUDIO AI SERVICE
// =============================================================================

export class StudioAIService extends EventEmitter {
  private static instance: StudioAIService;
  private config: StudioAIConfig = DEFAULT_STUDIO_AI_CONFIG;
  private initialized = false;
  
  private stats = {
    totalRequests: 0,
    ollamaRequests: 0,
    anthropicRequests: 0,
    claudeCodeTasks: 0,
    errors: 0,
    totalTokens: 0,
  };
  
  private constructor() {
    super();
  }
  
  static getInstance(): StudioAIService {
    if (!StudioAIService.instance) {
      StudioAIService.instance = new StudioAIService();
    }
    return StudioAIService.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(config?: Partial<StudioAIConfig>): Promise<void> {
    if (this.initialized) return;
    
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    // Initialize OpenClaw system integration
    const systemIntegration = getOpenClawSystemIntegration();
    await systemIntegration.initialize();
    
    this.initialized = true;
    this.emit("initialized");
    logger.info("Studio AI Service initialized", {
      preferredProvider: this.config.preferredProvider,
      useClaudeCode: this.config.useClaudeCode,
      ollamaModel: this.config.ollamaModel,
    });
  }
  
  // ===========================================================================
  // UNIFIED AI INTERFACE
  // ===========================================================================
  
  /**
   * Execute an AI request for any studio
   */
  async execute(request: StudioAIRequest): Promise<StudioAIResponse> {
    const startTime = Date.now();
    const config = { ...this.config, ...request.config };
    
    this.stats.totalRequests++;
    
    try {
      // Determine which provider to use
      const provider = await this.selectProvider(request, config);
      
      logger.info("Executing studio AI request", {
        studio: request.studio,
        operation: request.operation,
        provider,
      });
      
      let response: StudioAIResponse;
      
      if (provider === "claude-code" && config.useClaudeCode) {
        response = await this.executeWithClaudeCode(request, config);
        this.stats.claudeCodeTasks++;
      } else if (provider === "ollama") {
        response = await this.executeWithOllama(request, config);
        this.stats.ollamaRequests++;
      } else {
        response = await this.executeWithAnthropic(request, config);
        this.stats.anthropicRequests++;
      }
      
      this.stats.totalTokens += response.tokens.total;
      this.emit("request:completed", response);
      
      return response;
      
    } catch (error) {
      this.stats.errors++;
      
      const errorResponse: StudioAIResponse = {
        id: uuidv4(),
        requestId: request.id,
        success: false,
        provider: "unknown",
        model: "unknown",
        localProcessed: false,
        tokens: { prompt: 0, completion: 0, total: 0 },
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      
      this.emit("request:failed", errorResponse);
      throw error;
    }
  }
  
  /**
   * Select the best provider for the request
   */
  private async selectProvider(
    request: StudioAIRequest,
    config: StudioAIConfig
  ): Promise<AIProvider> {
    // Privacy mode forces local only
    if (config.privacyMode) {
      return "ollama";
    }
    
    // If Claude Code is enabled and operation is complex/agentic
    if (config.useClaudeCode && this.isAgenticOperation(request.operation)) {
      return "claude-code";
    }
    
    // Auto mode: try Ollama first
    if (config.preferredProvider === "auto") {
      const ollamaAvailable = await this.checkOllamaAvailability();
      if (ollamaAvailable) {
        return "ollama";
      }
      return "anthropic";
    }
    
    return config.preferredProvider;
  }
  
  /**
   * Check if operation should use Claude Code
   */
  private isAgenticOperation(operation: string): boolean {
    const agenticOps = [
      "generate-code",
      "refactor-code",
      "generate-tests",
      "analyze-codebase",
      "create-agent",
      "optimize-agent",
      "coordinate-swarm",
      "generate-schema",
    ];
    return agenticOps.includes(operation);
  }
  
  /**
   * Check if Ollama is available
   */
  private async checkOllamaAvailability(): Promise<boolean> {
    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  
  // ===========================================================================
  // PROVIDER IMPLEMENTATIONS
  // ===========================================================================
  
  /**
   * Execute with Ollama (local)
   */
  private async executeWithOllama(
    request: StudioAIRequest,
    config: StudioAIConfig
  ): Promise<StudioAIResponse> {
    const startTime = Date.now();
    
    const messages: Array<{ role: string; content: string }> = [];
    
    // Add system prompt based on studio
    const systemPrompt = request.systemPrompt || this.getStudioSystemPrompt(request.studio, request.operation);
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    
    // Add context if provided
    if (request.context) {
      const contextStr = JSON.stringify(request.context, null, 2);
      messages.push({
        role: "user",
        content: `Context:\n${contextStr}\n\n`,
      });
    }
    
    messages.push({ role: "user", content: request.prompt });
    
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages,
        stream: false,
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens,
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: true,
      content: data.message?.content || "",
      provider: "ollama",
      model: config.ollamaModel,
      localProcessed: true,
      tokens: {
        prompt: data.prompt_eval_count || 0,
        completion: data.eval_count || 0,
        total: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      latencyMs: Date.now() - startTime,
    };
  }
  
  /**
   * Execute with Anthropic (cloud)
   */
  private async executeWithAnthropic(
    request: StudioAIRequest,
    config: StudioAIConfig
  ): Promise<StudioAIResponse> {
    const startTime = Date.now();
    
    // Use OpenClaw gateway which handles Anthropic
    const gateway = getOpenClawGateway();
    
    const systemPrompt = request.systemPrompt || this.getStudioSystemPrompt(request.studio, request.operation);
    
    const chatRequest: OpenClawChatRequest = {
      messages: [
        ...(request.context ? [{
          role: "user" as const,
          content: `Context:\n${JSON.stringify(request.context, null, 2)}\n\n`,
        }] : []),
        { role: "user" as const, content: request.prompt },
      ],
      systemPrompt,
      provider: "anthropic",
      model: config.anthropicModel,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      preferLocal: false,
    };
    
    const result = await gateway.chat(chatRequest);
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: true,
      content: result.message.content,
      provider: "anthropic",
      model: result.model,
      localProcessed: false,
      tokens: {
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
        total: result.usage.totalTokens,
      },
      latencyMs: Date.now() - startTime,
    };
  }
  
  /**
   * Execute with Claude Code (agentic tasks)
   */
  private async executeWithClaudeCode(
    request: StudioAIRequest,
    config: StudioAIConfig
  ): Promise<StudioAIResponse> {
    const startTime = Date.now();
    
    const gateway = getOpenClawGateway();
    
    // Map studio operation to Claude Code task
    const task: ClaudeCodeTask = {
      id: uuidv4(),
      type: this.mapOperationToClaudeCodeType(request.operation),
      description: request.prompt,
      targetPath: request.context?.targetPath as string,
      content: request.context?.content as string,
      searchQuery: request.context?.searchQuery as string,
      command: request.context?.command as string,
    };
    
    const result = await gateway.executeClaudeCodeTask(task);
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: result.success,
      content: result.output,
      structuredOutput: result.changes,
      provider: "claude-code",
      model: config.anthropicModel,
      localProcessed: false,
      tokens: { prompt: 0, completion: 0, total: 0 },
      latencyMs: Date.now() - startTime,
      error: result.error,
    };
  }
  
  private mapOperationToClaudeCodeType(operation: string): ClaudeCodeTask["type"] {
    const mapping: Record<string, ClaudeCodeTask["type"]> = {
      "generate-code": "write_file",
      "analyze-code": "analyze_code",
      "refactor-code": "refactor",
      "generate-tests": "test_generation",
      "generate-schema": "write_file",
      "create-agent": "write_file",
    };
    return mapping[operation] || "composite";
  }
  
  // ===========================================================================
  // STUDIO-SPECIFIC METHODS
  // ===========================================================================
  
  /**
   * Data Studio: Generate synthetic data
   */
  async generateDatasetItems(params: {
    schema: Record<string, unknown>;
    count: number;
    examples?: unknown[];
    constraints?: string[];
    config?: Partial<StudioAIConfig>;
  }): Promise<{ items: unknown[]; provider: string; localProcessed: boolean }> {
    const prompt = `Generate ${params.count} synthetic data items following this schema:
${JSON.stringify(params.schema, null, 2)}

${params.examples ? `Examples:\n${JSON.stringify(params.examples, null, 2)}` : ""}
${params.constraints ? `Constraints:\n${params.constraints.join("\n")}` : ""}

Return ONLY a valid JSON array of items. No explanation or markdown.`;
    
    const response = await this.execute({
      id: uuidv4(),
      studio: "data-studio",
      operation: "generate-dataset",
      prompt,
      config: params.config,
      timestamp: Date.now(),
    });
    
    let items: unknown[] = [];
    try {
      items = JSON.parse(response.content || "[]");
    } catch {
      logger.warn("Failed to parse generated items, attempting extraction");
      const match = response.content?.match(/\[[\s\S]*\]/);
      if (match) {
        items = JSON.parse(match[0]);
      }
    }
    
    return {
      items,
      provider: response.provider,
      localProcessed: response.localProcessed,
    };
  }
  
  /**
   * Data Studio: Augment existing data
   */
  async augmentData(params: {
    item: unknown;
    augmentationType: "paraphrase" | "expand" | "summarize" | "translate" | "noise";
    config?: Partial<StudioAIConfig>;
  }): Promise<{ augmented: unknown; provider: string; localProcessed: boolean }> {
    const prompts: Record<string, string> = {
      paraphrase: "Paraphrase the following while preserving meaning:",
      expand: "Expand the following with more detail:",
      summarize: "Summarize the following concisely:",
      translate: "Translate the following to a different style:",
      noise: "Add slight variations to the following:",
    };
    
    const prompt = `${prompts[params.augmentationType]}

${JSON.stringify(params.item, null, 2)}

Return ONLY the augmented version in the same format. No explanation.`;
    
    const response = await this.execute({
      id: uuidv4(),
      studio: "data-studio",
      operation: "augment-data",
      prompt,
      config: params.config,
      timestamp: Date.now(),
    });
    
    let augmented: unknown;
    try {
      augmented = JSON.parse(response.content || "{}");
    } catch {
      augmented = response.content;
    }
    
    return {
      augmented,
      provider: response.provider,
      localProcessed: response.localProcessed,
    };
  }
  
  /**
   * Document Studio: Generate document content
   */
  async generateDocument(params: {
    type: "report" | "article" | "email" | "presentation" | "memo" | "proposal";
    description: string;
    tone?: string;
    length?: "short" | "medium" | "long";
    format?: "markdown" | "plain" | "html";
    config?: Partial<StudioAIConfig>;
  }): Promise<{ content: string; sections?: unknown[]; provider: string; localProcessed: boolean }> {
    const prompt = `Create a ${params.type} with the following requirements:

Description: ${params.description}
Tone: ${params.tone || "professional"}
Length: ${params.length || "medium"}
Format: ${params.format || "markdown"}

Generate comprehensive, well-structured content.`;
    
    const response = await this.execute({
      id: uuidv4(),
      studio: "document-studio",
      operation: "generate-documentation",
      prompt,
      config: params.config,
      timestamp: Date.now(),
    });
    
    return {
      content: response.content || "",
      provider: response.provider,
      localProcessed: response.localProcessed,
    };
  }
  
  /**
   * Asset Studio: Generate code/algorithm
   */
  async generateCode(params: {
    language: string;
    description: string;
    framework?: string;
    includeTests?: boolean;
    config?: Partial<StudioAIConfig>;
  }): Promise<{ code: string; tests?: string; provider: string; localProcessed: boolean }> {
    const prompt = `Generate ${params.language} code:

Description: ${params.description}
${params.framework ? `Framework: ${params.framework}` : ""}
${params.includeTests ? "Include unit tests." : ""}

Return clean, production-ready code with comments.`;
    
    // Prefer Claude Code for complex code generation
    const config = {
      ...params.config,
      useClaudeCode: true,
    };
    
    const response = await this.execute({
      id: uuidv4(),
      studio: "asset-studio",
      operation: "generate-code",
      prompt,
      config,
      timestamp: Date.now(),
    });
    
    return {
      code: response.content || "",
      provider: response.provider,
      localProcessed: response.localProcessed,
    };
  }
  
  /**
   * Asset Studio: Generate schema
   */
  async generateSchema(params: {
    schemaType: "json-schema" | "openapi" | "graphql" | "sql" | "drizzle";
    description: string;
    entities?: string[];
    config?: Partial<StudioAIConfig>;
  }): Promise<{ schema: string; provider: string; localProcessed: boolean }> {
    const prompt = `Generate a ${params.schemaType} schema:

Description: ${params.description}
${params.entities ? `Entities to include: ${params.entities.join(", ")}` : ""}

Return ONLY the schema definition, no explanation.`;
    
    const response = await this.execute({
      id: uuidv4(),
      studio: "asset-studio",
      operation: "generate-schema",
      prompt,
      config: params.config,
      timestamp: Date.now(),
    });
    
    return {
      schema: response.content || "",
      provider: response.provider,
      localProcessed: response.localProcessed,
    };
  }
  
  /**
   * Agent Swarm: Generate agent configuration
   */
  async generateAgentConfig(params: {
    role: string;
    capabilities: string[];
    objectives: string[];
    constraints?: string[];
    config?: Partial<StudioAIConfig>;
  }): Promise<{
    systemPrompt: string;
    tools: string[];
    settings: Record<string, unknown>;
    provider: string;
    localProcessed: boolean;
  }> {
    const prompt = `Create an AI agent configuration:

Role: ${params.role}
Capabilities: ${params.capabilities.join(", ")}
Objectives: ${params.objectives.join(", ")}
${params.constraints ? `Constraints: ${params.constraints.join(", ")}` : ""}

Return a JSON object with:
- systemPrompt: A detailed system prompt for the agent
- tools: Array of tool names the agent should have access to
- settings: Object with temperature, maxTokens, etc.`;
    
    const response = await this.execute({
      id: uuidv4(),
      studio: "agent-swarm",
      operation: "create-agent",
      prompt,
      config: params.config,
      timestamp: Date.now(),
    });
    
    let parsed: any;
    try {
      parsed = JSON.parse(response.content || "{}");
    } catch {
      parsed = {
        systemPrompt: response.content,
        tools: [],
        settings: {},
      };
    }
    
    return {
      ...parsed,
      provider: response.provider,
      localProcessed: response.localProcessed,
    };
  }
  
  /**
   * Agent Swarm: Execute agent task with AI
   */
  async executeAgentTask(params: {
    agentId: string;
    task: string;
    context?: Record<string, unknown>;
    systemPrompt?: string;
    config?: Partial<StudioAIConfig>;
  }): Promise<{ result: string; provider: string; localProcessed: boolean }> {
    const response = await this.execute({
      id: uuidv4(),
      studio: "agent-swarm",
      operation: "agent-task",
      prompt: params.task,
      systemPrompt: params.systemPrompt,
      context: params.context,
      config: params.config,
      timestamp: Date.now(),
    });
    
    return {
      result: response.content || "",
      provider: response.provider,
      localProcessed: response.localProcessed,
    };
  }
  
  /**
   * Agent Swarm: Coordinate multiple agents
   */
  async coordinateSwarm(params: {
    agents: Array<{ id: string; role: string; capabilities: string[] }>;
    objective: string;
    strategy?: "parallel" | "sequential" | "hierarchical";
    config?: Partial<StudioAIConfig>;
  }): Promise<{
    plan: Array<{ agentId: string; task: string; dependencies: string[] }>;
    provider: string;
    localProcessed: boolean;
  }> {
    const prompt = `Create a task coordination plan for a swarm of agents:

Agents:
${params.agents.map(a => `- ${a.id} (${a.role}): ${a.capabilities.join(", ")}`).join("\n")}

Objective: ${params.objective}
Strategy: ${params.strategy || "parallel"}

Return a JSON array of task assignments with:
- agentId: The agent to assign the task to
- task: Description of the task
- dependencies: Array of other task IDs this depends on`;
    
    // Use Claude Code for complex coordination
    const config = {
      ...params.config,
      useClaudeCode: true,
    };
    
    const response = await this.execute({
      id: uuidv4(),
      studio: "agent-swarm",
      operation: "coordinate-swarm",
      prompt,
      config,
      timestamp: Date.now(),
    });
    
    let plan: any[];
    try {
      plan = JSON.parse(response.content || "[]");
    } catch {
      plan = [];
    }
    
    return {
      plan,
      provider: response.provider,
      localProcessed: response.localProcessed,
    };
  }
  
  // ===========================================================================
  // SYSTEM PROMPTS
  // ===========================================================================
  
  private getStudioSystemPrompt(studio: StudioType, operation: string): string {
    const prompts: Record<StudioType, string> = {
      "data-studio": `You are a data generation and augmentation specialist for Create Data Studio.
Your tasks include:
- Generating synthetic training data
- Augmenting existing datasets
- Creating variations and paraphrases
- Ensuring data quality and consistency
Always output structured data in JSON format when requested.
Follow schemas precisely and maintain data integrity.`,

      "document-studio": `You are a professional document creation assistant for Create Document Studio.
Your tasks include:
- Creating reports, articles, and business documents
- Generating presentation content
- Writing clear, professional content
- Structuring information effectively
Adapt tone and style to the document type.
Use clear headings and organization.`,

      "asset-studio": `You are a code and asset generation specialist for Create Asset Studio.
Your tasks include:
- Generating clean, production-ready code
- Creating schemas and data structures
- Building algorithms and utilities
- Following best practices and patterns
Write well-documented, type-safe code.
Include error handling and edge cases.`,

      "dataset-studio": `You are a dataset creation specialist for Create Dataset Studio.
Your tasks include:
- Generating labeled training data
- Creating question-answer pairs
- Building conversation datasets
- Ensuring data diversity and quality
Follow specified formats (JSONL, CSV, etc.).
Maintain consistency in labeling.`,

      "agent-swarm": `You are an AI agent coordination specialist for Create Agent Swarm.
Your tasks include:
- Creating agent configurations and system prompts
- Planning task distribution across agents
- Optimizing agent collaboration
- Coordinating multi-agent workflows
Design agents with clear roles and capabilities.
Ensure efficient task delegation.`,
    };
    
    return prompts[studio] || "You are a helpful AI assistant for Create.";
  }
  
  // ===========================================================================
  // STATS & CONFIG
  // ===========================================================================
  
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
  
  getConfig(): StudioAIConfig {
    return { ...this.config };
  }
  
  updateConfig(updates: Partial<StudioAIConfig>): void {
    this.config = { ...this.config, ...updates };
    this.emit("config:updated", this.config);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

let serviceInstance: StudioAIService | null = null;

export function getStudioAIService(): StudioAIService {
  if (!serviceInstance) {
    serviceInstance = StudioAIService.getInstance();
  }
  return serviceInstance;
}

export async function initializeStudioAI(config?: Partial<StudioAIConfig>): Promise<void> {
  const service = getStudioAIService();
  await service.initialize(config);
}
