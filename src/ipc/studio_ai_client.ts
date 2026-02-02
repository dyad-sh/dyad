/**
 * Studio AI IPC Client
 * Renderer-side client for the unified Studio AI Service
 * 
 * Provides Claude Code + Ollama integration for all studios
 */

import type { IpcRenderer } from "electron";

// Types imported from the service
export type StudioType = 
  | "data-studio"
  | "document-studio"
  | "asset-studio"
  | "dataset-studio"
  | "agent-swarm";

export type AIProvider = "ollama" | "anthropic" | "claude-code" | "auto";

export interface StudioAIConfig {
  preferredProvider: AIProvider;
  useClaudeCode: boolean;
  ollamaModel: string;
  anthropicModel: string;
  maxTokens: number;
  temperature: number;
  stream: boolean;
  privacyMode: boolean;
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

export interface StudioAIStats {
  totalRequests: number;
  ollamaRequests: number;
  anthropicRequests: number;
  claudeCodeTasks: number;
  errors: number;
  totalTokens: number;
}

class StudioAIClient {
  private static instance: StudioAIClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    // @ts-ignore - window.electron is injected by preload
    this.ipcRenderer = window.electron?.ipcRenderer;
  }

  static getInstance(): StudioAIClient {
    if (!StudioAIClient.instance) {
      StudioAIClient.instance = new StudioAIClient();
    }
    return StudioAIClient.instance;
  }

  // ===========================================================================
  // INITIALIZATION & CONFIG
  // ===========================================================================

  async initialize(config?: Partial<StudioAIConfig>): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("studio-ai:initialize", config);
  }

  async getConfig(): Promise<StudioAIConfig> {
    return this.ipcRenderer.invoke("studio-ai:config:get");
  }

  async updateConfig(updates: Partial<StudioAIConfig>): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("studio-ai:config:update", updates);
  }

  async getStats(): Promise<StudioAIStats> {
    return this.ipcRenderer.invoke("studio-ai:stats");
  }

  // ===========================================================================
  // UNIFIED EXECUTE
  // ===========================================================================

  async execute(request: {
    studio: StudioType;
    operation: string;
    prompt: string;
    systemPrompt?: string;
    context?: Record<string, unknown>;
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:execute", request);
  }

  // ===========================================================================
  // DATA STUDIO
  // ===========================================================================

  async generateDataItems(params: {
    schema: Record<string, unknown>;
    count: number;
    examples?: unknown[];
    constraints?: string[];
    config?: Partial<StudioAIConfig>;
  }): Promise<{ items: unknown[]; provider: string; localProcessed: boolean }> {
    return this.ipcRenderer.invoke("studio-ai:data:generate-items", params);
  }

  async augmentData(params: {
    item: unknown;
    augmentationType: "paraphrase" | "expand" | "summarize" | "translate" | "noise";
    config?: Partial<StudioAIConfig>;
  }): Promise<{ augmented: unknown; provider: string; localProcessed: boolean }> {
    return this.ipcRenderer.invoke("studio-ai:data:augment", params);
  }

  async analyzeData(params: {
    data: unknown[];
    analysisType: "quality" | "distribution" | "anomalies" | "summary";
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:data:analyze", params);
  }

  // ===========================================================================
  // DOCUMENT STUDIO
  // ===========================================================================

  async generateDocument(params: {
    type: "report" | "article" | "email" | "presentation" | "memo" | "proposal";
    description: string;
    tone?: string;
    length?: "short" | "medium" | "long";
    format?: "markdown" | "plain" | "html";
    config?: Partial<StudioAIConfig>;
  }): Promise<{ content: string; sections?: unknown[]; provider: string; localProcessed: boolean }> {
    return this.ipcRenderer.invoke("studio-ai:document:generate", params);
  }

  async enhanceDocument(params: {
    content: string;
    enhancement: "grammar" | "style" | "clarity" | "expand" | "summarize";
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:document:enhance", params);
  }

  // ===========================================================================
  // ASSET STUDIO
  // ===========================================================================

  async generateCode(params: {
    language: string;
    description: string;
    framework?: string;
    includeTests?: boolean;
    config?: Partial<StudioAIConfig>;
  }): Promise<{ code: string; tests?: string; provider: string; localProcessed: boolean }> {
    return this.ipcRenderer.invoke("studio-ai:asset:generate-code", params);
  }

  async generateSchema(params: {
    schemaType: "json-schema" | "openapi" | "graphql" | "sql" | "drizzle";
    description: string;
    entities?: string[];
    config?: Partial<StudioAIConfig>;
  }): Promise<{ schema: string; provider: string; localProcessed: boolean }> {
    return this.ipcRenderer.invoke("studio-ai:asset:generate-schema", params);
  }

  async analyzeCode(params: {
    code: string;
    language: string;
    analysisType: "bugs" | "security" | "performance" | "style" | "all";
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:asset:analyze-code", params);
  }

  async refactorCode(params: {
    code: string;
    language: string;
    refactorType: "clean" | "optimize" | "modernize" | "typescript" | "functional";
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:asset:refactor-code", params);
  }

  async generateTests(params: {
    code: string;
    language: string;
    framework?: string;
    coverage?: "unit" | "integration" | "e2e" | "all";
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:asset:generate-tests", params);
  }

  // ===========================================================================
  // AGENT SWARM
  // ===========================================================================

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
    return this.ipcRenderer.invoke("studio-ai:swarm:generate-agent-config", params);
  }

  async executeAgentTask(params: {
    agentId: string;
    task: string;
    context?: Record<string, unknown>;
    systemPrompt?: string;
    config?: Partial<StudioAIConfig>;
  }): Promise<{ result: string; provider: string; localProcessed: boolean }> {
    return this.ipcRenderer.invoke("studio-ai:swarm:execute-task", params);
  }

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
    return this.ipcRenderer.invoke("studio-ai:swarm:coordinate", params);
  }

  async optimizeAgent(params: {
    agentId: string;
    currentConfig: Record<string, unknown>;
    performanceMetrics: {
      successRate: number;
      avgLatency: number;
      tokenUsage: number;
      taskCompletion: number;
    };
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:swarm:optimize-agent", params);
  }

  // ===========================================================================
  // DATASET STUDIO
  // ===========================================================================

  async generateQAPairs(params: {
    topic: string;
    count: number;
    difficulty?: "easy" | "medium" | "hard" | "mixed";
    format?: "simple" | "conversational" | "instructional";
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:dataset:generate-qa-pairs", params);
  }

  async generateConversations(params: {
    scenario: string;
    turns: number;
    participants?: string[];
    tone?: string;
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:dataset:generate-conversations", params);
  }

  async generateClassificationData(params: {
    categories: string[];
    count: number;
    domain?: string;
    includeEdgeCases?: boolean;
    config?: Partial<StudioAIConfig>;
  }): Promise<StudioAIResponse> {
    return this.ipcRenderer.invoke("studio-ai:dataset:generate-classification-data", params);
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Quick chat - simple AI interaction
   */
  async quickChat(
    prompt: string,
    options?: {
      studio?: StudioType;
      systemPrompt?: string;
      preferLocal?: boolean;
    }
  ): Promise<string> {
    const response = await this.execute({
      studio: options?.studio || "data-studio",
      operation: "quick-chat",
      prompt,
      systemPrompt: options?.systemPrompt,
      config: options?.preferLocal ? { privacyMode: true } : undefined,
    });
    return response.content || "";
  }

  /**
   * Generate with Claude Code (agentic)
   */
  async generateWithClaudeCode(
    prompt: string,
    context?: Record<string, unknown>
  ): Promise<StudioAIResponse> {
    return this.execute({
      studio: "asset-studio",
      operation: "generate-code",
      prompt,
      context,
      config: { useClaudeCode: true },
    });
  }

  /**
   * Generate with Ollama (local only)
   */
  async generateWithOllama(
    prompt: string,
    options?: {
      model?: string;
      studio?: StudioType;
    }
  ): Promise<StudioAIResponse> {
    return this.execute({
      studio: options?.studio || "data-studio",
      operation: "local-generation",
      prompt,
      config: {
        privacyMode: true,
        preferredProvider: "ollama",
        ollamaModel: options?.model || "llama3.1:8b",
      },
    });
  }
}

export const studioAIClient = StudioAIClient.getInstance();
