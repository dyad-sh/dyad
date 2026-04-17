/**
 * OpenClaw System Integration
 * 
 * Connects OpenClaw as the unified AI gateway across all JoyCreate systems:
 * - Local AI Hub (Ollama, LM Studio, etc.)
 * - Autonomous Agent System
 * - Language Model Handlers
 * - Data Pipeline (Scraping, Image Generation)
 * - Privacy Inference System
 * - Trustless Inference Service
 * 
 * This makes OpenClaw the central orchestrator for all AI operations,
 * with local-first processing via Ollama and cloud fallback via Anthropic.
 */

import { EventEmitter } from "events";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";

import { getOpenClawGateway } from "@/lib/openclaw_gateway_service";
import { getOpenClawDataPipeline } from "@/lib/openclaw_data_pipeline";
import type {
  OpenClawChatRequest,
  OpenClawChatResponse,
  OpenClawConfig,
  OpenClawCapability,
  OpenClawScrapingConfig,
  OpenClawImageGenConfig,
} from "@/types/openclaw_types";

const logger = log.scope("openclaw_integration");

// =============================================================================
// INTEGRATION TYPES
// =============================================================================

export interface OpenClawSystemConfig {
  /** Enable OpenClaw as the primary AI gateway */
  enabled: boolean;
  
  /** Use OpenClaw for autonomous agent inference */
  useForAgents: boolean;
  
  /** Use OpenClaw for language model requests */
  useForLanguageModels: boolean;
  
  /** Use OpenClaw for data pipeline AI operations */
  useForDataPipeline: boolean;
  
  /** Use OpenClaw for privacy-preserving inference */
  useForPrivacyInference: boolean;
  
  /** Fallback to direct provider calls if OpenClaw fails */
  fallbackOnError: boolean;
  
  /** Log all AI operations through OpenClaw */
  logAllOperations: boolean;
}

export interface AIOperationRequest {
  id: string;
  type: "chat" | "completion" | "agent" | "scrape" | "image" | "transcribe" | "tts";
  source: "user" | "agent" | "system" | "pipeline";
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  systemPrompt?: string;
  capabilities?: OpenClawCapability[];
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface AIOperationResponse {
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
}

// =============================================================================
// OpenClaw SYSTEM INTEGRATION
// =============================================================================

export class OpenClawSystemIntegration extends EventEmitter {
  private static instance: OpenClawSystemIntegration;
  
  private config: OpenClawSystemConfig = {
    enabled: true,
    useForAgents: true,
    useForLanguageModels: true,
    useForDataPipeline: true,
    useForPrivacyInference: true,
    fallbackOnError: true,
    logAllOperations: true,
  };
  
  private initialized = false;
  private operationHistory: AIOperationResponse[] = [];
  private stats = {
    totalOperations: 0,
    localOperations: 0,
    cloudOperations: 0,
    totalTokens: 0,
    totalCost: 0,
    errors: 0,
  };
  
  private constructor() {
    super();
  }
  
  static getInstance(): OpenClawSystemIntegration {
    if (!OpenClawSystemIntegration.instance) {
      OpenClawSystemIntegration.instance = new OpenClawSystemIntegration();
    }
    return OpenClawSystemIntegration.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(config?: Partial<OpenClawSystemConfig>): Promise<void> {
    if (this.initialized) return;
    
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    if (!this.config.enabled) {
      logger.info("OpenClaw system integration disabled");
      return;
    }
    
    logger.info("Initializing OpenClaw system integration...");
    
    // Initialize gateway
    // The internal gateway always starts on port 18792. If an external OpenClaw
    // daemon is running on port 18790 (registered as a Windows Scheduled Task /
    // systemd service), JoyCreate bridges to it automatically.
    // We do NOT spawn the external daemon here — it runs independently.
    const gateway = getOpenClawGateway();
    await gateway.initialize();
    
    // Initialize data pipeline
    const dataPipeline = getOpenClawDataPipeline();
    await dataPipeline.initialize();
    
    // Setup event forwarding
    this.setupEventForwarding();
    
    this.initialized = true;
    this.emit("initialized");
    
    logger.info("OpenClaw system integration initialized", {
      useForAgents: this.config.useForAgents,
      useForLanguageModels: this.config.useForLanguageModels,
      useForDataPipeline: this.config.useForDataPipeline,
    });
  }
  
  private setupEventForwarding(): void {
    const gateway = getOpenClawGateway();
    const dataPipeline = getOpenClawDataPipeline();
    
    // Forward gateway events
    gateway.on("message:received", (data) => this.emit("ai:response", data));
    gateway.on("provider:switched", (data) => this.emit("provider:switched", data));
    gateway.on("provider:error", (data) => this.emit("provider:error", data));
    
    // Forward data pipeline events
    dataPipeline.on("job:completed", (data) => this.emit("job:completed", data));
    dataPipeline.on("job:failed", (data) => this.emit("job:failed", data));
  }
  
  // ===========================================================================
  // UNIFIED AI INTERFACE
  // ===========================================================================
  
  /**
   * Execute an AI operation through OpenClaw
   * This is the main entry point for all AI operations in the system
   */
  async execute(request: AIOperationRequest): Promise<AIOperationResponse> {
    const startTime = Date.now();
    
    if (!this.initialized || !this.config.enabled) {
      throw new Error("OpenClaw system integration not initialized");
    }
    
    this.stats.totalOperations++;
    
    if (this.config.logAllOperations) {
      logger.info("AI operation requested", {
        id: request.id,
        type: request.type,
        source: request.source,
      });
    }
    
    try {
      let response: AIOperationResponse;
      
      switch (request.type) {
        case "chat":
        case "completion":
          response = await this.executeChat(request);
          break;
          
        case "agent":
          response = await this.executeAgentTask(request);
          break;
          
        case "scrape":
          response = await this.executeScraping(request);
          break;
          
        case "image":
          response = await this.executeImageGeneration(request);
          break;
          
        case "transcribe":
          response = await this.executeTranscription(request);
          break;
          
        case "tts":
          response = await this.executeTTS(request);
          break;
          
        default:
          throw new Error(`Unknown operation type: ${request.type}`);
      }
      
      // Update stats
      if (response.localProcessed) {
        this.stats.localOperations++;
      } else {
        this.stats.cloudOperations++;
      }
      if (response.tokens) {
        this.stats.totalTokens += response.tokens.total;
      }
      if (response.cost) {
        this.stats.totalCost += response.cost;
      }
      
      // Store in history
      this.operationHistory.push(response);
      if (this.operationHistory.length > 1000) {
        this.operationHistory.shift();
      }
      
      this.emit("operation:completed", response);
      return response;
      
    } catch (error) {
      this.stats.errors++;
      
      const errorResponse: AIOperationResponse = {
        id: uuidv4(),
        requestId: request.id,
        success: false,
        provider: "unknown",
        localProcessed: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      
      this.emit("operation:failed", errorResponse);
      
      // Try fallback if enabled
      if (this.config.fallbackOnError) {
        return this.executeFallback(request, errorResponse);
      }
      
      throw error;
    }
  }
  
  /**
   * Simple chat completion - convenience method
   */
  async chat(
    message: string,
    options?: {
      systemPrompt?: string;
      source?: AIOperationRequest["source"];
      preferLocal?: boolean;
    }
  ): Promise<string> {
    const response = await this.execute({
      id: uuidv4(),
      type: "chat",
      source: options?.source || "user",
      prompt: message,
      systemPrompt: options?.systemPrompt,
      capabilities: options?.preferLocal ? ["local-only"] : undefined,
      timestamp: Date.now(),
    });
    
    if (!response.success) {
      throw new Error(response.error || "Chat failed");
    }
    
    return response.content || "";
  }
  
  /**
   * Agent inference - for autonomous agents
   */
  async agentInference(
    agentId: string,
    prompt: string,
    options?: {
      systemPrompt?: string;
      model?: string;
      temperature?: number;
    }
  ): Promise<string> {
    const response = await this.execute({
      id: uuidv4(),
      type: "agent",
      source: "agent",
      prompt,
      systemPrompt: options?.systemPrompt,
      metadata: {
        agentId,
        model: options?.model,
        temperature: options?.temperature,
      },
      timestamp: Date.now(),
    });
    
    if (!response.success) {
      throw new Error(response.error || "Agent inference failed");
    }
    
    return response.content || "";
  }
  
  // ===========================================================================
  // OPERATION IMPLEMENTATIONS
  // ===========================================================================
  
  private async executeChat(request: AIOperationRequest): Promise<AIOperationResponse> {
    const gateway = getOpenClawGateway();
    const startTime = Date.now();
    
    // Build messages array with proper types
    const buildMessages = (): Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> => {
      if (request.messages) {
        return request.messages.map(m => ({
          role: m.role as "user" | "assistant" | "system" | "tool",
          content: m.content,
        }));
      }
      
      const msgs: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> = [];
      if (request.systemPrompt) {
        msgs.push({ role: "system", content: request.systemPrompt });
      }
      msgs.push({ role: "user", content: request.prompt || "" });
      return msgs;
    };
    
    const chatRequest: OpenClawChatRequest = {
      messages: buildMessages(),
      capabilities: request.capabilities,
      preferLocal: request.capabilities?.includes("local-only"),
    };
    
    const result = await gateway.chat(chatRequest);
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: true,
      content: result.message.content,
      provider: result.provider,
      localProcessed: result.localProcessed,
      tokens: {
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
        total: result.usage.totalTokens,
      },
      latencyMs: Date.now() - startTime,
    };
  }
  
  private async executeAgentTask(request: AIOperationRequest): Promise<AIOperationResponse> {
    const gateway = getOpenClawGateway();
    const startTime = Date.now();
    
    // For agent tasks, use the gateway's agent task execution
    const result = await gateway.executeAgentTask({
      id: uuidv4(),
      type: "analyze", // Valid type from OpenClawAgentTask
      objective: request.prompt || "",
      context: request.metadata?.context as string,
      constraints: [],
      preferLocal: true,
      maxIterations: (request.metadata?.maxIterations as number) || 10,
      timeout: (request.metadata?.timeout as number) || 60000,
    });
    
    // Get provider info from providersUsed array
    const provider = result.providersUsed?.[0] || "unknown";
    const isLocalProvider = provider === "ollama" || provider === "lmstudio" || provider === "local";
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: result.status === "completed",
      content: typeof result.result === "string" ? result.result : JSON.stringify(result.result),
      provider,
      localProcessed: isLocalProvider,
      tokens: {
        prompt: 0,
        completion: 0,
        total: result.tokensUsed,
      },
      latencyMs: Date.now() - startTime,
      error: result.error,
    };
  }
  
  private async executeScraping(request: AIOperationRequest): Promise<AIOperationResponse> {
    const dataPipeline = getOpenClawDataPipeline();
    const startTime = Date.now();
    
    const scrapingConfig: OpenClawScrapingConfig = {
      urls: [request.prompt || ""],
      type: "web",
      aiExtraction: {
        enabled: true,
        preferLocal: true,
        instructions: request.metadata?.instructions as string,
      },
      output: {
        format: "markdown",
        includeMetadata: true,
        extractImages: true,
        extractLinks: true,
      },
    };
    
    const results = await dataPipeline.scrape(scrapingConfig);
    const firstResult = results[0];
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: firstResult?.success || false,
      content: firstResult?.extractedData?.content || "",
      provider: firstResult?.aiProvider || "unknown",
      localProcessed: firstResult?.aiProvider === "ollama",
      latencyMs: Date.now() - startTime,
      error: firstResult?.error,
    };
  }
  
  private async executeImageGeneration(request: AIOperationRequest): Promise<AIOperationResponse> {
    const dataPipeline = getOpenClawDataPipeline();
    const startTime = Date.now();
    
    const imageConfig: OpenClawImageGenConfig = {
      prompt: request.prompt || "",
      width: (request.metadata?.width as number) || 1024,
      height: (request.metadata?.height as number) || 1024,
      model: (request.metadata?.model as string) || "stable-diffusion-xl",
      aiPromptEnhancement: {
        enabled: true,
        preferLocal: true,
        expandPrompt: true,
        addQualityTerms: true,
      },
    };
    
    const result = await dataPipeline.generateImage(imageConfig);
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: result.success,
      content: result.images.length > 0 ? result.images[0].path : undefined,
      provider: result.aiProvider || "stable-diffusion",
      localProcessed: result.aiProvider === "ollama",
      latencyMs: Date.now() - startTime,
      error: result.error,
    };
  }
  
  private async executeTranscription(request: AIOperationRequest): Promise<AIOperationResponse> {
    // Use OpenClaw to handle transcription via Whisper
    const startTime = Date.now();
    
    // This would integrate with the voice system
    // For now, emit an event for external handling
    this.emit("transcription:request", {
      audioPath: request.metadata?.audioPath,
      language: request.metadata?.language,
    });
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: true,
      content: "[Transcription pending - connect to Whisper service]",
      provider: "whisper",
      localProcessed: true,
      latencyMs: Date.now() - startTime,
    };
  }
  
  private async executeTTS(request: AIOperationRequest): Promise<AIOperationResponse> {
    // Use OpenClaw to handle TTS via Piper
    const startTime = Date.now();
    
    this.emit("tts:request", {
      text: request.prompt,
      voice: request.metadata?.voice,
      language: request.metadata?.language,
    });
    
    return {
      id: uuidv4(),
      requestId: request.id,
      success: true,
      content: "[TTS pending - connect to Piper service]",
      provider: "piper",
      localProcessed: true,
      latencyMs: Date.now() - startTime,
    };
  }
  
  private async executeFallback(
    request: AIOperationRequest,
    originalError: AIOperationResponse
  ): Promise<AIOperationResponse> {
    logger.warn("Attempting fallback for failed operation", {
      requestId: request.id,
      error: originalError.error,
    });
    
    // Try direct Ollama call as fallback
    try {
      const response = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.1:8b",
          messages: [{ role: "user", content: request.prompt }],
          stream: false,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        return {
          id: uuidv4(),
          requestId: request.id,
          success: true,
          content: data.message?.content || "",
          provider: "ollama-fallback",
          localProcessed: true,
          latencyMs: 0,
        };
      }
    } catch {
      // Fallback failed, return original error
    }
    
    return originalError;
  }
  
  // ===========================================================================
  // STATISTICS & MONITORING
  // ===========================================================================
  
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
  
  getOperationHistory(limit = 100): AIOperationResponse[] {
    return this.operationHistory.slice(-limit);
  }
  
  getConfig(): OpenClawSystemConfig {
    return { ...this.config };
  }
  
  updateConfig(updates: Partial<OpenClawSystemConfig>): void {
    this.config = { ...this.config, ...updates };
    this.emit("config:updated", this.config);
  }
  
  // ===========================================================================
  // PROVIDER INTEGRATION HELPERS
  // ===========================================================================
  
  /**
   * Create a language model provider that routes through OpenClaw
   */
  createOpenClawProvider() {
    const self = this;
    
    return {
      id: "OpenClaw",
      name: "OpenClaw Gateway",
      type: "OpenClaw",
      
      async chat(messages: Array<{ role: string; content: string }>) {
        const response = await self.execute({
          id: uuidv4(),
          type: "chat",
          source: "system",
          messages: messages as any,
          timestamp: Date.now(),
        });
        return response.content;
      },
      
      async complete(prompt: string) {
        const response = await self.execute({
          id: uuidv4(),
          type: "completion",
          source: "system",
          prompt,
          timestamp: Date.now(),
        });
        return response.content;
      },
    };
  }
  
  /**
   * Create an inference adapter for the autonomous agent system
   */
  createAgentInferenceAdapter() {
    const self = this;
    
    return {
      async runInference(agentId: string, prompt: string, options?: {
        systemPrompt?: string;
        model?: string;
        temperature?: number;
      }) {
        return self.agentInference(agentId, prompt, options);
      },
    };
  }
  
  /**
   * Create a privacy-preserving inference adapter
   */
  createPrivacyInferenceAdapter() {
    const self = this;
    
    return {
      async infer(request: {
        prompt: string;
        privacy: "maximum" | "high" | "standard";
        modelId?: string;
      }) {
        // For maximum privacy, always use local
        const preferLocal = request.privacy === "maximum";
        
        const response = await self.execute({
          id: uuidv4(),
          type: "completion",
          source: "system",
          prompt: request.prompt,
          capabilities: preferLocal ? ["local-only"] : undefined,
          metadata: { modelId: request.modelId, privacy: request.privacy },
          timestamp: Date.now(),
        });
        
        return {
          output: response.content,
          provider: response.provider,
          localOnly: response.localProcessed,
          tokens: response.tokens,
        };
      },
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

/** Singleton instance of the OpenClaw system integration */
export const openClawIntegration = OpenClawSystemIntegration.getInstance();

/**
 * Get the OpenClaw system integration singleton
 */
export function getOpenClawSystemIntegration(): OpenClawSystemIntegration {
  return OpenClawSystemIntegration.getInstance();
}

/**
 * Quick chat through OpenClaw
 */
export async function OpenClawChat(
  message: string,
  options?: { systemPrompt?: string; preferLocal?: boolean }
): Promise<string> {
  return openClawIntegration.chat(message, options);
}

/**
 * Agent inference through OpenClaw
 */
export async function OpenClawAgentInference(
  agentId: string,
  prompt: string,
  options?: { systemPrompt?: string; model?: string }
): Promise<string> {
  return openClawIntegration.agentInference(agentId, prompt, options);
}
