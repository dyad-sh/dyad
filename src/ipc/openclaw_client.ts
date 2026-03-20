/**
 * OpenClaw IPC Client
 * Renderer-side client for OpenClaw gateway integration
 */

import type { IpcRenderer } from "electron";
import type {
  OpenClawGatewayStatus,
  OpenClawProviderStatus,
  OpenClawChatParams,
  OpenClawChatResult,
  OpenClawAgentTaskParams,
  OpenClawAgentTaskResult,
  OpenClawClaudeCodeTaskParams,
  OpenClawClaudeCodeResult,
  OpenClawQuickGenerateParams,
  OpenClawQuickGenerateResult,
  OpenClawAutonomousAppParams,
  OpenClawConfigureProviderParams,
} from "./ipc_types";

import type {
  OpenClawConfig,
  OpenClawAIProvider,
  ClaudeCodeConfig,
  OpenClawEvent,
  OpenClawScrapingConfig,
  OpenClawScrapingResult,
  OpenClawImageGenConfig,
  OpenClawImageGenResult,
  OpenClawDataPipelineConfig,
  OpenClawPipelineResult,
  OpenClawDataRequest,
  OpenClawDataResponse,
} from "@/types/openclaw_types";

class OpenClawClientImpl {
  private static instance: OpenClawClientImpl;
  private ipcRenderer: IpcRenderer;
  private eventListeners: Map<string, Set<(event: OpenClawEvent) => void>> = new Map();
  private subscribed = false;

  private constructor() {
    // @ts-ignore - window.electron is injected by preload
    this.ipcRenderer = window.electron?.ipcRenderer;

    if (this.ipcRenderer) {
      // Set up event listener
      this.ipcRenderer.on("openclaw:event", (_event: unknown, data: OpenClawEvent) => {
        this.notifyListeners(data);
      });

      // Set up stream listener
      this.ipcRenderer.on("openclaw:chat:stream-chunk", (_event: unknown, data: { requestId: string; chunk: unknown }) => {
        this.notifyListeners({
          type: "message:received",
          timestamp: Date.now(),
          data,
          source: "stream",
        } as OpenClawEvent);
      });
    }
  }

  static getInstance(): OpenClawClientImpl {
    if (!OpenClawClientImpl.instance) {
      OpenClawClientImpl.instance = new OpenClawClientImpl();
    }
    return OpenClawClientImpl.instance;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:initialize");
  }

  async shutdown(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:shutdown");
  }

  // ===========================================================================
  // GATEWAY MANAGEMENT
  // ===========================================================================

  async startGateway(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:gateway:start");
  }

  async stopGateway(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:gateway:stop");
  }

  async getGatewayStatus(): Promise<OpenClawGatewayStatus> {
    return this.ipcRenderer.invoke("openclaw:gateway:status");
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  async getConfig(): Promise<OpenClawConfig> {
    return this.ipcRenderer.invoke("openclaw:config:get");
  }

  async updateConfig(updates: Partial<OpenClawConfig>): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:config:update", updates);
  }

  async getClaudeCodeConfig(): Promise<ClaudeCodeConfig> {
    return this.ipcRenderer.invoke("openclaw:claude-code:config:get");
  }

  async updateClaudeCodeConfig(updates: Partial<ClaudeCodeConfig>): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:claude-code:config:update", updates);
  }

  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================

  async listProviders(): Promise<OpenClawProviderStatus[]> {
    return this.ipcRenderer.invoke("openclaw:provider:list");
  }

  async checkProviderHealth(): Promise<Record<string, boolean>> {
    return this.ipcRenderer.invoke("openclaw:provider:health");
  }

  async configureProvider(params: OpenClawConfigureProviderParams): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:provider:configure", params);
  }

  async removeProvider(name: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:provider:remove", name);
  }

  async setProviderApiKey(provider: string, apiKey: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:provider:set-api-key", { provider, apiKey });
  }

  // ===========================================================================
  // CHAT & COMPLETION
  // ===========================================================================

  async chat(request: OpenClawChatParams): Promise<OpenClawChatResult> {
    return this.ipcRenderer.invoke("openclaw:chat", request);
  }

  async chatStream(request: OpenClawChatParams): Promise<{ requestId: string; response: OpenClawChatResult }> {
    return this.ipcRenderer.invoke("openclaw:chat:stream", request);
  }

  /**
   * Simple chat helper for quick interactions
   */
  async simpleChat(message: string, options?: {
    systemPrompt?: string;
    provider?: string;
    useLocal?: boolean;
  }): Promise<string> {
    const response = await this.chat({
      messages: [
        ...(options?.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
        { role: "user" as const, content: message },
      ],
      provider: options?.provider,
      capabilities: options?.useLocal ? ["local-only"] : undefined,
    });
    return response.message.content;
  }

  // ===========================================================================
  // AGENT TASKS
  // ===========================================================================

  async executeAgentTask(task: OpenClawAgentTaskParams): Promise<OpenClawAgentTaskResult> {
    return this.ipcRenderer.invoke("openclaw:agent:execute-task", task);
  }

  async executeAgentTaskWithN8n(params: {
    task: OpenClawAgentTaskParams;
    workflowId?: string;
    triggerWorkflow?: boolean;
  }): Promise<OpenClawAgentTaskResult> {
    return this.ipcRenderer.invoke("openclaw:agent:execute-with-n8n", params);
  }

  // ===========================================================================
  // CLAUDE CODE
  // ===========================================================================

  async executeClaudeCodeTask(task: OpenClawClaudeCodeTaskParams): Promise<OpenClawClaudeCodeResult> {
    return this.ipcRenderer.invoke("openclaw:claude-code:execute", task);
  }

  async executeClaudeCodeBatch(tasks: OpenClawClaudeCodeTaskParams[]): Promise<OpenClawClaudeCodeResult[]> {
    return this.ipcRenderer.invoke("openclaw:claude-code:batch", tasks);
  }

  // ===========================================================================
  // N8N INTEGRATION
  // ===========================================================================

  async triggerN8nWorkflow(workflowId: string, data: unknown): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:n8n:trigger-workflow", { workflowId, data });
  }

  async createAgentWorkflow(params: {
    name: string;
    agentType: string;
    objective: string;
    triggerType: "webhook" | "schedule" | "manual";
    schedule?: string;
  }): Promise<{ success: boolean; workflow: unknown }> {
    return this.ipcRenderer.invoke("openclaw:n8n:create-agent-workflow", params);
  }

  // ===========================================================================
  // AUTONOMOUS CREATION
  // ===========================================================================

  async createAutonomousApp(params: OpenClawAutonomousAppParams): Promise<OpenClawAgentTaskResult> {
    return this.ipcRenderer.invoke("openclaw:autonomous:create-app", params);
  }

  async refactorCode(params: {
    code: string;
    language: string;
    instructions: string;
    useLocal?: boolean;
  }): Promise<OpenClawAgentTaskResult> {
    return this.ipcRenderer.invoke("openclaw:autonomous:refactor-code", params);
  }

  async analyzeCodebase(params: {
    files: Array<{ path: string; content: string }>;
    analysisType: "security" | "performance" | "quality" | "all";
    useLocal?: boolean;
  }): Promise<OpenClawAgentTaskResult> {
    return this.ipcRenderer.invoke("openclaw:autonomous:analyze-codebase", params);
  }

  // ===========================================================================
  // QUICK ACTIONS
  // ===========================================================================

  async generateCode(params: OpenClawQuickGenerateParams): Promise<OpenClawQuickGenerateResult> {
    return this.ipcRenderer.invoke("openclaw:quick:generate-code", params);
  }

  async explainCode(params: {
    code: string;
    language?: string;
    detail?: "brief" | "detailed" | "beginner";
  }): Promise<{ explanation: string; provider: string; localProcessed: boolean }> {
    return this.ipcRenderer.invoke("openclaw:quick:explain-code", params);
  }

  async fixError(params: {
    code: string;
    error: string;
    language?: string;
  }): Promise<{ fix: string; provider: string; localProcessed: boolean }> {
    return this.ipcRenderer.invoke("openclaw:quick:fix-error", params);
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  async subscribe(): Promise<{ success: boolean }> {
    if (this.subscribed) return { success: true };
    const result = await this.ipcRenderer.invoke("openclaw:subscribe");
    this.subscribed = result.success;
    return result;
  }

  async unsubscribe(): Promise<{ success: boolean }> {
    if (!this.subscribed) return { success: true };
    const result = await this.ipcRenderer.invoke("openclaw:unsubscribe");
    this.subscribed = !result.success;
    return result;
  }

  addEventListener(type: string, listener: (event: OpenClawEvent) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);

    // Auto-subscribe when first listener is added
    if (!this.subscribed) {
      this.subscribe().catch(console.error);
    }
  }

  removeEventListener(type: string, listener: (event: OpenClawEvent) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(type);
      }
    }
  }

  private notifyListeners(event: OpenClawEvent): void {
    // Notify type-specific listeners
    const typeListeners = this.eventListeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach((listener) => listener(event));
    }

    // Notify wildcard listeners
    const wildcardListeners = this.eventListeners.get("*");
    if (wildcardListeners) {
      wildcardListeners.forEach((listener) => listener(event));
    }
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Check if OpenClaw is available and ready
   */
  async isReady(): Promise<boolean> {
    try {
      const status = await this.getGatewayStatus();
      return status.status === "connected";
    } catch {
      return false;
    }
  }

  /**
   * Get the best available provider for a task
   */
  async getBestProvider(capabilities?: string[]): Promise<OpenClawProviderStatus | null> {
    const providers = await this.listProviders();
    const health = await this.checkProviderHealth();

    const available = providers.filter((p) => p.enabled && health[p.name]);
    if (available.length === 0) return null;

    // Prefer local providers if available
    const local = available.find((p) => p.type === "ollama" || p.type === "lmstudio");
    if (local) return local;

    return available[0];
  }

  /**
   * Configure Ollama as the default local provider
   */
  async setupOllama(config?: {
    baseURL?: string;
    model?: string;
  }): Promise<{ success: boolean }> {
    return this.configureProvider({
      name: "ollama",
      config: {
        baseURL: config?.baseURL || "http://localhost:11434",
        model: config?.model || "llama3.1:8b",
        enabled: true,
        priority: 1,
      },
    });
  }

  /**
   * Configure Anthropic as the cloud provider
   */
  async setupAnthropic(apiKey: string, config?: {
    model?: string;
  }): Promise<{ success: boolean }> {
    return this.configureProvider({
      name: "anthropic",
      config: {
        apiKey,
        model: config?.model || "claude-3-5-sonnet-20250219",
        enabled: true,
        priority: 2,
      },
    });
  }

  /**
   * Enable Claude Code for agentic coding tasks
   */
  async enableClaudeCode(config?: Partial<ClaudeCodeConfig>): Promise<{ success: boolean }> {
    return this.updateClaudeCodeConfig({
      enabled: true,
      ...config,
    });
  }

  // ===========================================================================
  // DATA PIPELINE - SCRAPING
  // ===========================================================================

  /**
   * Initialize the data pipeline service
   */
  async initializeDataPipeline(): Promise<{ success: boolean; providers: string[] }> {
    return this.ipcRenderer.invoke("openclaw:data:initialize");
  }

  /**
   * Scrape multiple URLs with AI-enhanced extraction
   */
  async scrape(config: OpenClawScrapingConfig): Promise<OpenClawScrapingResult[]> {
    return this.ipcRenderer.invoke("openclaw:data:scrape", config);
  }

  /**
   * Scrape a single URL with AI-enhanced extraction
   */
  async scrapeSingle(url: string, options?: Partial<OpenClawScrapingConfig>): Promise<OpenClawScrapingResult> {
    return this.ipcRenderer.invoke("openclaw:data:scrape:single", url, options);
  }

  /**
   * Convenience method for quick scraping with AI extraction
   */
  async quickScrape(url: string, instructions?: string): Promise<OpenClawScrapingResult> {
    return this.scrapeSingle(url, {
      type: "web",
      aiExtraction: {
        enabled: true,
        preferLocal: true,
        instructions,
      },
      output: {
        format: "markdown",
        includeMetadata: true,
        extractImages: true,
        extractLinks: true,
      },
    });
  }

  // ===========================================================================
  // DATA PIPELINE - IMAGE GENERATION
  // ===========================================================================

  /**
   * Generate images with AI-enhanced prompts
   */
  async generateImage(config: OpenClawImageGenConfig): Promise<OpenClawImageGenResult> {
    return this.ipcRenderer.invoke("openclaw:data:image:generate", config);
  }

  /**
   * Enhance an image prompt using AI
   */
  async enhanceImagePrompt(prompt: string, options?: { 
    style?: string; 
    preferLocal?: boolean;
  }): Promise<{
    originalPrompt: string;
    enhancedPrompt: string;
    provider: string;
    localProcessed: boolean;
  }> {
    return this.ipcRenderer.invoke("openclaw:data:image:enhance-prompt", prompt, options);
  }

  /**
   * Convenience method for quick image generation with AI enhancement
   */
  async quickGenerateImage(prompt: string, options?: {
    style?: string;
    width?: number;
    height?: number;
    model?: string;
  }): Promise<OpenClawImageGenResult> {
    return this.generateImage({
      prompt,
      width: options?.width || 1024,
      height: options?.height || 1024,
      model: options?.model || "stable-diffusion-xl",
      aiPromptEnhancement: {
        enabled: true,
        preferLocal: true,
        style: options?.style,
        expandPrompt: true,
        addQualityTerms: true,
      },
    });
  }

  // ===========================================================================
  // DATA PIPELINE - PIPELINE ORCHESTRATION
  // ===========================================================================

  /**
   * Run a data collection pipeline
   */
  async runPipeline(config: OpenClawDataPipelineConfig): Promise<OpenClawPipelineResult> {
    return this.ipcRenderer.invoke("openclaw:data:pipeline:run", config);
  }

  /**
   * Send a unified data request through OpenClaw
   */
  async dataRequest(request: OpenClawDataRequest): Promise<OpenClawDataResponse> {
    return this.ipcRenderer.invoke("openclaw:data:request", request);
  }

  /**
   * Create a simple scrape-and-collect pipeline
   */
  async createScrapingPipeline(name: string, urls: string[], options?: {
    aiInstructions?: string;
    datasetId?: string;
  }): Promise<OpenClawPipelineResult> {
    return this.runPipeline({
      name,
      sources: [{
        type: "scraping",
        config: {
          urls,
          type: "web",
          aiExtraction: {
            enabled: true,
            preferLocal: true,
            instructions: options?.aiInstructions,
          },
        } as OpenClawScrapingConfig,
      }],
      processing: [
        {
          type: "ai-transform",
          config: {
            preferLocal: true,
            instructions: "Extract and structure the key information from each page.",
          },
        },
        {
          type: "dedupe",
          config: {},
        },
      ],
      output: {
        type: "dataset",
        config: {
          datasetId: options?.datasetId,
        },
      },
    });
  }

  // ===========================================================================
  // DATA PIPELINE - JOB MANAGEMENT
  // ===========================================================================

  /**
   * List all active data pipeline jobs
   */
  async listDataJobs(): Promise<Array<{
    id: string;
    type: string;
    status: string;
    progress: number;
    startedAt?: number;
    error?: string;
  }>> {
    return this.ipcRenderer.invoke("openclaw:data:jobs:list");
  }

  /**
   * Get a specific data job by ID
   */
  async getDataJob(jobId: string): Promise<{
    id: string;
    type: string;
    status: string;
    progress: number;
    startedAt?: number;
    completedAt?: number;
    result?: unknown;
    error?: string;
  } | undefined> {
    return this.ipcRenderer.invoke("openclaw:data:jobs:get", jobId);
  }

  /**
   * Cancel a running data job
   */
  async cancelDataJob(jobId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("openclaw:data:jobs:cancel", jobId);
  }

  // ===========================================================================
  // DATA PIPELINE - EVENTS
  // ===========================================================================

  private dataEventListeners: Map<string, Set<(event: unknown) => void>> = new Map();
  private dataSubscribed = false;

  /**
   * Subscribe to data pipeline events
   */
  async subscribeToDataEvents(): Promise<{ success: boolean }> {
    if (this.dataSubscribed) return { success: true };
    
    // Set up event listener
    this.ipcRenderer.on("openclaw:data:event", (_event: unknown, data: unknown) => {
      this.notifyDataListeners(data);
    });
    
    const result = await this.ipcRenderer.invoke("openclaw:data:events:subscribe");
    this.dataSubscribed = result.success;
    return result;
  }

  /**
   * Unsubscribe from data pipeline events
   */
  async unsubscribeFromDataEvents(): Promise<{ success: boolean }> {
    if (!this.dataSubscribed) return { success: true };
    const result = await this.ipcRenderer.invoke("openclaw:data:events:unsubscribe");
    this.dataSubscribed = !result.success;
    return result;
  }

  /**
   * Add a listener for data pipeline events
   */
  addDataEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.dataEventListeners.has(type)) {
      this.dataEventListeners.set(type, new Set());
    }
    this.dataEventListeners.get(type)!.add(listener);

    // Auto-subscribe when first listener is added
    if (!this.dataSubscribed) {
      this.subscribeToDataEvents().catch(console.error);
    }
  }

  /**
   * Remove a listener for data pipeline events
   */
  removeDataEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.dataEventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.dataEventListeners.delete(type);
      }
    }
  }

  private notifyDataListeners(event: unknown): void {
    const eventData = event as { jobId: string; [key: string]: unknown };
    const eventType = Object.keys(eventData).find(k => k !== "jobId") || "unknown";
    
    // Notify type-specific listeners
    const typeListeners = this.dataEventListeners.get(eventType);
    if (typeListeners) {
      typeListeners.forEach((listener) => listener(event));
    }

    // Notify wildcard listeners
    const wildcardListeners = this.dataEventListeners.get("*");
    if (wildcardListeners) {
      wildcardListeners.forEach((listener) => listener(event));
    }
  }

  // ===========================================================================
  // SYSTEM INTEGRATION
  // ===========================================================================

  /**
   * Initialize the OpenClaw system integration (connects all AI systems)
   */
  async initializeSystemIntegration(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:system:initialize");
  }

  /**
   * Get system integration config
   */
  async getSystemConfig(): Promise<{
    enabled: boolean;
    useForAgents: boolean;
    useForLanguageModels: boolean;
    useForDataPipeline: boolean;
    useForPrivacyInference: boolean;
    fallbackOnError: boolean;
    logAllOperations: boolean;
  }> {
    return this.ipcRenderer.invoke("openclaw:system:config:get");
  }

  /**
   * Update system integration config
   */
  async updateSystemConfig(updates: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:system:config:update", updates);
  }

  /**
   * Get system integration stats
   */
  async getSystemStats(): Promise<{
    totalOperations: number;
    localOperations: number;
    cloudOperations: number;
    totalTokens: number;
    totalCost: number;
    errors: number;
  }> {
    return this.ipcRenderer.invoke("openclaw:system:stats");
  }

  /**
   * Get operation history
   */
  async getSystemHistory(limit?: number): Promise<Array<{
    id: string;
    requestId: string;
    success: boolean;
    content?: string;
    provider: string;
    localProcessed: boolean;
    tokens?: { prompt: number; completion: number; total: number };
    latencyMs: number;
    cost?: number;
    error?: string;
  }>> {
    return this.ipcRenderer.invoke("openclaw:system:history", limit);
  }

  /**
   * Execute an AI operation through the unified system
   */
  async systemExecute(request: {
    type: "chat" | "completion" | "agent" | "scrape" | "image" | "transcribe" | "tts";
    source: "user" | "agent" | "system" | "pipeline";
    prompt?: string;
    messages?: Array<{ role: string; content: string }>;
    systemPrompt?: string;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{
    id: string;
    requestId: string;
    success: boolean;
    content?: string;
    provider: string;
    localProcessed: boolean;
    tokens?: { prompt: number; completion: number; total: number };
    latencyMs: number;
    cost?: number;
    error?: string;
  }> {
    return this.ipcRenderer.invoke("openclaw:system:execute", request);
  }

  /**
   * Quick chat through system integration (local first, cloud fallback)
   */
  async systemChat(message: string, options?: {
    systemPrompt?: string;
    preferLocal?: boolean;
  }): Promise<{ success: boolean; content: string }> {
    return this.ipcRenderer.invoke("openclaw:system:chat", message, options);
  }

  /**
   * Agent inference through system integration
   */
  async systemAgentInference(agentId: string, prompt: string, options?: {
    systemPrompt?: string;
    model?: string;
    temperature?: number;
  }): Promise<{ success: boolean; content: string }> {
    return this.ipcRenderer.invoke("openclaw:system:agent-inference", agentId, prompt, options);
  }

  // ===========================================================================
  // LOCAL AI HUB INTEGRATION
  // ===========================================================================

  /**
   * Get local AI hub provider statuses
   */
  async getLocalHubStatus(): Promise<Array<{
    id: string;
    available: boolean;
    baseUrl: string;
    models: Array<{ id: string; name: string }>;
    lastChecked: Date;
    error?: string;
  }>> {
    return this.ipcRenderer.invoke("openclaw:local-hub:status");
  }

  /**
   * Chat through local AI hub with OpenClaw routing
   */
  async localHubChat(request: {
    prompt: string;
    systemPrompt?: string;
    messages?: Array<{ role: string; content: string }>;
    modelConfig: {
      modelId: string;
      provider?: string;
      options?: Record<string, unknown>;
    };
  }): Promise<{
    id: string;
    requestId: string;
    output: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    generationTimeMs: number;
  }> {
    return this.ipcRenderer.invoke("openclaw:local-hub:chat", request);
  }

  /**
   * Get combined stats from local hub and OpenClaw
   */
  async getCombinedStats(): Promise<{
    local: {
      availableProviders: string[];
      totalModels: number;
    };
    openclaw: {
      totalOperations: number;
      localOperations: number;
      cloudOperations: number;
      totalTokens: number;
      totalCost: number;
    } | null;
  }> {
    return this.ipcRenderer.invoke("openclaw:local-hub:combined-stats");
  }

  // ===========================================================================
  // SYSTEM EVENTS
  // ===========================================================================

  private systemEventListeners: Map<string, Set<(event: unknown) => void>> = new Map();
  private systemSubscribed = false;

  /**
   * Subscribe to system integration events
   */
  async subscribeToSystemEvents(): Promise<{ success: boolean }> {
    if (this.systemSubscribed) return { success: true };
    
    // Set up event listener
    this.ipcRenderer.on("openclaw:system:event", (_event: unknown, data: unknown) => {
      this.notifySystemListeners(data);
    });
    
    const result = await this.ipcRenderer.invoke("openclaw:system:events:subscribe");
    this.systemSubscribed = result.success;
    return result;
  }

  /**
   * Add a listener for system integration events
   */
  addSystemEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.systemEventListeners.has(type)) {
      this.systemEventListeners.set(type, new Set());
    }
    this.systemEventListeners.get(type)!.add(listener);

    // Auto-subscribe when first listener is added
    if (!this.systemSubscribed) {
      this.subscribeToSystemEvents().catch(console.error);
    }
  }

  /**
   * Remove a listener for system integration events
   */
  removeSystemEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.systemEventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.systemEventListeners.delete(type);
      }
    }
  }

  private notifySystemListeners(event: unknown): void {
    const eventData = event as { type: string; data: unknown };
    
    // Notify type-specific listeners
    const typeListeners = this.systemEventListeners.get(eventData.type);
    if (typeListeners) {
      typeListeners.forEach((listener) => listener(eventData.data));
    }

    // Notify wildcard listeners
    const wildcardListeners = this.systemEventListeners.get("*");
    if (wildcardListeners) {
      wildcardListeners.forEach((listener) => listener(event));
    }
  }
}

export const OpenClawClient = OpenClawClientImpl.getInstance();
