/**
 * OpenClaw Central Nervous System
 * 
 * The unified control center for JoyCreate's AI operations.
 * Coordinates OpenClaw, Ollama, and n8n into a single cohesive system.
 * 
 * Architecture:
 * 
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                    OpenClaw Gateway                         │
 *   │  (Personal AI Assistant - WhatsApp, Telegram, Discord...)  │
 *   └────────────────────────────┬────────────────────────────────┘
 *                                │
 *                                ▼
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │              OpenClaw Central Nervous System                │
 *   │                                                             │
 *   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
 *   │  │    Ollama    │  │     N8n      │  │   JoyCreate  │      │
 *   │  │   Bridge     │  │   Bridge     │  │    Agents    │      │
 *   │  │ (Local LLMs) │  │ (Automation) │  │  (Autonomy)  │      │
 *   │  └──────────────┘  └──────────────┘  └──────────────┘      │
 *   └─────────────────────────────────────────────────────────────┘
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import { EventEmitter } from "events";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";

import { getOpenClawOllamaBridge, type OpenClawOllamaConfig } from "./openclaw_ollama_bridge";
import { getOpenClawN8nBridge, type OpenClawN8nConfig, type OpenClawN8nEvent } from "./openclaw_n8n_bridge";
import { getOpenClawGateway } from "./openclaw_gateway_service";

const logger = log.scope("openclaw_cns");

// =============================================================================
// TYPES
// =============================================================================

export interface CNSConfig {
  /** Enable the central nervous system */
  enabled: boolean;
  
  /** Ollama bridge configuration */
  ollama: Partial<OpenClawOllamaConfig>;
  
  /** N8n bridge configuration */
  n8n: Partial<OpenClawN8nConfig>;
  
  /** Intelligent routing configuration */
  routing: {
    /** Use Ollama for simple tasks */
    preferLocalForSimple: boolean;
    /** Complexity threshold (1-10) for local processing */
    localComplexityThreshold: number;
    /** Auto-trigger n8n workflows on events */
    autoTriggerWorkflows: boolean;
    /** Log all AI operations */
    logOperations: boolean;
  };
  
  /** Channel routing - which channels use which backend */
  channelRouting: Record<string, "ollama" | "cloud" | "auto">;
}

export interface CNSStatus {
  initialized: boolean;
  ollamaAvailable: boolean;
  n8nConnected: boolean;
  gatewayConnected: boolean;
  activeOperations: number;
  stats: {
    totalRequests: number;
    localRequests: number;
    cloudRequests: number;
    workflowsTriggered: number;
    errors: number;
  };
}

export interface AIRequest {
  id: string;
  type: "chat" | "completion" | "agent" | "embedding" | "vision" | "transcription";
  input: string | Array<{ role: string; content: string }>;
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    preferLocal?: boolean;
    channel?: string;
    agentId?: string;
  };
}

export interface AIResponse {
  id: string;
  requestId: string;
  content: string;
  model: string;
  isLocal: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timing?: {
    totalMs: number;
    tokensPerSecond?: number;
  };
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

// =============================================================================
// OPENCLAW CENTRAL NERVOUS SYSTEM
// =============================================================================

export class OpenClawCNS extends EventEmitter {
  private static instance: OpenClawCNS;
  
  private config: CNSConfig = {
    enabled: true,
    ollama: {},
    n8n: {},
    routing: {
      preferLocalForSimple: true,
      localComplexityThreshold: 7,
      autoTriggerWorkflows: true,
      logOperations: true,
    },
    channelRouting: {},
  };
  
  private initialized = false;
  private stats = {
    totalRequests: 0,
    localRequests: 0,
    cloudRequests: 0,
    workflowsTriggered: 0,
    errors: 0,
  };
  
  private activeOperations: Map<string, AIRequest> = new Map();
  
  private constructor() {
    super();
  }
  
  static getInstance(): OpenClawCNS {
    if (!OpenClawCNS.instance) {
      OpenClawCNS.instance = new OpenClawCNS();
    }
    return OpenClawCNS.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(config?: Partial<CNSConfig>): Promise<void> {
    if (this.initialized) return;
    
    if (config) {
      this.config = this.mergeConfig(config);
    }
    
    logger.info("🦞 Initializing OpenClaw Central Nervous System...");
    
    // Initialize Ollama bridge
    const ollamaBridge = getOpenClawOllamaBridge();
    await ollamaBridge.initialize(this.config.ollama);
    this.setupOllamaEvents(ollamaBridge);
    
    // Initialize N8n bridge
    const n8nBridge = getOpenClawN8nBridge();
    await n8nBridge.initialize(this.config.n8n);
    this.setupN8nEvents(n8nBridge);
    
    // Connect to OpenClaw gateway events
    this.setupGatewayEvents();
    
    this.initialized = true;
    
    logger.info("🦞 OpenClaw CNS initialized", {
      ollamaAvailable: ollamaBridge.isOllamaAvailable(),
      n8nConnections: n8nBridge.getAllConnections().length,
    });
    
    this.emit("initialized", this.getStatus());
  }
  
  private mergeConfig(config: Partial<CNSConfig>): CNSConfig {
    return {
      ...this.config,
      ...config,
      ollama: { ...this.config.ollama, ...config.ollama },
      n8n: { ...this.config.n8n, ...config.n8n },
      routing: { ...this.config.routing, ...config.routing },
      channelRouting: { ...this.config.channelRouting, ...config.channelRouting },
    };
  }
  
  async shutdown(): Promise<void> {
    const ollamaBridge = getOpenClawOllamaBridge();
    const n8nBridge = getOpenClawN8nBridge();
    
    await ollamaBridge.shutdown();
    await n8nBridge.shutdown();
    
    this.initialized = false;
    this.emit("shutdown");
    
    logger.info("🦞 OpenClaw CNS shut down");
  }
  
  // ===========================================================================
  // EVENT SETUP
  // ===========================================================================
  
  private setupOllamaEvents(bridge: ReturnType<typeof getOpenClawOllamaBridge>): void {
    bridge.on("inference:complete", (response) => {
      this.emit("local:inference:complete", response);
    });
    
    bridge.on("inference:error", (error) => {
      this.emit("local:inference:error", error);
      this.stats.errors++;
    });
    
    bridge.on("ollama:connected", () => {
      this.emit("ollama:connected");
      logger.info("🦞 Ollama connected");
    });
    
    bridge.on("ollama:disconnected", () => {
      this.emit("ollama:disconnected");
      logger.warn("🦞 Ollama disconnected");
    });
  }
  
  private setupN8nEvents(bridge: ReturnType<typeof getOpenClawN8nBridge>): void {
    bridge.on("workflow:triggering", (data) => {
      this.emit("workflow:triggering", data);
    });
    
    bridge.on("workflow:failed", (data) => {
      this.emit("workflow:failed", data);
      this.stats.errors++;
    });
    
    bridge.on("event:triggered", (data) => {
      this.stats.workflowsTriggered++;
      this.emit("event:triggered", data);
    });
  }
  
  private setupGatewayEvents(): void {
    try {
      const gateway = getOpenClawGateway();
      
      // Forward incoming messages to n8n if auto-trigger enabled
      gateway.on("message:received", async (data: any) => {
        if (this.config.routing.autoTriggerWorkflows) {
          const n8nBridge = getOpenClawN8nBridge();
          
          const event: OpenClawN8nEvent = {
            type: "message",
            channel: data.channel,
            data: {
              content: data.content,
              sender: data.sender,
              metadata: data.metadata,
            },
            timestamp: Date.now(),
          };
          
          await n8nBridge.handleOpenClawEvent(event);
        }
        
        this.emit("message:received", data);
      });
      
      gateway.on("agent:completed", async (data: any) => {
        if (this.config.routing.autoTriggerWorkflows) {
          const n8nBridge = getOpenClawN8nBridge();
          
          await n8nBridge.onAgentComplete(
            data.agentId,
            data.taskType,
            data.result
          );
        }
        
        this.emit("agent:completed", data);
      });
      
    } catch (error) {
      logger.warn("Could not connect to OpenClaw gateway:", error);
    }
  }
  
  // ===========================================================================
  // UNIFIED AI INTERFACE
  // ===========================================================================
  
  /**
   * Process an AI request through the CNS
   * Intelligently routes to Ollama (local) or cloud based on task
   */
  async process(request: AIRequest): Promise<AIResponse> {
    if (!this.initialized) {
      throw new Error("OpenClaw CNS not initialized");
    }
    
    const startTime = Date.now();
    this.stats.totalRequests++;
    this.activeOperations.set(request.id, request);
    
    if (this.config.routing.logOperations) {
      logger.info("🦞 Processing AI request", {
        id: request.id,
        type: request.type,
      });
    }
    
    this.emit("request:start", request);
    
    try {
      // Determine routing
      const route = this.determineRoute(request);
      
      let response: AIResponse;
      
      if (route.useLocal) {
        response = await this.processLocal(request, route.model);
        this.stats.localRequests++;
      } else {
        response = await this.processCloud(request, route.model);
        this.stats.cloudRequests++;
      }
      
      response.timing = {
        totalMs: Date.now() - startTime,
        tokensPerSecond: response.timing?.tokensPerSecond,
      };
      
      this.activeOperations.delete(request.id);
      this.emit("request:complete", response);
      
      return response;
      
    } catch (error) {
      this.stats.errors++;
      this.activeOperations.delete(request.id);
      
      this.emit("request:error", {
        requestId: request.id,
        error,
      });
      
      throw error;
    }
  }
  
  private determineRoute(request: AIRequest): { useLocal: boolean; model: string } {
    const ollamaBridge = getOpenClawOllamaBridge();
    
    // Check if local is available
    if (!ollamaBridge.isOllamaAvailable()) {
      return { useLocal: false, model: "claude-sonnet-4-20250514" };
    }
    
    // Check channel routing
    if (request.options?.channel) {
      const channelRoute = this.config.channelRouting[request.options.channel];
      if (channelRoute === "ollama") {
        return { useLocal: true, model: this.getLocalModel(request) };
      }
      if (channelRoute === "cloud") {
        return { useLocal: false, model: "claude-sonnet-4-20250514" };
      }
    }
    
    // Check explicit preference
    if (request.options?.preferLocal !== undefined) {
      return {
        useLocal: request.options.preferLocal,
        model: request.options.preferLocal
          ? this.getLocalModel(request)
          : "claude-sonnet-4-20250514",
      };
    }
    
    // Use intelligent routing
    if (this.config.routing.preferLocalForSimple) {
      const recommendation = ollamaBridge.recommendModel({
        type: request.type === "chat" ? "chat" : 
              request.type === "embedding" ? "embedding" :
              request.type === "vision" ? "vision" : "analysis",
        complexity: this.estimateComplexity(request),
        inputLength: typeof request.input === "string" 
          ? request.input.length 
          : request.input.reduce((sum, m) => sum + m.content.length, 0),
        requiresVision: request.type === "vision",
      });
      
      return {
        useLocal: recommendation.isLocal,
        model: recommendation.model,
      };
    }
    
    // Default to local
    return {
      useLocal: true,
      model: this.getLocalModel(request),
    };
  }
  
  private getLocalModel(request: AIRequest): string {
    const ollamaBridge = getOpenClawOllamaBridge();
    const config = ollamaBridge.getConfig();
    
    if (request.options?.model) {
      return request.options.model;
    }
    
    switch (request.type) {
      case "vision":
        return config.defaultVisionModel;
      case "embedding":
        return config.defaultEmbeddingModel;
      default:
        return config.defaultChatModel;
    }
  }
  
  private estimateComplexity(request: AIRequest): number {
    // Simple heuristic for task complexity
    const input = typeof request.input === "string"
      ? request.input
      : request.input.map(m => m.content).join(" ");
    
    let complexity = 5;
    
    // Longer inputs = more complex
    if (input.length > 2000) complexity += 2;
    if (input.length > 5000) complexity += 2;
    
    // Code-related = more complex
    if (input.includes("```") || input.includes("function") || input.includes("class")) {
      complexity += 1;
    }
    
    // Multi-turn conversations = more complex
    if (Array.isArray(request.input) && request.input.length > 4) {
      complexity += 1;
    }
    
    return Math.min(10, complexity);
  }
  
  private async processLocal(request: AIRequest, model: string): Promise<AIResponse> {
    const ollamaBridge = getOpenClawOllamaBridge();
    
    const messages = typeof request.input === "string"
      ? [{ role: "user" as const, content: request.input }]
      : request.input.map(m => ({
          role: m.role as "user" | "assistant" | "system" | "tool",
          content: m.content,
        }));
    
    if (request.options?.systemPrompt) {
      messages.unshift({ role: "system" as const, content: request.options.systemPrompt });
    }
    
    const result = await ollamaBridge.inference({
      model,
      messages,
      temperature: request.options?.temperature,
      maxTokens: request.options?.maxTokens,
    });
    
    return {
      id: uuidv4(),
      requestId: request.id,
      content: result.content,
      model: result.model,
      isLocal: true,
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
      },
      timing: {
        totalMs: result.timing.totalMs,
        tokensPerSecond: result.timing.tokensPerSecond,
      },
      toolCalls: result.toolCalls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    };
  }
  
  private async processCloud(request: AIRequest, model: string): Promise<AIResponse> {
    // Use OpenClaw gateway for cloud inference
    const gateway = getOpenClawGateway();
    
    const messages = typeof request.input === "string"
      ? [{ role: "user" as const, content: request.input }]
      : request.input.map(m => ({
          role: m.role as "user" | "assistant" | "system" | "tool",
          content: m.content,
        }));
    
    if (request.options?.systemPrompt) {
      messages.unshift({ role: "system" as const, content: request.options.systemPrompt });
    }
    
    const result = await gateway.chat({
      messages,
      preferLocal: false,
    });
    
    return {
      id: uuidv4(),
      requestId: request.id,
      content: result.message.content,
      model: result.provider,
      isLocal: false,
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  }
  
  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================
  
  /**
   * Simple chat - auto routes to best backend
   */
  async chat(
    message: string,
    options?: {
      systemPrompt?: string;
      preferLocal?: boolean;
      channel?: string;
    }
  ): Promise<string> {
    const response = await this.process({
      id: uuidv4(),
      type: "chat",
      input: message,
      options,
    });
    
    return response.content;
  }
  
  /**
   * Run agent task
   */
  async agentTask(
    agentId: string,
    task: string,
    options?: {
      model?: string;
      preferLocal?: boolean;
    }
  ): Promise<string> {
    const response = await this.process({
      id: uuidv4(),
      type: "agent",
      input: task,
      options: {
        ...options,
        agentId,
      },
    });
    
    return response.content;
  }
  
  /**
   * Trigger n8n workflow manually
   */
  async triggerWorkflow(
    workflowId: string,
    data?: Record<string, unknown>
  ): Promise<{ executionId: string; status: string }> {
    const n8nBridge = getOpenClawN8nBridge();
    
    const result = await n8nBridge.triggerWorkflow({
      workflowId,
      data,
    });
    
    return {
      executionId: result.executionId,
      status: result.status,
    };
  }
  
  /**
   * Send message via OpenClaw channel (triggers n8n workflow if configured)
   */
  async sendMessage(
    channel: string,
    message: string,
    recipient: string
  ): Promise<void> {
    try {
      const gateway = getOpenClawGateway();
      
      // Check if gateway has sendMessage method
      if (typeof (gateway as any).sendMessage === "function") {
        await (gateway as any).sendMessage({
          channel: channel as any,
          recipient,
          content: message,
        });
      } else {
        // Fallback: emit event for external handling
        this.emit("message:send-requested", { channel, recipient, message });
      }
    } catch (error) {
      logger.warn("Could not send message via gateway:", error);
      this.emit("message:send-requested", { channel, recipient, message });
    }
    
    // Trigger any configured workflows
    if (this.config.routing.autoTriggerWorkflows) {
      const n8nBridge = getOpenClawN8nBridge();
      
      await n8nBridge.handleOpenClawEvent({
        type: "message",
        channel,
        data: {
          content: message,
          recipient,
          direction: "outgoing",
        },
        timestamp: Date.now(),
      });
    }
  }
  
  // ===========================================================================
  // STATUS & GETTERS
  // ===========================================================================
  
  getStatus(): CNSStatus {
    const ollamaBridge = getOpenClawOllamaBridge();
    const n8nBridge = getOpenClawN8nBridge();
    
    let gatewayConnected = false;
    try {
      const gateway = getOpenClawGateway();
      // Check if gateway has isConnected method
      if (typeof (gateway as any).isConnected === "function") {
        gatewayConnected = (gateway as any).isConnected();
      } else if (typeof (gateway as any).getStatus === "function") {
        const status = (gateway as any).getStatus();
        gatewayConnected = status?.connected ?? false;
      }
    } catch {
      // Gateway not available
    }
    
    return {
      initialized: this.initialized,
      ollamaAvailable: ollamaBridge.isOllamaAvailable(),
      n8nConnected: n8nBridge.getAllConnections().some(c => c.status === "connected"),
      gatewayConnected,
      activeOperations: this.activeOperations.size,
      stats: { ...this.stats },
    };
  }
  
  getConfig(): CNSConfig {
    return { ...this.config };
  }
  
  updateConfig(config: Partial<CNSConfig>): void {
    this.config = this.mergeConfig(config);
    
    // Update sub-bridges
    if (config.ollama) {
      getOpenClawOllamaBridge().updateConfig(config.ollama);
    }
    if (config.n8n) {
      getOpenClawN8nBridge().updateConfig(config.n8n);
    }
    
    this.emit("config:updated", this.config);
  }
  
  getOllamaBridge() {
    return getOpenClawOllamaBridge();
  }
  
  getN8nBridge() {
    return getOpenClawN8nBridge();
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

let instance: OpenClawCNS | null = null;

export function getOpenClawCNS(): OpenClawCNS {
  if (!instance) {
    instance = OpenClawCNS.getInstance();
  }
  return instance;
}

export default OpenClawCNS;
